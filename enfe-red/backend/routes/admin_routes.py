"""SCRUM-68 a SCRUM-70: funciones de administración con autorización JWT."""
from decimal import Decimal, InvalidOperation
from functools import wraps
import math

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from sqlalchemy import and_, case, func, or_
from sqlalchemy.exc import SQLAlchemyError

from database import db
from models.acceso_models import ahora_utc
from models.auditoria_models import ACCIONES_AUDITORIA, AuditoriaAdmin, registrar_auditoria
from models.calificacion_models import MAX_MOTIVO_MODERACION, Calificacion, recalcular_promedio
from models.notificacion_models import MAX_MENSAJE, notificar
from models.servicio_models import MAX_DESCRIPCION_SERVICIO, MAX_TIPO_SERVICIO, Servicio, enfermero_servicios
from models.solicitud_models import ESTADOS_SOLICITUD, SolicitudServicio
from models.usuario_models import (
    MAX_MOTIVO_RECHAZO, PREFIJO_MATRICULA_TEMPORAL, Enfermero, Paciente, Usuario,
)
from routes.resena_routes import resena_dict
from services.turnos import ahora_local, cancelar_por_suspension, enviar_correos, nombre_completo


admin_bp = Blueprint('admin', __name__)


def admin_required(func):
    @wraps(func)
    @jwt_required()
    def wrapper(*args, **kwargs):
        try:
            usuario = db.session.get(Usuario, int(get_jwt_identity()))
        except (TypeError, ValueError):
            usuario = None
        claims = get_jwt()
        if (usuario is None or usuario.suspendido or usuario.rol != 'administrador'
                or claims.get('rol') != 'administrador' or not usuario.nivelPermiso
                or claims.get('nivelPermiso') != usuario.nivelPermiso):
            return jsonify(error='Se requiere una cuenta administradora activa'), 403
        return func(*args, **kwargs)
    return wrapper


# Una cuenta eliminada por su titular queda anonimizada y suspendida para siempre.
MENSAJE_CUENTA_ELIMINADA = 'Esta cuenta fue eliminada por su titular y no se puede reactivar'


NIVEL_PERMISO_TOTAL = 'total'
MIN_MOTIVO = 5
FILTROS_RESENAS = ('todas', 'denunciadas', 'ocultas')
DENUNCIA_PENDIENTE = and_(Calificacion.denunciada.is_(True), Calificacion.denunciaRevisada.is_(False))


def _admin_actual():
    return db.session.get(Usuario, int(get_jwt_identity()))


def _paginacion(por_defecto=10):
    """Devuelve (página, por página) o lanza ValueError."""
    pagina = max(1, int(request.args.get('page', 1)))
    por_pagina = min(50, max(1, int(request.args.get('per_page', por_defecto))))
    return pagina, por_pagina


def _total_paginas(total, por_pagina):
    return math.ceil(total / por_pagina) if total else 0


def _motivo(data):
    motivo = data.get('motivo') if isinstance(data, dict) else None
    return motivo.strip() if isinstance(motivo, str) else ''


def _matricula_sin_cargar(enfermero):
    return (enfermero.matricula or '').startswith(PREFIJO_MATRICULA_TEMPORAL)


def _pendientes_de_revision():
    return Enfermero.query.filter(
        Enfermero.usuario.has(Usuario.eliminado.is_(False)),
        Enfermero.verificado.is_(False),
        Enfermero.matricula_rechazada.is_(False),
        ~Enfermero.matricula.startswith(PREFIJO_MATRICULA_TEMPORAL),
    )


def _datos_usuario(usuario, paciente=None, enfermero=None):
    perfil = paciente or enfermero
    datos = {
        'id': usuario.id,
        'email': usuario.email,
        'rol': usuario.rol,
        'suspendido': bool(usuario.suspendido),
        'eliminado': bool(usuario.eliminado),
        'nombre': perfil.nombre if perfil else None,
        'apellido': perfil.apellido if perfil else None,
    }
    if enfermero:
        datos.update(matricula=enfermero.matricula, verificado=bool(enfermero.verificado),
                     **enfermero.datos_verificacion())
    return datos


