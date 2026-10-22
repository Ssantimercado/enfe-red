"""SCRUM-64.3: consulta y lectura de notificaciones (campana del AppShell)."""
from flask import Blueprint, current_app, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError

from database import db
from models.notificacion_models import Notificacion
from models.usuario_models import Usuario

notificacion_bp = Blueprint('notificacion_bp', __name__)
LIMITE_NOTIFICACIONES = 50


def _usuario_actual():
    try:
        return db.session.get(Usuario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


@notificacion_bp.get('/notificaciones/<int:idUsuario>')
@jwt_required()
def listarNotificaciones(idUsuario):
    """Las últimas notificaciones del propio usuario, de la más nueva a la más vieja."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    if usuario.id != idUsuario:
        return jsonify(error='Solo podés consultar tus propias notificaciones'), 403
    notificaciones = (
        Notificacion.query.filter_by(idUsuario=idUsuario)
        .order_by(Notificacion.idNotificacion.desc())
        .limit(LIMITE_NOTIFICACIONES)
        .all()
    )
    return jsonify([notificacion.to_dict() for notificacion in notificaciones]), 200


@notificacion_bp.put('/notificaciones/leer-todas')
@jwt_required()
def marcarTodasLeidas():
    """Marca como leídas todas las notificaciones pendientes del propio usuario."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    try:
        actualizadas = Notificacion.query.filter_by(idUsuario=usuario.id, leida=False).update(
            {'leida': True}, synchronize_session=False,
        )
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudieron marcar las notificaciones como leídas')
        return jsonify(error='No se pudieron marcar las notificaciones. Intentá nuevamente.'), 500
    return jsonify(mensaje='Notificaciones leídas', actualizadas=actualizadas), 200


@notificacion_bp.put('/notificaciones/<int:idNotificacion>/leer')
@jwt_required()
def marcarNotificacionLeida(idNotificacion):
    """Idempotente: marcar dos veces la misma notificación no es un error."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    notificacion = db.session.get(Notificacion, idNotificacion)
    if not notificacion:
        return jsonify(error='Notificación no encontrada'), 404
    if notificacion.idUsuario != usuario.id:
        return jsonify(error='Solo podés marcar tus propias notificaciones'), 403
    if not notificacion.leida:
        try:
            notificacion.leida = True
            db.session.commit()
        except SQLAlchemyError:
            db.session.rollback()
            current_app.logger.exception('No se pudo marcar la notificación como leída')
            return jsonify(error='No se pudo marcar la notificación. Intentá nuevamente.'), 500
    return jsonify(mensaje='Notificación leída', notificacion=notificacion.to_dict()), 200
