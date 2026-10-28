from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload, selectinload
import math
import re
import unicodedata

from database import db
from extensions import bcrypt
from models.usuario_models import DECIMALES_UBICACION_PUBLICA, Usuario, Paciente, Enfermero, Disponibilidad
from models.servicio_models import Servicio
from models.solicitud_models import ESTADOS_ACTIVOS, SolicitudServicio
from routes.auth_routes import (
    buscar_usuario_por_email, clave_de_cuenta, error_password, normalizar_email, verificar_password,
)
from schema_legal import VERSION_TERMINOS
from seguridad import crear_tokens
from services.limites import borrar_intentos, ip_cliente, registrar_intento, supera_limite

usuario_bp = Blueprint('usuario_bp', __name__)
LIMITES_PERFIL_PACIENTE = {
    'nombre': 100, 'apellido': 100, 'direccion': 200, 'telefono': 20,
    'obraSocial': 100, 'historial_medico': 5000,
}
# Límites de intentos: guardados en la base para que valgan con varios procesos del servidor.
VENTANA_LOGIN = timedelta(minutes=15)
MAX_FALLIDOS_LOGIN_EMAIL, MAX_FALLIDOS_LOGIN_IP = 5, 20
VENTANA_REGISTRO, MAX_REGISTROS_POR_IP = timedelta(hours=1), 5
MENSAJE_LIMITE_LOGIN = (
    'Hiciste muchos intentos para entrar. Esperá 15 minutos y probá de nuevo. '
    'Si no recordás la contraseña, tocá "¿Olvidaste tu contraseña?".'
)
MENSAJE_TELEFONO = 'Escribí el teléfono con código de área, sin 0 ni 15. Por ejemplo: 261 555 1234.'
MAX_TELEFONO_ESCRITO = 40


def normalizar_telefono(telefono):
    """Celular argentino de 10 dígitos (área + número), o None si no se puede armar.

    Misma regla que enlaceWhatsapp en frontend/src/api.js: acepta +54, 9, el 0 del área y el 15.
    """
    digitos = re.sub(r'\D', '', telefono)
    if digitos.startswith('54'):
        digitos = digitos[2:]
    if digitos.startswith('9'):
        digitos = digitos[1:]
    if digitos.startswith('0'):
        digitos = digitos[1:]
    if len(digitos) == 12:
        quince = next((i for i in (2, 3, 4) if digitos[i:i + 2] == '15'), None)
        if quince is not None:
            digitos = digitos[:quince] + digitos[quince + 2:]
    return digitos if len(digitos) == 10 else None


def _identidad(texto):
    # Corregir mayúsculas o espacios no cambia a la persona: no hace falta volver a verificarla.
    return ' '.join((texto or '').split()).casefold()


def _servicios_del_catalogo(ids):
    """SCRUM-14/53: (servicios activos con esos ids, None) o (None, mensaje de error)."""
    if not isinstance(ids, list) or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
        return None, 'Los servicios tienen que ser una lista de números de servicio'
    ids = set(ids)
    servicios = Servicio.query.filter(Servicio.idServicio.in_(ids), Servicio.activo.is_(True)).all() if ids else []
    if len(servicios) != len(ids):
        return None, 'Alguno de los servicios elegidos no existe o ya no se ofrece'
    return servicios, None


def _validar_telefono(data):
    """Deja en data el teléfono normalizado. Devuelve el mensaje de error o None."""
    telefono = data.get('telefono')
    if telefono is None:
        return None
    if not isinstance(telefono, str) or len(telefono) > MAX_TELEFONO_ESCRITO:
        return MENSAJE_TELEFONO
    if not telefono.strip():
        data['telefono'] = ''
        return None
    # Se guardan solo los 10 dígitos: igual que los datos existentes y fácil de usar en WhatsApp.
    data['telefono'] = normalizar_telefono(telefono)
    return None if data['telefono'] else MENSAJE_TELEFONO

# ==========================================
# 1. RUTA DE LOGIN
# ==========================================
@usuario_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Datos inválidos"}), 400
    email = data.get('email')
    password = data.get('password')

    if not isinstance(email, str) or not isinstance(password, str) or not email.strip() or not password:
        return jsonify({"error": "Faltan datos"}), 400

    email = normalizar_email(email)
    ip = ip_cliente()
    usuario = buscar_usuario_por_email(email)
    # Por cuenta y no por lo escrito: "aná@..." y "ana@..." son la misma cuenta en MySQL.
    clave = clave_de_cuenta(usuario, email)
    if supera_limite('login_email', clave, MAX_FALLIDOS_LOGIN_EMAIL, VENTANA_LOGIN) or supera_limite(
        'login_ip', ip, MAX_FALLIDOS_LOGIN_IP, VENTANA_LOGIN
    ):
        return jsonify({"error": MENSAJE_LIMITE_LOGIN}), 429

    if not verificar_password(usuario, password):
        registrar_intento('login_email', clave)
        registrar_intento('login_ip', ip)
        return jsonify({"error": "Credenciales incorrectas"}), 401
    borrar_intentos('login_email', clave)

    if usuario.estado == 'Suspendido':
        return jsonify({"error": "La cuenta está suspendida. Contactá a soporte."}), 403

    tokens = crear_tokens(usuario)

    return jsonify({"mensaje": "Login exitoso", **tokens, "rol": usuario.rol}), 200