def _aplicar_suspension(usuario, suspendido):
    """Suspender también cancela sus turnos activos y avisa a la otra parte, en la misma transacción.

    Devuelve los correos para mandar después del commit.
    """
    usuario.suspendido = suspendido
    return cancelar_por_suspension(usuario, ahora_local()) if suspendido else []


def _cambiar_suspension(usuario, suspendido):
    """Valida, suspende o reactiva y deja constancia. Devuelve (respuesta de error, código) o None."""
    admin = _admin_actual()
    if usuario.eliminado:
        return jsonify(error=MENSAJE_CUENTA_ELIMINADA), 409
    if usuario.id == admin.id and suspendido:
        return jsonify(error='No podés suspender tu propia cuenta'), 400
    if (usuario.rol == 'administrador' and usuario.id != admin.id
            and admin.nivelPermiso != NIVEL_PERMISO_TOTAL):
        # Evita que un administrador de menor nivel deje afuera a otro (o lo reactive).
        return jsonify(error='Solo un administrador con permiso total puede suspender '
                             'o reactivar a otro administrador'), 403
    cambia = bool(usuario.suspendido) != suspendido
    try:
        correos = _aplicar_suspension(usuario, suspendido)
        if cambia:
            detalle = f'Cuenta de {usuario.rol}'
            if suspendido:
                detalle += f'; turnos cancelados: {len(correos)}'
            registrar_auditoria(admin.id, 'suspender_usuario' if suspendido else 'reactivar_usuario',
                                'usuario', usuario.id, detalle)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify(error='No se pudo actualizar el estado del usuario'), 500
    enviar_correos(correos)
    return None


@admin_bp.get('/admin/usuarios')
@admin_required
def buscarUsuario():
    termino = request.args.get('q', '').strip()
    rol = request.args.get('rol', '').strip()
    estado = request.args.get('estado', '').strip().lower()
    try:
        pagina, por_pagina = _paginacion()
    except (TypeError, ValueError):
        return jsonify(error='La paginación no es válida'), 400

    consulta = db.session.query(Usuario, Paciente, Enfermero).outerjoin(
        Paciente, Paciente.usuario_id == Usuario.id
    ).outerjoin(Enfermero, Enfermero.usuario_id == Usuario.id)
    if termino:
        patron = f'%{termino}%'
        consulta = consulta.filter(or_(
            Usuario.email.ilike(patron), Paciente.nombre.ilike(patron),
            Paciente.apellido.ilike(patron), Enfermero.nombre.ilike(patron),
            Enfermero.apellido.ilike(patron), Enfermero.matricula.ilike(patron),
        ))
    if rol:
        if rol not in ('paciente', 'enfermero', 'administrador'):
            return jsonify(error='El rol no es válido'), 400
        consulta = consulta.filter(Usuario.rol == rol)
    if estado:
        if estado not in ('activo', 'suspendido'):
            return jsonify(error='El estado no es válido'), 400
        consulta = consulta.filter(Usuario.suspendido.is_(estado == 'suspendido'))

    total = consulta.with_entities(Usuario.id).count()
    filas = consulta.order_by(Usuario.id).offset((pagina - 1) * por_pagina).limit(por_pagina).all()
    return jsonify({
        'usuarios': [_datos_usuario(usuario, paciente, enfermero)
                     for usuario, paciente, enfermero in filas],
        'total_resultados': total,
        'total_paginas': _total_paginas(total, por_pagina),
    }), 200


@admin_bp.put('/admin/usuarios/<int:idUsuario>/suspension')
@admin_required
def suspenderUsuario(idUsuario):
    data = request.get_json(silent=True)
    suspendido = data.get('suspendido') if isinstance(data, dict) else None
    if not isinstance(suspendido, bool):
        return jsonify(error='El campo suspendido debe ser booleano'), 400
    usuario = db.session.get(Usuario, idUsuario)
    if usuario is None:
        return jsonify(error='Usuario no encontrado'), 404
    error = _cambiar_suspension(usuario, suspendido)
    if error:
        return error
    paciente = Paciente.query.filter_by(usuario_id=usuario.id).first()
    enfermero = Enfermero.query.filter_by(usuario_id=usuario.id).first()
    return jsonify(mensaje='Estado actualizado', usuario=_datos_usuario(usuario, paciente, enfermero)), 200


