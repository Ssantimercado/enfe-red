"""Sprint 5 de Germán: historial (SCRUM-62) y mensajes (SCRUM-63)."""
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.usuario_models import Usuario, Paciente, Enfermero
from models.solicitud_models import SolicitudServicio
from models.mensaje_models import Mensaje


comunicacion_bp = Blueprint('comunicacion', __name__)
ESTADOS_HISTORIAL = ('Realizada', 'Rechazada', 'Cancelada')
MAX_CONTENIDO = 2000


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
    solicitudes = consulta.filter(SolicitudServicio.estado.in_(ESTADOS_HISTORIAL)).order_by(
        SolicitudServicio.fecha.desc(), SolicitudServicio.hora.desc(), SolicitudServicio.idSolicitud.desc(),
    ).all()
    return jsonify([solicitud.to_dict() for solicitud in solicitudes]), 200


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
