"""Sprint 5 de Germán: historial (SCRUM-62) y mensajes (SCRUM-63)."""
from datetime import datetime, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.usuario_models import Usuario, Paciente, Enfermero
from models.solicitud_models import SolicitudServicio
from models.calificacion_models import Calificacion
from models.mensaje_models import Mensaje
from models.notificacion_models import notificar


comunicacion_bp = Blueprint('comunicacion', __name__)
ESTADOS_HISTORIAL = ('Aceptada', 'Realizada')
ZONA_HORARIA_ARGENTINA = timezone(timedelta(hours=-3))
MAX_CONTENIDO = 2000
MAX_PALABRAS_CALIFICACION = 250


def _usuario_actual():
    try:
        return db.session.get(Usuario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


@comunicacion_bp.get('/usuarios/<int:idUsuario>/historial')
@jwt_required()
def historialSolicitudes(idUsuario):
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    if usuario.id != idUsuario:
        return jsonify(error='Solo podés consultar tu propio historial'), 403
    consulta = SolicitudServicio.query.options(
        joinedload(SolicitudServicio.paciente),
        joinedload(SolicitudServicio.enfermero),
        joinedload(SolicitudServicio.servicio),
    )
    if usuario.rol == 'paciente':
        consulta = consulta.join(Paciente).filter(Paciente.usuario_id == usuario.id)
    elif usuario.rol == 'enfermero':
        consulta = consulta.join(Enfermero).filter(Enfermero.usuario_id == usuario.id)
    else:
        return jsonify(error='Este rol no tiene historial de servicios'), 403
    ahora_local = datetime.now(ZONA_HORARIA_ARGENTINA).replace(tzinfo=None)
    solicitudes = consulta.filter(
        SolicitudServicio.estado.in_(ESTADOS_HISTORIAL),
        or_(
            SolicitudServicio.fecha < ahora_local.date(),
            and_(
                SolicitudServicio.fecha == ahora_local.date(),
                SolicitudServicio.hora <= ahora_local.time(),
            ),
        ),
    ).order_by(
        SolicitudServicio.fecha.desc(), SolicitudServicio.hora.desc(), SolicitudServicio.idSolicitud.desc(),
    ).all()
    items = [solicitud.to_dict() for solicitud in solicitudes]
    ids_solicitudes = [solicitud.idSolicitud for solicitud in solicitudes]
    calificaciones = Calificacion.query.filter(
        Calificacion.idSolicitud.in_(ids_solicitudes),
    ).order_by(Calificacion.idCalificacion).all() if ids_solicitudes else []
    por_solicitud = {item['idSolicitud']: item for item in items}
    for calificacion in calificaciones:
        por_solicitud[calificacion.idSolicitud].setdefault('calificaciones', []).append(
            calificacion.to_dict()
        )
    for item in items:
        item.setdefault('calificaciones', [])
    return jsonify(items), 200


@comunicacion_bp.post('/solicitudes/<int:idSolicitud>/calificaciones')
@jwt_required()
def calificarSolicitud(idSolicitud):
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    if usuario.rol not in ('paciente', 'enfermero'):
        return jsonify(error='Solo un paciente o enfermero puede calificar un servicio'), 403

    solicitud = SolicitudServicio.query.options(
        joinedload(SolicitudServicio.paciente),
        joinedload(SolicitudServicio.enfermero),
    ).filter_by(idSolicitud=idSolicitud).first()
    if not solicitud:
        return jsonify(error='Solicitud no encontrada'), 404
    participante = (
        usuario.rol == 'paciente' and solicitud.paciente.usuario_id == usuario.id
    ) or (
        usuario.rol == 'enfermero' and solicitud.enfermero.usuario_id == usuario.id
    )
    if not participante:
        return jsonify(error='Solo podés calificar servicios en los que participaste'), 403
    if solicitud.estado not in ESTADOS_HISTORIAL:
        return jsonify(error='Solo podés calificar servicios aceptados o realizados'), 409

    ahora_local = datetime.now(ZONA_HORARIA_ARGENTINA).replace(tzinfo=None)
    fecha_hora_servicio = datetime.combine(solicitud.fecha, solicitud.hora)
    if fecha_hora_servicio > ahora_local:
        return jsonify(error='Vas a poder calificar el servicio cuando haya pasado la fecha y hora de atención'), 409

    datos = request.get_json(silent=True)
    if not isinstance(datos, dict) or set(datos) != {'estrellas', 'comentario'}:
        return jsonify(error='Enviá una calificación y un comentario'), 400
    estrellas = datos.get('estrellas')
    if type(estrellas) is not int or not 1 <= estrellas <= 5:
        return jsonify(error='La calificación debe ser un número entero de 1 a 5'), 400
    comentario = datos.get('comentario')
    if not isinstance(comentario, str) or not comentario.strip():
        return jsonify(error='El comentario es obligatorio'), 400
    comentario = comentario.strip()
    if len(comentario.split()) > MAX_PALABRAS_CALIFICACION:
        return jsonify(error=f'El comentario no puede superar las {MAX_PALABRAS_CALIFICACION} palabras'), 400

    if Calificacion.query.filter_by(
        idSolicitud=solicitud.idSolicitud,
        idUsuarioAutor=usuario.id,
    ).first():
        return jsonify(error='Ya calificaste este servicio'), 409

    calificacion = Calificacion(
        idSolicitud=solicitud.idSolicitud,
        idUsuarioAutor=usuario.id,
        idUsuarioCalificado=(
            solicitud.enfermero.usuario_id
            if usuario.rol == 'paciente'
            else solicitud.paciente.usuario_id
        ),
        estrellas=estrellas,
        comentario=comentario,
    )
    try:
        db.session.add(calificacion)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        if Calificacion.query.filter_by(
            idSolicitud=solicitud.idSolicitud,
            idUsuarioAutor=usuario.id,
        ).first():
            return jsonify(error='Ya calificaste este servicio'), 409
        current_app.logger.exception('No se pudo guardar la calificación del servicio')
        return jsonify(error='No se pudo guardar la calificación. Intentá nuevamente.'), 500
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo guardar la calificación del servicio')
        return jsonify(error='No se pudo guardar la calificación. Intentá nuevamente.'), 500
    return jsonify({
        'mensaje': 'Calificación guardada',
        'calificacion': calificacion.to_dict(),
    }), 201


def _notificar_mensaje(solicitud, emisor):
    if emisor.rol == 'paciente':
        perfil, destinatario, alternativo = solicitud.paciente, solicitud.enfermero.usuario_id, 'tu paciente'
    else:
        perfil, destinatario, alternativo = solicitud.enfermero, solicitud.paciente.usuario_id, 'tu enfermero'
    nombre = ' '.join(filter(None, [perfil.nombre, perfil.apellido])) or alternativo
    notificar(destinatario, 'mensaje',
              f'Nuevo mensaje de {nombre} sobre la solicitud #{solicitud.idSolicitud}.',
              solicitud.idSolicitud)


@comunicacion_bp.route('/solicitudes/<int:idSolicitud>/mensajes', methods=['GET', 'POST'])
@jwt_required()
def mensajesSolicitud(idSolicitud):
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    try:
        consulta = SolicitudServicio.query.filter_by(idSolicitud=idSolicitud)
        # Bloquear el pedido durante el envío impide escribir después de que otra
        # transacción haya terminado/cancelado el servicio (MySQL/InnoDB).
        if request.method == 'POST':
            consulta = consulta.with_for_update()
        solicitud = consulta.first()
        if not solicitud:
            return jsonify(error='Solicitud no encontrada'), 404
        participante = (
            usuario.rol == 'paciente' and solicitud.paciente.usuario_id == usuario.id
        ) or (
            usuario.rol == 'enfermero' and solicitud.enfermero.usuario_id == usuario.id
        )
        if not participante:
            return jsonify(error='No tenés acceso a los mensajes de esta solicitud'), 403

        if request.method == 'GET':
            # Los participantes conservan acceso al registro después del cierre;
            # únicamente el envío exige que el servicio esté Aceptado.
            mensajes = Mensaje.query.filter_by(idSolicitud=idSolicitud).order_by(Mensaje.idMensaje).all()
            return jsonify([mensaje.to_dict() for mensaje in mensajes]), 200

        if solicitud.estado != 'Aceptada':
            return jsonify(error='Solo podés enviar mensajes cuando la solicitud está Aceptada'), 409
        datos = request.get_json(silent=True)
        if not isinstance(datos, dict) or set(datos) != {'contenido'}:
            return jsonify(error='Enviá un objeto JSON con el único campo contenido'), 400
        contenido = datos['contenido']
        if not isinstance(contenido, str) or not 1 <= len(contenido.strip()) <= MAX_CONTENIDO:
            return jsonify(error=f'El mensaje debe tener entre 1 y {MAX_CONTENIDO} caracteres'), 400
        mensaje = Mensaje(idSolicitud=idSolicitud, idEmisor=usuario.id, contenido=contenido.strip())
        db.session.add(mensaje)
        db.session.flush()
        resultado = mensaje.to_dict()
        # SCRUM-64.2: avisar al otro participante en la misma transacción.
        _notificar_mensaje(solicitud, usuario)
        db.session.commit()
        return jsonify(resultado), 201
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('Error al procesar mensajes de una solicitud')
        return jsonify(error='No se pudo procesar el mensaje. Intentá nuevamente.'), 500
    finally:
        # También libera el bloqueo en las salidas por validación o permisos.
        if request.method == 'POST':
            db.session.rollback()