@admin_bp.put('/admin/usuarios/<int:idUsuario>/estado')
@admin_required
def cambiarEstadoUsuario(idUsuario):
    data = request.get_json(silent=True)
    estado = data.get('estado') if isinstance(data, dict) else None
    if estado not in ('Activo', 'Suspendido'):
        return jsonify(error="El estado debe ser 'Activo' o 'Suspendido'"), 400
    usuario = db.session.get(Usuario, idUsuario)
    if usuario is None:
        return jsonify(error='Usuario no encontrado'), 404
    error = _cambiar_suspension(usuario, estado == 'Suspendido')
    if error:
        return error
    return jsonify(mensaje='Estado actualizado', usuario={
        **_datos_usuario(usuario), 'estado': usuario.estado,
    }), 200


def _texto_rechazo(motivo):
    """Notificación con el motivo; si no entra en el aviso, el texto completo queda en el perfil."""
    inicio, cierre = 'No pudimos verificar tu matrícula. Motivo: ', ' Revisá tus datos en tu perfil.'
    lugar = MAX_MENSAJE - len(inicio) - len(cierre)
    if len(motivo) > lugar:
        motivo = motivo[:lugar - 1].rstrip() + '…'
    return inicio + motivo + cierre


@admin_bp.put('/admin/enfermeros/<int:idEnfermero>/matricula')
@admin_required
def verificarMatricula(idEnfermero):
    data = request.get_json(silent=True)
    verificado = data.get('verificado') if isinstance(data, dict) else None
    if not isinstance(verificado, bool):
        return jsonify(error='El campo verificado debe ser booleano'), 400
    motivo = None if verificado else _motivo(data)
    if not verificado and not MIN_MOTIVO <= len(motivo) <= MAX_MOTIVO_RECHAZO:
        return jsonify(error='Escribí el motivo del rechazo para que el profesional sepa qué corregir '
                             f'(entre {MIN_MOTIVO} y {MAX_MOTIVO_RECHAZO} caracteres).'), 400
    enfermero = db.session.get(Enfermero, idEnfermero)
    if enfermero is None:
        return jsonify(error='Enfermero no encontrado'), 404
    if enfermero.usuario is None or enfermero.usuario.eliminado:
        return jsonify(error=MENSAJE_CUENTA_ELIMINADA), 409
    if verificado and _matricula_sin_cargar(enfermero):
        # HU9: solo se valida una matrícula que el enfermero ya cargó en su perfil.
        return jsonify(error='El enfermero todavía no cargó su matrícula'), 409
    # Un doble toque o un reintento después de un corte no vuelve a avisar, mandar correo ni auditar.
    sin_cambios = (enfermero.verificado and verificado) or (
        not verificado and enfermero.matricula_rechazada and enfermero.motivoRechazo == motivo
    )
    if sin_cambios:
        return jsonify(mensaje='Verificación actualizada', enfermero={
            'idEnfermero': enfermero.id, 'verificado': enfermero.verificado,
            **enfermero.datos_verificacion(), 'turnosCancelados': 0,
        }), 200
    admin = _admin_actual()
    enfermero.verificado = verificado
    enfermero.matricula_rechazada = not verificado
    enfermero.motivoRechazo = motivo
    enfermero.verificadoPor = admin.id
    enfermero.verificadoEn = ahora_utc().replace(microsecond=0)
    try:
        if verificado:
            notificar(enfermero.usuario_id, 'matricula',
                      'El equipo de Enfered verificó tu matrícula. Ya podés aparecer en la cartilla '
                      'y aceptar solicitudes.')
            correos = []
            texto_correo = 'Verificamos tu matrícula. Ya podés recibir y aceptar solicitudes de pacientes.'
        else:
            notificar(enfermero.usuario_id, 'matricula', _texto_rechazo(motivo))
            # Sin matrícula válida no puede atender: se cancelan sus turnos como al suspender.
            correos = cancelar_por_suspension(enfermero.usuario, ahora_local())
            # El motivo no va en el correo: lo escribe una persona y puede tener datos personales.
            texto_correo = ('No pudimos verificar tu matrícula. Entrá a tu cuenta para ver el motivo '
                            'y corregir tus datos.')
        cancelados = len(correos)
        correos.insert(0, (enfermero.usuario, 'Revisamos tu matrícula en Enfered', texto_correo))
        detalle = f'Matrícula {enfermero.matricula}'
        if not verificado:
            detalle += f'; turnos cancelados: {cancelados}; motivo: {motivo}'
        registrar_auditoria(admin.id, 'aprobar_matricula' if verificado else 'rechazar_matricula',
                            'enfermero', enfermero.id, detalle)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo actualizar la matrícula')
        return jsonify(error='No se pudo actualizar la matrícula'), 500
    enviar_correos(correos)
    return jsonify(mensaje='Verificación actualizada', enfermero={
        'idEnfermero': enfermero.id, 'verificado': enfermero.verificado,
        **enfermero.datos_verificacion(), 'turnosCancelados': cancelados,
    }), 200


