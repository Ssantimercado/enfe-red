from datetime import datetime, timezone

from sqlalchemy import func

from database import db


def _ahora_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class Calificacion(db.Model):
    __tablename__ = 'calificaciones_servicio'
    __table_args__ = (
        db.UniqueConstraint(
            'idSolicitud',
            'idUsuarioAutor',
            name='uq_calificacion_solicitud_autor',
        ),
        db.CheckConstraint(
            'estrellas BETWEEN 1 AND 5',
            name='ck_calificacion_estrellas',
        ),
        db.Index('ix_calificacion_usuario_calificado', 'idUsuarioCalificado'),
    )

    idCalificacion = db.Column(db.Integer, primary_key=True)
    idSolicitud = db.Column(
        db.Integer,
        db.ForeignKey('solicitudes_servicio.idSolicitud', ondelete='CASCADE'),
        nullable=False,
    )
    idUsuarioAutor = db.Column(
        db.Integer,
        db.ForeignKey('usuarios.id'),
        nullable=False,
    )
    idUsuarioCalificado = db.Column(
        db.Integer,
        db.ForeignKey('usuarios.id'),
        nullable=False,
    )
    estrellas = db.Column(db.Integer, nullable=False)
    comentario = db.Column(db.Text, nullable=False)
    # Reseña.fecha del diagrama de clases; nula en calificaciones previas al Sprint 5.
    fecha = db.Column(db.DateTime, nullable=True, default=_ahora_utc)

    def to_dict(self):
        return {
            'idCalificacion': self.idCalificacion,
            'idSolicitud': self.idSolicitud,
            'idUsuarioAutor': self.idUsuarioAutor,
            'idUsuarioCalificado': self.idUsuarioCalificado,
            'estrellas': self.estrellas,
            'comentario': self.comentario,
            'fecha': self.fecha.isoformat(timespec='seconds') + 'Z' if self.fecha else None,
        }


def recalcular_promedio(enfermero):
    """SCRUM-65.2: promedio y cantidad de las calificaciones recibidas por el enfermero.

    Solo los pacientes califican enfermeros, así que alcanza con filtrar por el
    usuario calificado. Quien llama hace el commit.
    """
    db.session.flush()
    promedio, cantidad = db.session.query(
        func.avg(Calificacion.estrellas), func.count(Calificacion.idCalificacion),
    ).filter(Calificacion.idUsuarioCalificado == enfermero.usuario_id).one()
    enfermero.calificacionPromedio = round(float(promedio), 2) if cantidad else None
    enfermero.cantidadResenas = cantidad
    return enfermero