# ==========================================
# 2. RUTA DE REGISTRO
# ==========================================
@usuario_bp.route('/registro', methods=['POST'])
def registrar_usuario():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Datos inválidos"}), 400

    ip = ip_cliente()
    if supera_limite('registro_ip', ip, MAX_REGISTROS_POR_IP, VENTANA_REGISTRO):
        return jsonify({"error": "Hiciste muchos intentos de crear una cuenta. Esperá una hora y probá de nuevo."}), 429

    nombre_completo = data.get('nombre')
    email = data.get('email')
    password = data.get('password')
    rol = data.get('rol', 'paciente')

    if not all(isinstance(valor, str) and valor.strip() for valor in (nombre_completo, email, password)):
        return jsonify({"error": "Todos los campos son obligatorios"}), 400
    nombre_completo = nombre_completo.strip()
    email = normalizar_email(email)
    if len(email) > 120 or '@' not in email or len(nombre_completo) > 200:
        return jsonify({"error": "Revisá el nombre y el email"}), 400
    if rol not in ('paciente', 'enfermero'):
        return jsonify({"error": "Rol inválido"}), 400
    mensaje_password = error_password(password)
    if mensaje_password:
        return jsonify({"error": mensaje_password}), 400
    # Ley 25.326 (art. 5 y 7): consentimiento libre, expreso e informado, también para datos de salud.
    if data.get('aceptaTerminos') is not True:
        return jsonify({"error": "Para crear la cuenta tenés que aceptar los Términos y condiciones y la Política de privacidad"}), 400

    # Cuenta solo los pedidos completos: equivocarse en el formulario no bloquea a nadie.
    registrar_intento('registro_ip', ip)
    usuario_existente = buscar_usuario_por_email(email)
    if usuario_existente:
        return jsonify({"error": "El email ya está registrado"}), 400

    password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    nuevo_usuario = Usuario(
        email=email,
        password_hash=password_hash,
        rol=rol,
        versionTerminos=VERSION_TERMINOS,
        aceptoTerminosEn=datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0),
    )

    partes = nombre_completo.split(' ', 1)
    nombre = partes[0]
    apellido = partes[1] if len(partes) > 1 else ''

    try:
        db.session.add(nuevo_usuario)
        db.session.flush()

        if rol == 'paciente':
            nuevo_perfil = Paciente(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido
            )
        elif rol == 'enfermero':
            matricula_temporal = f"PENDIENTE-{nuevo_usuario.id}"
            
            nuevo_perfil = Enfermero(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido,
                especialidad='General',
                matricula=matricula_temporal
            )
        else:
            db.session.rollback()
            return jsonify({"error": "Rol inválido"}), 400

        db.session.add(nuevo_perfil)
        db.session.commit()
        return jsonify({"mensaje": "Usuario registrado exitosamente"}), 201
    except IntegrityError:
        # Dos registros simultáneos con el mismo email.
        db.session.rollback()
        return jsonify({"error": "El email ya está registrado"}), 400
    except Exception:
        db.session.rollback()
        current_app.logger.exception('No se pudo registrar el usuario')
        return jsonify({"error": "Error al guardar el usuario"}), 500