@admin_bp.get('/admin/enfermeros/pendientes')
@admin_required
def enfermerosPendientes():
    # Las matrículas temporales (PENDIENTE-<id>) no se listan hasta que el enfermero las cargue.
    pendientes = _pendientes_de_revision().order_by(Enfermero.id).all()
    return jsonify(enfermeros=[{
        'idEnfermero': enfermero.id,
        'usuarioId': enfermero.usuario_id,
        'nombre': enfermero.nombre,
        'apellido': enfermero.apellido,
        'email': enfermero.usuario.email if enfermero.usuario else '',
        'matricula': enfermero.matricula,
        'especialidad': enfermero.especialidad,
        # Si antes se rechazó o se aprobó, queda a la vista quién y cuándo lo revisó.
        **enfermero.datos_verificacion(),
    } for enfermero in pendientes]), 200


@admin_bp.get('/admin/metricas')
@admin_bp.get('/admin/resumen')
@admin_required
def resumenAdmin():
    total_usuarios = Usuario.query.count()
    usuarios_activos = Usuario.query.filter_by(suspendido=False).count()
    pendientes = _pendientes_de_revision().count()
    realizados = SolicitudServicio.query.filter_by(estado='Realizada').count()
    conteo_estados = dict(db.session.query(
        SolicitudServicio.estado, func.count(SolicitudServicio.idSolicitud),
    ).group_by(SolicitudServicio.estado).all())
    denunciadas = Calificacion.query.filter(DENUNCIA_PENDIENTE).count()
    return jsonify({
        'total_usuarios': total_usuarios,
        'usuarios_activos': usuarios_activos,
        'usuariosActivos': usuarios_activos,
        'pacientes': Usuario.query.filter_by(rol='paciente').count(),
        'enfermeros': Usuario.query.filter_by(rol='enfermero').count(),
        'usuarios_suspendidos': Usuario.query.filter_by(suspendido=True).count(),
        'matriculas_pendientes': pendientes,
        'enfermerosPendientes': pendientes,
        'total_solicitudes': SolicitudServicio.query.count(),
        'servicios_realizados': realizados,
        'serviciosRealizados': realizados,
        'servicios_catalogo': Servicio.query.filter(Servicio.activo.is_(True)).count(),
        'solicitudes_por_estado': {estado: conteo_estados.get(estado, 0) for estado in ESTADOS_SOLICITUD},
        'resenas_denunciadas': denunciadas,
        'resenasDenunciadas': denunciadas,
    }), 200


