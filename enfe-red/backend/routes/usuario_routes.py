from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
import math

from database import db
from extensions import bcrypt
from models.usuario_models import Usuario, Paciente, Enfermero, Disponibilidad
from models.solicitud_models import ESTADOS_ACTIVOS, SolicitudServicio
from routes.auth_routes import error_password

usuario_bp = Blueprint('usuario_bp', __name__)

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

    usuario = Usuario.query.filter_by(email=email.strip()).first()

    try:
        valida = bool(usuario) and bcrypt.check_password_hash(usuario.password_hash, password)
    except ValueError:
        # bcrypt rechaza contraseñas de más de 72 bytes: nunca pueden coincidir.
        valida = False
    if not valida:
        return jsonify({"error": "Credenciales incorrectas"}), 401

    token = create_access_token(
        identity=str(usuario.id),
        additional_claims={"rol": usuario.rol}
    )

    return jsonify({"mensaje": "Login exitoso", "token": token, "rol": usuario.rol}), 200


# ==========================================
# 2. RUTA DE REGISTRO
# ==========================================
@usuario_bp.route('/registro', methods=['POST'])
def registrar_usuario():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Datos inválidos"}), 400

    nombre_completo = data.get('nombre')
    email = data.get('email')
    password = data.get('password')
    rol = data.get('rol', 'paciente')

    if not all(isinstance(valor, str) and valor.strip() for valor in (nombre_completo, email, password)):
        return jsonify({"error": "Todos los campos son obligatorios"}), 400
    nombre_completo = nombre_completo.strip()
    email = email.strip()
    if len(email) > 120 or '@' not in email or len(nombre_completo) > 200:
        return jsonify({"error": "Revisá el nombre y el email"}), 400
    if rol not in ('paciente', 'enfermero'):
        return jsonify({"error": "Rol inválido"}), 400
    mensaje_password = error_password(password)
    if mensaje_password:
        return jsonify({"error": mensaje_password}), 400

    usuario_existente = Usuario.query.filter_by(email=email).first()
    if usuario_existente:
        return jsonify({"error": "El email ya está registrado"}), 400

    password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    nuevo_usuario = Usuario(
        email=email,
        password_hash=password_hash,
        rol=rol
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
            paciente.nombre = data.get('nombre', paciente.nombre)
            paciente.apellido = data.get('apellido', paciente.apellido)
            paciente.direccion = data.get('direccion', paciente.direccion)
            paciente.telefono = data.get('telefono', paciente.telefono)
            paciente.historial_medico = data.get('historial_medico', paciente.historial_medico)
            paciente.latitud = data.get('latitud', paciente.latitud)
            paciente.longitud = data.get('longitud', paciente.longitud)
            paciente.ubicacion_compartida = data.get(
                'ubicacion_compartida', paciente.ubicacion_compartida
            )
            db.session.commit()
            
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
            enfermero.nombre = data.get('nombre', enfermero.nombre)
            enfermero.apellido = data.get('apellido', enfermero.apellido)
            enfermero.especialidad = data.get('especialidad', enfermero.especialidad)
            nueva_matricula = data.get('matricula', enfermero.matricula)
            if nueva_matricula != enfermero.matricula:
                # Una matrícula distinta tiene que volver a validarse (HU9).
                enfermero.verificado = False
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
        return jsonify({
            "error": "Faltan datos requeridos",
            "recibido": data
        }), 400

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


# ==========================================
# 6. OBTENER TODOS LOS ENFERMEROS (Incluye Horarios)
# ==========================================
@usuario_bp.route('/enfermeros', methods=['GET'])
def obtener_enfermeros():
    enfermeros_db = Enfermero.query.all()
    lista_enfermeros = []
    
    for enfermero in enfermeros_db:
        usuario = Usuario.query.get(enfermero.usuario_id)
        if usuario:
            datos = enfermero.to_dict()
            datos['id'] = usuario.id 
            datos['usuario_id'] = usuario.id
            datos['email'] = usuario.email
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
        solicitudes_activas = SolicitudServicio.query.filter(
            SolicitudServicio.idPaciente == paciente.id,
            SolicitudServicio.idEnfermero == enfermero.id,
            SolicitudServicio.estado.in_(ESTADOS_ACTIVOS),
        ).count()
        solicitudes = SolicitudServicio.query.filter_by(
            idPaciente=paciente.id,
            idEnfermero=enfermero.id,
        ).count()
        compartir_ubicacion = (
            solicitudes_activas > 0
            and paciente.ubicacion_compartida
            and paciente.latitud is not None
            and paciente.longitud is not None
        )
        pacientes.append({
            'id': paciente.usuario_id,
            'idPaciente': paciente.id,
            'nombre': paciente.nombre,
            'apellido': paciente.apellido,
            'solicitudes': solicitudes,
            'solicitudes_activas': solicitudes_activas,
            'latitud': paciente.latitud if compartir_ubicacion else None,
            'longitud': paciente.longitud if compartir_ubicacion else None,
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
    usuario = Usuario.query.get(id)
    if not usuario:
        return jsonify({"error": "Usuario no encontrado"}), 404

    datos = usuario.to_dict()
    
    if usuario.rol == 'enfermero':
        enfermero = Enfermero.query.filter_by(usuario_id=id).first()
        if enfermero:
            datos.update(enfermero.to_dict())
            datos['horarios'] = [d.to_dict() for d in enfermero.disponibilidades]
            
    return jsonify(datos), 200


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


# ==========================================
# 9. SPRINT 3: API DE BÚSQUEDA AVANZADA Y FILTROS
# ==========================================
@usuario_bp.route('/enfermeros/buscar', methods=['GET'])
def buscar_enfermeros():
    texto = request.args.get('q', '').strip()
    especialidad = request.args.get('especialidad', '').strip()
    ciudad = request.args.get('ciudad', '').strip()
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

    query = Enfermero.query.join(Usuario, Enfermero.usuario_id == Usuario.id).filter(
        # HU3: "Solo se muestran enfermeros disponibles"; HU9: aparecen al validar la matrícula.
        Enfermero.disponible.is_(True),
        Enfermero.verificado.is_(True),
    )

    if texto:
        patron = f"%{texto}%"
        query = query.filter(
            or_(
                Enfermero.nombre.ilike(patron),
                Enfermero.apellido.ilike(patron),
                Enfermero.especialidad.ilike(patron),
                Enfermero.ciudad.ilike(patron),
                Enfermero.direccion.ilike(patron)
            )
        )

    if especialidad:
        query = query.filter(Enfermero.especialidad.ilike(f"%{especialidad}%"))

    if ciudad:
        query = query.filter(Enfermero.ciudad.ilike(f"%{ciudad}%"))

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

    query = query.distinct()
    paginacion = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

    resultados = []
    for enf in paginacion.items:
        datos_enf = enf.to_dict()
        datos_enf['email'] = enf.usuario.email if enf.usuario else None
        datos_enf['horarios'] = [d.to_dict() for d in enf.disponibilidades]
        resultados.append(datos_enf)

    return jsonify({
        "pagina_actual": paginacion.page,
        "por_pagina": paginacion.per_page,
        "total_resultados": paginacion.total,
        "total_paginas": paginacion.pages,
        "enfermeros": resultados
    }), 200