# ==========================================
# 3. VISTA "MI PERFIL" DE PACIENTE
# ==========================================
@usuario_bp.route('/perfil/paciente', methods=['GET', 'PUT'])
@jwt_required()
def perfil_paciente():
    usuario_id = int(get_jwt_identity())
    usuario = Usuario.query.get(usuario_id)

    if not usuario or usuario.rol != 'paciente':
        return jsonify({"error": "Perfil no encontrado o acceso denegado"}), 404

    paciente = Paciente.query.filter_by(usuario_id=usuario_id).first()

    if request.method == 'GET':
        datos_completos = usuario.to_dict()
        if not paciente:
            datos_completos.update({
                "nombre": "Falta configurar", "apellido": "", "direccion": "No registrada",
                "telefono": "No registrado", "historial_medico": "Sin datos"
            })
        else:
            datos_completos.update(paciente.to_dict())
        return jsonify(datos_completos), 200

    if request.method == 'PUT':
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({"error": "Datos inválidos"}), 400
        mensaje_telefono = _validar_telefono(data)
        if mensaje_telefono:
            return jsonify({"error": mensaje_telefono}), 400
        if paciente:
            coordenadas = ('latitud', 'longitud')
            for campo in coordenadas:
                if campo not in data or data[campo] is None:
                    continue
                try:
                    if isinstance(data[campo], bool):
                        raise ValueError()
                    numero = float(data[campo])
                    if not math.isfinite(numero):
                        raise ValueError()
                    if (campo == 'latitud' and abs(numero) > 90) or (
                        campo == 'longitud' and abs(numero) > 180
                    ):
                        raise ValueError()
                    data[campo] = numero
                except (TypeError, ValueError):
                    return jsonify({"error": f"El campo {campo} no es válido"}), 400
            if any(campo in data for campo in coordenadas) and (
                not all(campo in data for campo in coordenadas)
                or (data['latitud'] is None) != (data['longitud'] is None)
            ):
                return jsonify({"error": "Indicá latitud y longitud juntas"}), 400
            if 'ubicacion_compartida' in data and not isinstance(
                data['ubicacion_compartida'], bool
            ):
                return jsonify({"error": "La opción para compartir ubicación debe ser verdadera o falsa"}), 400
            if data.get('ubicacion_compartida') and (
                data.get('latitud', paciente.latitud) is None
                or data.get('longitud', paciente.longitud) is None
            ):
                return jsonify({"error": "Elegí un punto en el mapa antes de compartir tu ubicación"}), 400
            for campo, limite in LIMITES_PERFIL_PACIENTE.items():
                if campo in data and data[campo] is not None and (
                    not isinstance(data[campo], str) or len(data[campo]) > limite
                ):
                    return jsonify({"error": f"El campo {campo} debe ser un texto de hasta {limite} caracteres"}), 400
            paciente.nombre = data.get('nombre', paciente.nombre)
            paciente.apellido = data.get('apellido', paciente.apellido)
            paciente.direccion = data.get('direccion', paciente.direccion)
            paciente.telefono = data.get('telefono', paciente.telefono)
            # Solo si viene en el pedido: así cambiar el teléfono no depende de poder leer el historial.
            # Si el guardado no se puede descifrar, un campo vacío no lo pisa (se puede recuperar).
            if 'historial_medico' in data and not (paciente.historial_ilegible() and not data['historial_medico']):
                paciente.historial_medico = data['historial_medico']
            paciente.obraSocial = data.get('obraSocial', paciente.obraSocial)
            paciente.latitud = data.get('latitud', paciente.latitud)
            paciente.longitud = data.get('longitud', paciente.longitud)
            paciente.ubicacion_compartida = data.get(
                'ubicacion_compartida', paciente.ubicacion_compartida
            )
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
                current_app.logger.error('No se pudo guardar el perfil del paciente')
                return jsonify({"error": "No se pudieron guardar los cambios. Intentá nuevamente."}), 500
            
            datos_completos = usuario.to_dict()
            datos_completos.update(paciente.to_dict())
            return jsonify(datos_completos), 200
        return jsonify({"error": "No se pudo actualizar"}), 400