def _resena_admin(calificacion, paciente, enfermero):
    # El administrador ve el comentario completo para moderarlo, pero no datos de contacto del autor.
    return {
        **resena_dict(calificacion, paciente),
        'enfermero': {
            'idEnfermero': enfermero.id, 'usuarioId': enfermero.usuario_id,
            'nombre': enfermero.nombre, 'apellido': enfermero.apellido,
        },
        'oculta': bool(calificacion.oculta),
        'motivoOcultamiento': calificacion.motivoOcultamiento,
        'denunciada': bool(calificacion.denunciada),
        'motivoDenuncia': calificacion.motivoDenuncia,
        'denunciaPendiente': bool(calificacion.denunciada and not calificacion.denunciaRevisada),
    }


@admin_bp.get('/admin/resenas')
@admin_required
def listarResenas():
    filtro = request.args.get('filtro', '').strip().lower() or 'todas'
    if filtro not in FILTROS_RESENAS:
        return jsonify(error='El filtro no es válido'), 400
    try:
        pagina, por_pagina = _paginacion()
    except (TypeError, ValueError):
        return jsonify(error='La paginación no es válida'), 400
    # Solo reseñas de pacientes a enfermeros (las calificaciones viejas al revés no se muestran).
    consulta = db.session.query(Calificacion, Paciente, Enfermero).join(
        Enfermero, Enfermero.usuario_id == Calificacion.idUsuarioCalificado,
    ).outerjoin(Paciente, Paciente.usuario_id == Calificacion.idUsuarioAutor)
    if filtro == 'denunciadas':
        consulta = consulta.filter(Calificacion.denunciada.is_(True))
    elif filtro == 'ocultas':
        consulta = consulta.filter(Calificacion.oculta.is_(True))
    total = consulta.with_entities(Calificacion.idCalificacion).count()
    # Primero las denuncias sin revisar, después las ya revisadas y al final el resto.
    prioridad = case((DENUNCIA_PENDIENTE, 0), (Calificacion.denunciada.is_(True), 1), else_=2)
    filas = consulta.order_by(prioridad, Calificacion.idCalificacion.desc()).offset(
        (pagina - 1) * por_pagina).limit(por_pagina).all()
    return jsonify({
        'resenas': [_resena_admin(*fila) for fila in filas],
        'total_resultados': total,
        'total_paginas': _total_paginas(total, por_pagina),
        'denunciadas_pendientes': Calificacion.query.filter(DENUNCIA_PENDIENTE).count(),
    }), 200


@admin_bp.put('/admin/resenas/<int:idResena>/visibilidad')
@admin_required
def cambiarVisibilidadResena(idResena):
    data = request.get_json(silent=True)
    oculta = data.get('oculta') if isinstance(data, dict) else None
    if not isinstance(oculta, bool):
        return jsonify(error='El campo oculta debe ser booleano'), 400
    if data.get('motivo') is not None and not isinstance(data['motivo'], str):
        return jsonify(error='El motivo debe ser texto'), 400
    motivo = _motivo(data)
    if oculta and not MIN_MOTIVO <= len(motivo) <= MAX_MOTIVO_MODERACION:
        return jsonify(error='Escribí por qué ocultás la reseña '
                             f'(entre {MIN_MOTIVO} y {MAX_MOTIVO_MODERACION} caracteres).'), 400
    if len(motivo) > MAX_MOTIVO_MODERACION:
        return jsonify(error=f'El motivo puede tener hasta {MAX_MOTIVO_MODERACION} caracteres.'), 400
    calificacion = db.session.get(Calificacion, idResena)
    enfermero = calificacion and Enfermero.query.filter_by(usuario_id=calificacion.idUsuarioCalificado).first()
    if not enfermero:
        return jsonify(error='Reseña no encontrada'), 404
    admin = _admin_actual()
    calificacion.oculta = oculta
    calificacion.motivoOcultamiento = motivo if oculta else None
    if calificacion.denunciada:
        # La decisión del administrador (ocultarla o dejarla visible) resuelve la denuncia.
        calificacion.denunciaRevisada = True
    try:
        recalcular_promedio(enfermero)
        detalle = (f'Reseña de {calificacion.estrellas} estrellas sobre '
                   f'{nombre_completo(enfermero, "el profesional")}')
        if motivo:
            detalle += f'; motivo: {motivo}'
        registrar_auditoria(admin.id, 'ocultar_resena' if oculta else 'mostrar_resena', 'resena',
                            calificacion.idCalificacion, detalle)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo cambiar la visibilidad de la reseña')
        return jsonify(error='No se pudo actualizar la reseña. Intentá nuevamente.'), 500
    paciente = Paciente.query.filter_by(usuario_id=calificacion.idUsuarioAutor).first()
    return jsonify({
        'mensaje': 'Reseña oculta' if oculta else 'Reseña visible',
        'resena': _resena_admin(calificacion, paciente, enfermero),
        'calificacionPromedio': enfermero.calificacionPromedio,
        'cantidadResenas': enfermero.cantidadResenas or 0,
    }), 200


