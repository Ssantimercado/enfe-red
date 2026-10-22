from database import db

# Minutos que ocupa un turno si el servicio no dice otra cosa (bases existentes incluidas).
DURACION_POR_DEFECTO = 60


class Servicio(db.Model):
    """Tipo de atención y precio estimado del catálogo de servicios."""

    __tablename__ = 'servicios'
    __table_args__ = (
        db.CheckConstraint('precioEstimado >= 0', name='ck_servicio_precio_no_negativo'),
    )

    idServicio = db.Column(db.Integer, primary_key=True)
    tipoServicio = db.Column(db.String(100), nullable=False)
    descripcion = db.Column(db.String(255), nullable=True)
    precioEstimado = db.Column(db.Numeric(10, 2), nullable=True)
    # Define el fin del turno para detectar superposiciones y validar la agenda del enfermero.
    duracionMinutos = db.Column(db.Integer, nullable=False, default=DURACION_POR_DEFECTO,
                                server_default=str(DURACION_POR_DEFECTO))

    def to_dict(self):
        return {
            'idServicio': self.idServicio,
            'tipoServicio': self.tipoServicio,
            'descripcion': self.descripcion,
            # Decimal como texto para conservar los centavos en el JSON.
            'precioEstimado': (
                format(self.precioEstimado, '.2f')
                if self.precioEstimado is not None else None
            ),
            'duracionMinutos': self.duracionMinutos or DURACION_POR_DEFECTO,
        }