# ==========================================
# 4. VISTA "MI PERFIL" DE ENFERMERO
# ==========================================
@usuario_bp.route('/perfil/enfermero', methods=['GET', 'PUT'])
@jwt_required()
def perfil_enfermero():
    usuario_id = int(get_jwt_identity())
    usuario = Usuario.query.get(usuario_id)

    if not usuario or usuario.rol != 'enfermero':
        return jsonify({"error": "No sos enfermero"}), 403

    enfermero = Enfermero.query.filter_by(usuario_id=usuario_id).first()

    if request.method == 'GET':
        datos_completos = usuario.to_dict()
        if enfermero:
            datos_completos.update(enfermero.to_dict())
        return jsonify(datos_completos), 200

    if request.method == 'PUT':
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify({'error': 'Datos inválidos'}), 400
        if not enfermero:
            return jsonify({'error': 'Perfil profesional no encontrado'}), 404
        mensaje_telefono = _validar_telefono(data)
        if mensaje_telefono:
            return jsonify({'error': mensaje_telefono}), 400
        for campo, limite in {'nombre': 100, 'apellido': 100, 'especialidad': 100, 'matricula': 50,
                              'telefono': 20, 'direccion': 200, 'ciudad': 100}.items():
            if campo != 'matricula' and data.get(campo) is None:
                continue
            if campo in data and (not isinstance(data[campo], str) or len(data[campo].strip()) > limite):
                return jsonify({'error': f'El campo {campo} no es válido (máximo {limite} caracteres)'}), 400
            if campo in data:
                data[campo] = data[campo].strip()
        if 'matricula' in data:
            data['matricula'] = data['matricula'].strip()
            if not data['matricula']:
                return jsonify({'error': 'La matrícula es obligatoria'}), 400
        if data.get('descripcion') is not None and not isinstance(data['descripcion'], str):
            return jsonify({'error': 'La descripción debe ser texto'}), 400
        if 'disponible' in data and not isinstance(data['disponible'], bool):
            return jsonify({'error': 'La disponibilidad debe ser verdadera o falsa'}), 400
        for campo in ('tarifa_hora', 'experiencia_anios', 'latitud', 'longitud'):
            if campo not in data:
                continue
            if campo in ('latitud', 'longitud') and data[campo] is None:
                continue
            try:
                if isinstance(data[campo], bool):
                    raise ValueError()
                numero = float(data[campo])
                if not math.isfinite(numero):
                    raise ValueError()
                if campo in ('tarifa_hora', 'experiencia_anios') and numero < 0:
                    raise ValueError()
                if campo == 'experiencia_anios' and not numero.is_integer():
                    raise ValueError()
                if (campo == 'latitud' and abs(numero) > 90) or (campo == 'longitud' and abs(numero) > 180):
                    raise ValueError()
                data[campo] = int(numero) if campo == 'experiencia_anios' else numero
            except (TypeError, ValueError):
                return jsonify({'error': f'El campo {campo} no es válido'}), 400
        servicios_ofrecidos = None
        if 'servicios' in data:
            servicios_ofrecidos, mensaje_servicios = _servicios_del_catalogo(data['servicios'])
            if mensaje_servicios:
                return jsonify({'error': mensaje_servicios}), 400
        coordenadas = ('latitud', 'longitud')
        if any(campo in data for campo in coordenadas):
            if not all(campo in data for campo in coordenadas):
                return jsonify({'error': 'Indicá latitud y longitud juntas'}), 400
            if (data['latitud'] is None) != (data['longitud'] is None):
                return jsonify({'error': 'Elegí un punto completo en el mapa o quitá la ubicación'}), 400
        direccion_cambiada = any(
            campo in data and (data[campo] or '') != (getattr(enfermero, campo) or '')
            for campo in ('direccion', 'ciudad')
        )
        if direccion_cambiada and not any(campo in data for campo in coordenadas):
            data.update(latitud=None, longitud=None)
        if enfermero:
            # La matrícula se verifica contra el nombre: cambiar la identidad exige revisarla de nuevo.
            identidad_cambiada = any(
                campo in data and _identidad(data[campo]) != _identidad(getattr(enfermero, campo))
                for campo in ('nombre', 'apellido')
            )
            enfermero.nombre = data.get('nombre', enfermero.nombre)
            enfermero.apellido = data.get('apellido', enfermero.apellido)
            enfermero.especialidad = data.get('especialidad', enfermero.especialidad)
            nueva_matricula = data.get('matricula', enfermero.matricula)
            if nueva_matricula != enfermero.matricula or (
                identidad_cambiada and (enfermero.verificado or enfermero.matricula_rechazada)
            ):
                # Una matrícula distinta (o con otro titular) tiene que volver a validarse (HU9).
                enfermero.verificado = False
                enfermero.matricula_rechazada = False
            if enfermero.matricula_rechazada:
                # Con la matrícula rechazada, guardar el perfil (el aviso pide corregir y guardar) la manda
                # de nuevo a revisión: el motivo puede ser la especialidad u otro dato, no solo la matrícula.
                enfermero.matricula_rechazada = False
            enfermero.matricula = nueva_matricula
            enfermero.telefono = data.get('telefono', enfermero.telefono)
            enfermero.experiencia_anios = data.get('experiencia_anios', enfermero.experiencia_anios)
            enfermero.descripcion = data.get('descripcion', enfermero.descripcion)
            enfermero.direccion = data.get('direccion', enfermero.direccion)
            enfermero.ciudad = data.get('ciudad', enfermero.ciudad)
            enfermero.tarifa_hora = data.get('tarifa_hora', enfermero.tarifa_hora)
            enfermero.disponible = data.get('disponible', enfermero.disponible)
            enfermero.latitud = data.get('latitud', enfermero.latitud)
            enfermero.longitud = data.get('longitud', enfermero.longitud)
            if servicios_ofrecidos is not None:
                # Los dados de baja por el administrador se conservan: si vuelven al catálogo, reaparecen.
                inactivos = [servicio for servicio in enfermero.servicios if servicio.activo is False]
                enfermero.servicios = inactivos + servicios_ofrecidos
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
                return jsonify({'error': 'La matrícula ya está registrada por otro profesional'}), 409
            except Exception:
                db.session.rollback()
                current_app.logger.exception('Error al actualizar el perfil profesional')
                return jsonify({'error': 'No se pudo guardar el perfil'}), 500

            datos_completos = usuario.to_dict()
            datos_completos.update(enfermero.to_dict())
            return jsonify(datos_completos), 200


