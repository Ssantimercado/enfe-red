"""SCRUM-64.1: alertas para el usuario sobre cambios de sus solicitudes y mensajes nuevos."""
from datetime import datetime, timezone

from database import db
from models.solicitud_models import SolicitudServicio  # noqa: F401  (registra la FK)

# 'cancelada': la otra parte (o un administrador al suspender una cuenta) canceló el turno.
# 'matricula': resultado de la revisión de la matrícula del enfermero (sin solicitud).
TIPOS_NOTIFICACION = (
    'aceptada', 'rechazada', 'mensaje', 'cancelada',
    'nueva', 'reprogramada', 'realizada', 'vencida', 'matricula',
)
# schema_mejoras.py recrea la restricción en bases existentes con este mismo texto.
CHECK_TIPO_NOTIFICACION = 'tipo IN (' + ', '.join(f"'{tipo}'" for tipo in TIPOS_NOTIFICACION) + ')'
MAX_MENSAJE = 255


def _ahora_utc():
    # UTC sin zona en SQL; la respuesta agrega Z, igual que Mensaje.fechaHora.
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class Notificacion(db.Model):
    __tablename__ = 'notificaciones'
    __table_args__ = (
        db.CheckConstraint(CHECK_TIPO_NOTIFICACION, name='ck_notificacion_tipo'),
        # La campana lista las del usuario de la más nueva a la más vieja.
        db.Index('ix_notificacion_usuario_orden', 'idUsuario', 'idNotificacion'),
    )

    idNotificacion = db.Column(db.Integer, primary_key=True)
    idUsuario = db.Column(db.Integer, db.ForeignKey('usuarios.id', ondelete='CASCADE'), nullable=False)
    idSolicitud = db.Column(
        db.Integer,
        db.ForeignKey('solicitudes_servicio.idSolicitud', ondelete='CASCADE'),
        nullable=True,
    )
    tipo = db.Column(db.String(20), nullable=False)
    mensaje = db.Column(db.String(MAX_MENSAJE), nullable=False)
    leida = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    fechaHora = db.Column(db.DateTime, nullable=False, default=_ahora_utc)

    def to_dict(self):
        return {
            'idNotificacion': self.idNotificacion,
            'idUsuario': self.idUsuario,
            'idSolicitud': self.idSolicitud,
            'tipo': self.tipo,
            'mensaje': self.mensaje,
            'leida': self.leida,
            'fechaHora': self.fechaHora.isoformat(timespec='seconds') + 'Z',
        }


def notificar(id_usuario, tipo, mensaje, id_solicitud=None):
    """Agregar la alerta a la transacción en curso; quien llama hace el commit.

    Los mensajes de chat no se acumulan: si ya hay un aviso sin leer de esa
    conversación, se actualiza en lugar de crear otro.
    """
    if tipo not in TIPOS_NOTIFICACION:
        raise ValueError(f'Tipo de notificación no admitido: {tipo}')
    texto = mensaje[:MAX_MENSAJE]
    if tipo == 'mensaje':
        pendiente = Notificacion.query.filter_by(
            idUsuario=id_usuario, idSolicitud=id_solicitud, tipo='mensaje', leida=False,
        ).first()
        if pendiente:
            pendiente.mensaje = texto
            pendiente.fechaHora = _ahora_utc()
            return pendiente
    notificacion = Notificacion(idUsuario=id_usuario, idSolicitud=id_solicitud, tipo=tipo, mensaje=texto)
    db.session.add(notificacion)
    return notificacion
