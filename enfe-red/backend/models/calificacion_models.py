from database import db


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

    def to_dict(self):
        return {
            'idCalificacion': self.idCalificacion,
            'idSolicitud': self.idSolicitud,
            'idUsuarioAutor': self.idUsuarioAutor,
            'idUsuarioCalificado': self.idUsuarioCalificado,
            'estrellas': self.estrellas,
            'comentario': self.comentario,
        }