# ==========================================
# 5. GESTIÓN DE HORARIOS DE ENFERMERO (Control de duplicados)
# ==========================================
# ==========================================
# 5. GESTIÓN DE HORARIOS DE ENFERMERO (Control de duplicados y formato)
# ==========================================
@usuario_bp.route('/perfil/enfermero/horarios', methods=['GET', 'POST'])
@usuario_bp.route('/perfil/enfermero/horarios/<int:horario_id>', methods=['PUT'])
@jwt_required()
def gestionar_horarios(horario_id=None):
    usuario_id = int(get_jwt_identity())
    enfermero = Enfermero.query.filter_by(usuario_id=usuario_id).first()
    
    if not enfermero:
        return jsonify({"error": "Enfermero no encontrado"}), 404

    if request.method == 'GET':
        horarios = Disponibilidad.query.filter_by(enfermero_id=enfermero.id).all()
        return jsonify([h.to_dict() for h in horarios]), 200

    horario = None
    if request.method == 'PUT':
        horario = Disponibilidad.query.filter_by(
            id=horario_id,
            enfermero_id=enfermero.id
        ).first()
        if not horario:
            return jsonify({'error': 'Horario no encontrado'}), 404

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Datos inválidos'}), 400

    # Soporte por si la clave viene llamada 'dia' o 'dia_semana'
    dia_semana = data.get('dia_semana') or data.get('dia')
    str_inicio = data.get('hora_inicio') or data.get('inicio')
    str_fin = data.get('hora_fin') or data.get('fin')
    estado = data.get('estado', 'Disponible')

    if dia_semana not in ('Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'):
        return jsonify({'error': 'Elegí un día válido'}), 400
    if estado not in ('Disponible', 'Ocupado / Reservado', 'En Pausa / No disponible'):
        return jsonify({'error': 'Elegí un estado válido'}), 400

    if not (dia_semana and str_inicio and str_fin):
        return jsonify({'error': 'Completá el día, la hora de inicio y la hora de fin'}), 400

    try:
        # Función auxiliar para convertir múltiples formatos de hora
        def parse_time(time_str):
            time_str = str(time_str).strip()
            for fmt in ('%H:%M:%S', '%H:%M', '%I:%M %p', '%I:%M%p'):
                try:
                    return datetime.strptime(time_str, fmt).time()
                except ValueError:
                    pass
            raise ValueError(f"Formato de hora no válido: {time_str}")

        hora_inicio = parse_time(str_inicio)
        hora_fin = parse_time(str_fin)

    except ValueError as err:
        return jsonify({"error": str(err)}), 400

    if hora_fin <= hora_inicio:
        return jsonify({'error': 'La hora de fin debe ser posterior a la hora de inicio'}), 400

    # Verificamos si ya existe exactamente esa disponibilidad para no duplicar
    existente = Disponibilidad.query.filter_by(
        enfermero_id=enfermero.id,
        dia_semana=dia_semana,
        hora_inicio=hora_inicio,
        hora_fin=hora_fin
    ).first()

    if existente and (horario is None or existente.id != horario.id):
        return jsonify({'error': 'Ese horario ya está registrado'}), 409

    superpuesto_query = Disponibilidad.query.filter(
        Disponibilidad.enfermero_id == enfermero.id,
        Disponibilidad.dia_semana == dia_semana,
        Disponibilidad.hora_inicio < hora_fin,
        Disponibilidad.hora_fin > hora_inicio,
    )
    if horario:
        superpuesto_query = superpuesto_query.filter(Disponibilidad.id != horario.id)
    if superpuesto_query.first():
        return jsonify({'error': 'El horario se superpone con otro del mismo día'}), 409

    disponibilidad = horario or Disponibilidad(enfermero_id=enfermero.id)
    disponibilidad.dia_semana = dia_semana
    disponibilidad.hora_inicio = hora_inicio
    disponibilidad.hora_fin = hora_fin
    disponibilidad.estado = estado
    db.session.add(disponibilidad)
    db.session.commit()
    return jsonify({
        "mensaje": "Horario guardado con éxito",
        "disponibilidad": disponibilidad.to_dict()
    }), 200 if horario else 201


@usuario_bp.route('/perfil/enfermero/horarios/<int:horario_id>', methods=['DELETE'])
@jwt_required()
def eliminar_horario(horario_id):
    """Quita una franja de la agenda; los turnos ya pedidos no cambian."""
    enfermero = Enfermero.query.filter_by(usuario_id=int(get_jwt_identity())).first()
    if not enfermero:
        return jsonify({'error': 'Enfermero no encontrado'}), 404
    horario = Disponibilidad.query.filter_by(id=horario_id, enfermero_id=enfermero.id).first()
    if not horario:
        return jsonify({'error': 'Horario no encontrado'}), 404
    try:
        db.session.delete(horario)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify({'error': 'No se pudo eliminar el horario. Intentá nuevamente.'}), 500
    return jsonify({'mensaje': 'Horario eliminado', 'id': horario_id}), 200


# ==========================================
# 6. OBTENER TODOS LOS ENFERMEROS (Incluye Horarios)
# ==========================================
@usuario_bp.route('/enfermeros', methods=['GET'])
def obtener_enfermeros():
    # Solo los que la cartilla puede mostrar (disponibles, verificados y no suspendidos).
    enfermeros_db = consulta_enfermeros_visibles().options(
        joinedload(Enfermero.usuario), selectinload(Enfermero.disponibilidades), selectinload(Enfermero.servicios),
    ).all()
    lista_enfermeros = []
    for enfermero in enfermeros_db:
        # Público y sin login: nada de email, teléfono, dirección ni ubicación exacta.
        datos = enfermero.to_dict_publico()
        # Se adjunta la lista de disponibilidades/horarios del enfermero
        datos['horarios'] = [d.to_dict() for d in enfermero.disponibilidades]
        lista_enfermeros.append(datos)
    return jsonify(lista_enfermeros), 200