@admin_bp.get('/admin/auditoria')
@admin_required
def listarAuditoria():
    accion = request.args.get('accion', '').strip()
    if accion and accion not in ACCIONES_AUDITORIA:
        return jsonify(error='La acción no es válida'), 400
    try:
        pagina, por_pagina = _paginacion(por_defecto=20)
    except (TypeError, ValueError):
        return jsonify(error='La paginación no es válida'), 400
    consulta = db.session.query(AuditoriaAdmin, Usuario).outerjoin(Usuario, Usuario.id == AuditoriaAdmin.idAdmin)
    if accion:
        consulta = consulta.filter(AuditoriaAdmin.accion == accion)
    total = consulta.with_entities(AuditoriaAdmin.idAuditoria).count()
    # Más reciente primero; el id desempata acciones del mismo segundo.
    filas = consulta.order_by(AuditoriaAdmin.fecha.desc(), AuditoriaAdmin.idAuditoria.desc()).offset(
        (pagina - 1) * por_pagina).limit(por_pagina).all()
    return jsonify({
        'registros': [registro.to_dict(admin) for registro, admin in filas],
        'total_resultados': total,
        'total_paginas': _total_paginas(total, por_pagina),
    }), 200


# SCRUM-30/50: gestión del catálogo de servicios (Servicio.actualizarPrecio / modificarDescripcion).
MIN_TIPO_SERVICIO = 3
DURACION_MINIMA, DURACION_MAXIMA = 15, 480
PRECIO_MAXIMO = Decimal('99999999.99')


def _datos_servicio(data, servicio=None):
    """Valida el cuerpo de alta o edición. Devuelve (campos, None) o (None, mensaje de error)."""
    if not isinstance(data, dict):
        return None, 'Datos inválidos'
    campos = {}
    if 'tipoServicio' in data or servicio is None:
        tipo = data.get('tipoServicio')
        tipo = ' '.join(tipo.split()) if isinstance(tipo, str) else ''
        if not MIN_TIPO_SERVICIO <= len(tipo) <= MAX_TIPO_SERVICIO:
            return None, f'El nombre del servicio tiene que tener entre {MIN_TIPO_SERVICIO} y {MAX_TIPO_SERVICIO} caracteres.'
        repetido = Servicio.query.filter(func.lower(Servicio.tipoServicio) == tipo.lower())
        if servicio is not None:
            repetido = repetido.filter(Servicio.idServicio != servicio.idServicio)
        if repetido.first():
            return None, 'Ya existe un servicio con ese nombre.'
        campos['tipoServicio'] = tipo
    if 'descripcion' in data:
        descripcion = data['descripcion']
        if descripcion is not None and not isinstance(descripcion, str):
            return None, 'La descripción tiene que ser texto.'
        descripcion = (descripcion or '').strip()
        if len(descripcion) > MAX_DESCRIPCION_SERVICIO:
            return None, f'La descripción puede tener hasta {MAX_DESCRIPCION_SERVICIO} caracteres.'
        campos['descripcion'] = descripcion
    if 'precioEstimado' in data:
        precio = data['precioEstimado']
        if precio is None or precio == '':
            # Sin precio de referencia el paciente ve "A consultar".
            campos['precioEstimado'] = None
        else:
            try:
                if isinstance(precio, bool):
                    raise InvalidOperation()
                precio = Decimal(str(precio)).quantize(Decimal('0.01'))
                if not precio.is_finite() or not 0 <= precio <= PRECIO_MAXIMO:
                    raise InvalidOperation()
            except (InvalidOperation, ValueError):
                return None, 'El precio tiene que ser un número mayor o igual a cero.'
            campos['precioEstimado'] = precio
    if 'duracionMinutos' in data:
        duracion = data['duracionMinutos']
        if isinstance(duracion, bool) or not isinstance(duracion, int) or not DURACION_MINIMA <= duracion <= DURACION_MAXIMA:
            return None, f'La duración tiene que ser de {DURACION_MINIMA} a {DURACION_MAXIMA} minutos.'
        campos['duracionMinutos'] = duracion
    if 'activo' in data:
        if not isinstance(data['activo'], bool):
            return None, 'El campo activo debe ser verdadero o falso.'
        campos['activo'] = data['activo']
    return campos, None


