from datetime import datetime, timezone

from database import db
from models.solicitud_models import SolicitudServicio


class Mensaje(db.Model):
    __tablename__ = 'mensajes'
    __table_args__ = (db.Index('ix_mensaje_solicitud_orden', 'idSolicitud', 'idMensaje'),)

    idMensaje = db.Column(db.Integer, primary_key=True)
    idSolicitud = db.Column(db.Integer, db.ForeignKey('solicitudes_servicio.idSolicitud'), nullable=False)
    idEmisor = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    contenido = db.Column(db.Text, nullable=False)
    # UTC sin zona en SQL; la respuesta incluye Z para que el frontend la interprete.
    fechaHora = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc).replace(tzinfo=None))

    solicitud = db.relationship(SolicitudServicio, backref='mensajes')
    emisor = db.relationship('Usuario')

    def to_dict(self):
        return {
            'idMensaje': self.idMensaje,
            'idSolicitud': self.idSolicitud,
            'idEmisor': self.idEmisor,
            'contenido': self.contenido,
            'fechaHora': self.fechaHora.isoformat(timespec='microseconds') + 'Z',
        }