@usuario_bp.route('/pacientes/solicitudes-activas', methods=['GET'])
@jwt_required()
def buscar_pacientes_con_solicitudes():
    usuario_id = int(get_jwt_identity())
    usuario = db.session.get(Usuario, usuario_id)
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    if usuario.rol != 'enfermero':
        return jsonify({'error': 'Solo un enfermero puede consultar sus pacientes'}), 403
    enfermero = Enfermero.query.filter_by(usuario_id=usuario.id).first()
    if not enfermero:
        return jsonify({'error': 'Perfil de enfermero no encontrado'}), 404

    texto = request.args.get('q', '').strip()
    pagina = request.args.get('page', 1, type=int)
    por_pagina = request.args.get('per_page', 6, type=int)
    if pagina < 1 or not 1 <= por_pagina <= 100:
        return jsonify({'error': 'Paginación inválida'}), 400

    query = Paciente.query.join(
        SolicitudServicio,
        SolicitudServicio.idPaciente == Paciente.id,
    ).filter(
        SolicitudServicio.idEnfermero == enfermero.id,
    )
    if texto:
        patron = f'%{texto}%'
        query = query.filter(
            or_(Paciente.nombre.ilike(patron), Paciente.apellido.ilike(patron))
        )
    query = query.distinct().order_by(Paciente.nombre, Paciente.apellido, Paciente.id)
    paginacion = query.paginate(page=pagina, per_page=por_pagina, error_out=False)
    pacientes = []
    for paciente in paginacion.items:
        activas = SolicitudServicio.query.filter(
            SolicitudServicio.idPaciente == paciente.id,
            SolicitudServicio.idEnfermero == enfermero.id,
            SolicitudServicio.estado.in_(ESTADOS_ACTIVOS),
        ).order_by(SolicitudServicio.fecha, SolicitudServicio.hora).all()
        solicitudes_activas = len(activas)
        solicitudes = SolicitudServicio.query.filter_by(
            idPaciente=paciente.id,
            idEnfermero=enfermero.id,
        ).count()
        # HU16: el mapa del enfermero usa el lugar de atención del próximo turno en curso (el mismo punto que ya
        # ve en ese pedido). Si ningún turno lo tiene, queda la ubicación que el paciente eligió compartir.
        turno = next((s for s in activas if s.ubicacion_atencion()), None)
        compartir_ubicacion = (
            solicitudes_activas > 0
            and paciente.ubicacion_compartida
            and paciente.latitud is not None
            and paciente.longitud is not None
        )
        if turno:
            latitud, longitud = turno.latitudAtencion, turno.longitudAtencion
        elif compartir_ubicacion:
            latitud, longitud = paciente.latitud, paciente.longitud
        else:
            latitud = longitud = None
        pacientes.append({
            'id': paciente.usuario_id,
            'idPaciente': paciente.id,
            'nombre': paciente.nombre,
            'apellido': paciente.apellido,
            'solicitudes': solicitudes,
            'solicitudes_activas': solicitudes_activas,
            'latitud': latitud,
            'longitud': longitud,
            'turno': {
                'idSolicitud': turno.idSolicitud,
                'estado': turno.estado,
                'fecha': turno.fecha.isoformat(),
                'hora': turno.hora.strftime('%H:%M'),
                'direccionAtencion': turno.direccionAtencion,
            } if turno else None,
        })

    return jsonify({
        'pacientes': pacientes,
        'pagina_actual': paginacion.page,
        'por_pagina': paginacion.per_page,
        'total_resultados': paginacion.total,
        'total_paginas': paginacion.pages,
    }), 200


# ==========================================
# 7. OBTENER UN PERFIL POR ID
# ==========================================
@usuario_bp.route('/usuarios/<int:id>', methods=['GET'])
@jwt_required()
def obtener_usuario_por_id(id):
    visitante = db.session.get(Usuario, int(get_jwt_identity()))
    if not visitante:
        return jsonify({"error": "La sesión no corresponde a un usuario existente"}), 401
    usuario = db.session.get(Usuario, id)
    if not usuario:
        return jsonify({"error": "Usuario no encontrado"}), 404

    if visitante.id == usuario.id or es_administrador_activo(visitante):
        # La cuenta propia y los administradores ven el perfil completo (con email y rol).
        datos = usuario.to_dict()
        datos['estado'] = usuario.estado
        datos['eliminado'] = bool(usuario.eliminado)
        if usuario.perfil_enfermero:
            datos.update(usuario.perfil_enfermero.to_dict())
            datos['horarios'] = [d.to_dict() for d in usuario.perfil_enfermero.disponibilidades]
        elif usuario.perfil_paciente:
            datos.update(usuario.perfil_paciente.to_dict())
            if visitante.id != usuario.id:
                # El historial médico es solo de su titular (y del enfermero que lo atiende).
                datos.pop('historial_medico')
                datos.pop('historialIlegible', None)
        return jsonify(datos), 200

    # Para el resto, solo el perfil público de un enfermero de la cartilla.
    enfermero = consulta_enfermeros_visibles().filter(Enfermero.usuario_id == id).first()
    if not enfermero:
        return jsonify({"error": "Usuario no encontrado"}), 404
    datos = enfermero.to_dict_publico()
    datos['rol'] = 'enfermero'
    datos['horarios'] = [d.to_dict() for d in enfermero.disponibilidades]
    # El teléfono (WhatsApp) solo llega al paciente que tiene una atención aceptada con él.
    datos['contacto_habilitado'] = contacto_habilitado(visitante, enfermero)
    if datos['contacto_habilitado']:
        datos['telefono'] = enfermero.telefono
    return jsonify(datos), 200


