"""Sprint 5 de Germán: historial (SCRUM-62) y mensajes (SCRUM-63).

Las reseñas (SCRUM-65 a 67) se publican únicamente con POST /api/resenas (resena_routes.py).
"""
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.usuario_models import Usuario, Paciente, Enfermero
from models.solicitud_models import SolicitudServicio
from models.calificacion_models import Calificacion
from models.mensaje_models import Mensaje
from models.notificacion_models import notificar
from services.turnos import ahora_local, vencer_cargadas, vencer_solicitudes


comunicacion_bp = Blueprint('comunicacion', __name__)
# SCRUM-62.1: el historial reúne las solicitudes ya cerradas.
ESTADOS_HISTORIAL = ('Realizada', 'Rechazada', 'Cancelada', 'Vencida')
MAX_CONTENIDO = 2000
# Se puede escribir desde que el paciente pide el turno hasta que el servicio se cierra.
ESTADOS_CHAT_ABIERTO = ('Pendiente', 'Aceptada')


def _usuario_actual():
    try:
        return db.session.get(Usuario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


@comunicacion_bp.get('/usuarios/<int:idUsuario>/historial')
@jwt_required()
def historialSolicitudes(idUsuario):
    """SCRUM-62.1: solicitudes cerradas (Realizada, Rechazada, Cancelada o Vencida) del propio usuario."""
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
        propias = SolicitudServicio.paciente.has(Paciente.usuario_id == usuario.id)
    elif usuario.rol == 'enfermero':
        consulta = consulta.join(Enfermero).filter(Enfermero.usuario_id == usuario.id)
        propias = SolicitudServicio.enfermero.has(Enfermero.usuario_id == usuario.id)
    else:
        return jsonify(error='Este rol no tiene historial de servicios'), 403
    # Las Pendientes cuyo turno ya pasó se cierran como Vencidas antes de armar el historial.
    vencer_solicitudes(ahora_local(), propias)
    solicitudes = consulta.filter(
        SolicitudServicio.estado.in_(ESTADOS_HISTORIAL),
    ).order_by(
        SolicitudServicio.fecha.desc(), SolicitudServicio.hora.desc(), SolicitudServicio.idSolicitud.desc(),
    ).all()
    items = [solicitud.to_dict() for solicitud in solicitudes]
    # Multiplicidad Solicitud 1 — 0..1 Reseña: solo cuenta la reseña del paciente al enfermero.
    autor_por_solicitud = {s.idSolicitud: s.paciente.usuario_id for s in solicitudes}
    calificaciones = Calificacion.query.filter(
        Calificacion.idSolicitud.in_(list(autor_por_solicitud)),
    ).order_by(Calificacion.idCalificacion).all() if autor_por_solicitud else []
    resenas = {
        c.idSolicitud: c.to_dict() for c in calificaciones
        if c.idUsuarioAutor == autor_por_solicitud.get(c.idSolicitud)
    }
    for item in items:
        resena = resenas.get(item['idSolicitud'])
        item['calificaciones'] = [resena] if resena else []
    return jsonify(items), 200


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
            # únicamente el envío exige que el turno siga Pendiente o Aceptado.
            consulta_mensajes = Mensaje.query.filter_by(idSolicitud=idSolicitud)
            desde = request.args.get('desde')
            if desde is not None:
                # ?desde=<idMensaje> trae solo los posteriores: el chat consulta seguido sin bajar todo.
                if not desde.isdigit() or int(desde) > 2147483647:
                    return jsonify(error='El parámetro desde tiene que ser el número de un mensaje'), 400
                consulta_mensajes = consulta_mensajes.filter(Mensaje.idMensaje > int(desde))
            mensajes = consulta_mensajes.order_by(Mensaje.idMensaje).all()
            return jsonify([mensaje.to_dict() for mensaje in mensajes]), 200

        # Una Pendiente cuyo turno ya llegó vence ahora (el vencimiento es perezoso): no se escribe ni se avisa.
        if solicitud.estado == 'Pendiente':
            vencer_cargadas([solicitud], ahora_local())
        if solicitud.estado not in ESTADOS_CHAT_ABIERTO:
            return jsonify(error='La conversación está cerrada: solo se puede escribir mientras el turno '
                                 'está pendiente o aceptado'), 409
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