def _servicio_admin(servicio):
    datos = servicio.to_dict()
    datos['enfermerosQueLoOfrecen'] = db.session.query(func.count()).select_from(enfermero_servicios).filter(
        enfermero_servicios.c.idServicio == servicio.idServicio).scalar()
    datos['solicitudes'] = SolicitudServicio.query.filter_by(idServicio=servicio.idServicio).count()
    return datos


@admin_bp.get('/admin/servicios')
@admin_required
def listarServiciosAdmin():
    # Los activos primero; los dados de baja quedan visibles para poder reactivarlos.
    servicios = Servicio.query.order_by(Servicio.activo.desc(), Servicio.tipoServicio, Servicio.idServicio).all()
    return jsonify({'servicios': [_servicio_admin(servicio) for servicio in servicios]}), 200


@admin_bp.post('/admin/servicios')
@admin_required
def crearServicio():
    campos, error = _datos_servicio(request.get_json(silent=True))
    if error:
        return jsonify(error=error), 400
    servicio = Servicio(activo=True, **campos)
    try:
        db.session.add(servicio)
        db.session.flush()
        registrar_auditoria(_admin_actual().id, 'crear_servicio', 'servicio', servicio.idServicio,
                            f'Servicio "{servicio.tipoServicio}"')
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo crear el servicio')
        return jsonify(error='No se pudo crear el servicio. Intentá nuevamente.'), 500
    return jsonify({'mensaje': 'Servicio creado', 'servicio': _servicio_admin(servicio)}), 201


@admin_bp.put('/admin/servicios/<int:idServicio>')
@admin_required
def editarServicio(idServicio):
    servicio = db.session.get(Servicio, idServicio)
    if not servicio:
        return jsonify(error='Servicio no encontrado'), 404
    campos, error = _datos_servicio(request.get_json(silent=True), servicio)
    if error:
        return jsonify(error=error), 400
    if not campos:
        return jsonify(error='No hay cambios para guardar'), 400
    cambio_estado = 'activo' in campos and campos['activo'] != (servicio.activo is not False)
    if 'precioEstimado' in campos:
        servicio.actualizarPrecio(campos.pop('precioEstimado'))
    if 'descripcion' in campos:
        servicio.modificarDescripcion(campos.pop('descripcion'))
    for campo, valor in campos.items():
        setattr(servicio, campo, valor)
    if cambio_estado:
        accion = 'alta_servicio' if servicio.activo else 'baja_servicio'
    else:
        accion = 'editar_servicio'
    try:
        registrar_auditoria(_admin_actual().id, accion, 'servicio', servicio.idServicio,
                            f'Servicio "{servicio.tipoServicio}"')
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo actualizar el servicio')
        return jsonify(error='No se pudo guardar el servicio. Intentá nuevamente.'), 500
    mensaje = {'alta_servicio': 'Servicio disponible de nuevo', 'baja_servicio': 'Servicio dado de baja'}
    return jsonify({'mensaje': mensaje.get(accion, 'Servicio actualizado'),
                    'servicio': _servicio_admin(servicio)}), 200