def es_administrador_activo(usuario):
    return bool(
        usuario and usuario.rol == 'administrador' and usuario.nivelPermiso
        and not usuario.suspendido and not usuario.eliminado
    )


def contacto_habilitado(usuario, enfermero):
    if usuario.rol != 'paciente' or not usuario.perfil_paciente:
        return False
    return db.session.query(SolicitudServicio.query.filter_by(
        idPaciente=usuario.perfil_paciente.id, idEnfermero=enfermero.id, estado='Aceptada',
    ).exists()).scalar()


# ==========================================
# 8. OBTENER HORARIOS POR ID
# ==========================================
@usuario_bp.route('/usuarios/<int:id>/horarios', methods=['GET'])
@jwt_required()
def obtener_horarios_por_id(id):
    enfermero = Enfermero.query.filter_by(usuario_id=id).first()
    if not enfermero:
        return jsonify([]), 200
    horarios = Disponibilidad.query.filter_by(enfermero_id=enfermero.id).all()
    return jsonify([h.to_dict() for h in horarios]), 200


@usuario_bp.route('/enfermeros/ciudades', methods=['GET'])
def ciudades_enfermeros():
    """Zonas con profesionales en la cartilla, para el filtro por ciudad."""
    ciudades = {}
    for (ciudad,) in consulta_enfermeros_visibles().with_entities(Enfermero.ciudad).order_by(Enfermero.id):
        ciudad = ' '.join((ciudad or '').split())
        if ciudad:
            # "Godoy Cruz" y "godoy cruz" son la misma zona: queda la primera forma escrita.
            ciudades.setdefault(_clave_orden(ciudad), ciudad)
    return jsonify([ciudades[clave] for clave in sorted(ciudades)]), 200


def _clave_orden(texto):
    # Sin tildes ni mayúsculas: "Luján" se ordena como "Lujan" y no después de la "z".
    sin_tildes = unicodedata.normalize('NFKD', texto).encode('ascii', 'ignore').decode('ascii')
    return sin_tildes.casefold()


