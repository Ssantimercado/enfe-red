from database import db

# Minutos que ocupa un turno si el servicio no dice otra cosa (bases existentes incluidas).
DURACION_POR_DEFECTO = 60
MAX_TIPO_SERVICIO = 100
MAX_DESCRIPCION_SERVICIO = 255

# SCRUM-14/53: qué servicios del catálogo ofrece cada enfermero (para filtrar la cartilla).
enfermero_servicios = db.Table(
    'enfermero_servicios',
    db.Column('enfermero_id', db.Integer, db.ForeignKey('enfermeros.id', ondelete='CASCADE'),
              primary_key=True),
    db.Column('idServicio', db.Integer, db.ForeignKey('servicios.idServicio', ondelete='CASCADE'),
              primary_key=True),
)


class Servicio(db.Model):
    """Tipo de atención y precio estimado del catálogo de servicios."""

    __tablename__ = 'servicios'
    __table_args__ = (
        db.CheckConstraint('precioEstimado >= 0', name='ck_servicio_precio_no_negativo'),
    )

    idServicio = db.Column(db.Integer, primary_key=True)
    tipoServicio = db.Column(db.String(MAX_TIPO_SERVICIO), nullable=False)
    descripcion = db.Column(db.String(MAX_DESCRIPCION_SERVICIO), nullable=True)
    precioEstimado = db.Column(db.Numeric(10, 2), nullable=True)
    # Define el fin del turno para detectar superposiciones y validar la agenda del enfermero.
    duracionMinutos = db.Column(db.Integer, nullable=False, default=DURACION_POR_DEFECTO,
                                server_default=str(DURACION_POR_DEFECTO))
    # SCRUM-30/50: el administrador da de baja un servicio sin borrarlo (las solicitudes viejas lo usan).
    activo = db.Column(db.Boolean, nullable=False, default=True, server_default=db.true())

    def actualizarPrecio(self, precio):
        """Método del diagrama de clases: cambia el precio de referencia del catálogo."""
        self.precioEstimado = precio

    def modificarDescripcion(self, descripcion):
        """Método del diagrama de clases: cambia el texto que ve el paciente al elegir el servicio."""
        self.descripcion = descripcion

    def to_dict_resumen(self):
        return {'idServicio': self.idServicio, 'tipoServicio': self.tipoServicio}

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
            'activo': self.activo is not False,
        }