# ==========================================
# 9. SPRINT 3: API DE BÚSQUEDA AVANZADA Y FILTROS
# ==========================================
@usuario_bp.route('/enfermeros/buscar', methods=['GET'])
def buscar_enfermeros():
    texto = request.args.get('q', '').strip()
    especialidad = request.args.get('especialidad', '').strip()
    ciudad = request.args.get('ciudad', '').strip()
    # SCRUM-14/53: id de un servicio del catálogo; solo quienes declararon ofrecerlo.
    servicio_id = request.args.get('servicio', type=int)
    if 'servicio' in request.args and (servicio_id is None or servicio_id < 1):
        return jsonify({'error': 'El servicio no es válido'}), 400
    precio_max = request.args.get('precio_max', type=float)
    precio_min = request.args.get('precio_min', type=float)
    dia_semana = request.args.get('dia_semana', '').strip()
    hora_desde = request.args.get('hora_desde', '').strip()
    hora_hasta = request.args.get('hora_hasta', '').strip()

    pagina = request.args.get('page', 1, type=int)
    por_pagina = request.args.get('per_page', 10, type=int)
    if pagina < 1 or not 1 <= por_pagina <= 100:
        return jsonify({'error': 'Paginación inválida'}), 400
    for campo, valor in (('precio_min', precio_min), ('precio_max', precio_max)):
        if campo in request.args and (valor is None or not math.isfinite(valor) or valor < 0):
            return jsonify({'error': 'El precio debe ser un número mayor o igual a cero'}), 400
    if precio_min is not None and precio_max is not None and precio_min > precio_max:
        return jsonify({'error': 'El precio mínimo no puede superar al máximo'}), 400
    if bool(hora_desde) != bool(hora_hasta):
        return jsonify({'error': 'Debe indicar las horas desde y hasta'}), 400
    hora_inicio = hora_fin = None
    if hora_desde:
        try:
            hora_inicio = datetime.strptime(hora_desde, '%H:%M').time()
            hora_fin = datetime.strptime(hora_hasta, '%H:%M').time()
        except ValueError:
            return jsonify({'error': 'El horario debe tener formato HH:MM'}), 400
        if hora_inicio >= hora_fin:
            return jsonify({'error': 'La hora desde debe ser anterior a la hora hasta'}), 400

    # HU3: ubicación del paciente para ordenar por cercanía (opcional).
    lat_texto, lng_texto = request.args.get('lat'), request.args.get('lng')
    origen = None
    if lat_texto is not None or lng_texto is not None:
        try:
            origen = (float(lat_texto), float(lng_texto))
        except (TypeError, ValueError):
            return jsonify({'error': 'La ubicación debe incluir latitud y longitud numéricas'}), 400
        if not (-90 <= origen[0] <= 90 and -180 <= origen[1] <= 180):
            return jsonify({'error': 'La ubicación no es válida'}), 400
    # Solo kilómetros enteros: con decimales se podría ir achicando el radio hasta ubicar a alguien.
    radio_km = request.args.get('radio_km', type=int)
    if 'radio_km' in request.args and (radio_km is None or not 0 < radio_km <= 500):
        return jsonify({'error': 'El radio tiene que ser un número entero de kilómetros entre 1 y 500'}), 400
    if radio_km is not None and origen is None:
        return jsonify({'error': 'Para filtrar por radio indicá tu ubicación'}), 400

    query = consulta_enfermeros_visibles()

    if texto:
        patron = f"%{texto}%"
        query = query.filter(
            or_(
                Enfermero.nombre.ilike(patron),
                Enfermero.apellido.ilike(patron),
                Enfermero.especialidad.ilike(patron),
                # Sin la dirección: buscarla permitiría confirmar dónde vive un profesional.
                Enfermero.ciudad.ilike(patron),
            )
        )

    if especialidad:
        query = query.filter(Enfermero.especialidad.ilike(f"%{especialidad}%"))

    if ciudad:
        query = query.filter(Enfermero.ciudad.ilike(f"%{ciudad}%"))

    if servicio_id is not None:
        query = query.filter(Enfermero.servicios.any(and_(
            Servicio.idServicio == servicio_id, Servicio.activo.is_(True),
        )))

    if precio_max is not None:
        query = query.filter(Enfermero.tarifa_hora <= precio_max)
    if precio_min is not None:
        query = query.filter(Enfermero.tarifa_hora >= precio_min)

    if dia_semana or hora_inicio:
        filtros_horario = [Disponibilidad.estado == 'Disponible']
        if dia_semana:
            filtros_horario.append(
                Disponibilidad.dia_semana.ilike(f"%{dia_semana}%")
            )
        if hora_inicio:
            filtros_horario.extend((
                Disponibilidad.hora_inicio <= hora_inicio,
                Disponibilidad.hora_fin >= hora_fin,
            ))
        query = query.filter(
            Enfermero.disponibilidades.any(and_(*filtros_horario))
        )

    query = query.distinct().options(
        selectinload(Enfermero.disponibilidades), selectinload(Enfermero.servicios),
    )

    def serializar(enf, distancia=None):
        datos_enf = enf.to_dict_publico()
        datos_enf['horarios'] = [d.to_dict() for d in enf.disponibilidades]
        if origen is not None:
            # En kilómetros enteros: desde varios puntos, decimales permitirían triangular el domicilio.
            datos_enf['distancia_km'] = None if distancia is None else round(distancia)
        return datos_enf

    if origen is None:
        paginacion = query.paginate(page=pagina, per_page=por_pagina, error_out=False)
        return jsonify({
            "pagina_actual": paginacion.page,
            "por_pagina": paginacion.per_page,
            "total_resultados": paginacion.total,
            "total_paginas": paginacion.pages,
            "enfermeros": [serializar(enf) for enf in paginacion.items]
        }), 200

    # HU3 "enfermeros cercanos": distancia en línea recta, los más cercanos primero;
    # quienes no cargaron su ubicación van al final (salvo que se pida un radio).
    candidatos = []
    for enf in query.all():
        distancia = None
        if enf.latitud is not None and enf.longitud is not None:
            # Con la misma ubicación aproximada que se publica (B2): distancia, orden y radio
            # no pueden revelar más que el punto que ya muestra el mapa.
            distancia = distancia_km(
                origen[0], origen[1],
                round(enf.latitud, DECIMALES_UBICACION_PUBLICA), round(enf.longitud, DECIMALES_UBICACION_PUBLICA),
            )
        if radio_km is not None and (distancia is None or distancia > radio_km):
            continue
        candidatos.append((distancia, enf))
    candidatos.sort(key=lambda par: (par[0] is None, par[0] or 0, par[1].id))
    total = len(candidatos)
    inicio = (pagina - 1) * por_pagina
    return jsonify({
        "pagina_actual": pagina,
        "por_pagina": por_pagina,
        "total_resultados": total,
        "total_paginas": math.ceil(total / por_pagina) if total else 0,
        "enfermeros": [serializar(enf, distancia) for distancia, enf in candidatos[inicio:inicio + por_pagina]],
    }), 200


def distancia_km(lat1, lng1, lat2, lng2):
    """Distancia en km entre dos coordenadas (fórmula de haversine)."""
    radio_tierra = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlng = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * radio_tierra * math.asin(math.sqrt(a))


def consulta_enfermeros_visibles():
    """Enfermeros que pueden aparecer y recibir pedidos: HU3 (disponibles), HU9 (verificados) y HU10 (no suspendidos)."""
    return Enfermero.query.join(Usuario, Enfermero.usuario_id == Usuario.id).filter(
        Enfermero.disponible.is_(True),
        Enfermero.verificado.is_(True),
        Usuario.suspendido.is_(False),
    )
