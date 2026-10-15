from database import db
from models.servicio_models import Servicio
from models.usuario_models import Enfermero, Paciente


ESTADOS_ACTIVOS = ('Pendiente', 'Aceptada')
ESTADOS_SOLICITUD = (*ESTADOS_ACTIVOS, 'Rechazada', 'Cancelada', 'Realizada')


class SolicitudServicio(db.Model):
    """Pedido de un paciente; conserva los nombres de campos del diagrama."""

    __tablename__ = 'solicitudes_servicio'
    __table_args__ = (
        db.CheckConstraint(
            db.column('estado').in_(ESTADOS_SOLICITUD),
            name='ck_solicitud_estado',
        ),
        db.Index('ix_solicitud_paciente_estado_fecha', 'idPaciente', 'estado', 'fecha'),
        db.Index('ix_solicitud_enfermero_fecha', 'idEnfermero', 'fecha'),
    )

    idSolicitud = db.Column(db.Integer, primary_key=True)
    idPaciente = db.Column(db.Integer, db.ForeignKey('pacientes.id'), nullable=False)
    idEnfermero = db.Column(db.Integer, db.ForeignKey('enfermeros.id'), nullable=False)
    idServicio = db.Column(db.Integer, db.ForeignKey('servicios.idServicio'), nullable=False)
    fecha = db.Column(db.Date, nullable=False)
    hora = db.Column(db.Time, nullable=False)
    estado = db.Column(db.String(20), nullable=False, default='Pendiente', server_default='Pendiente')
    direccionAtencion = db.Column(db.String(200), nullable=False)

    paciente = db.relationship(Paciente)
    enfermero = db.relationship(Enfermero)
    servicio = db.relationship(Servicio)

    def to_dict(self):
        """Comprobante compartido por el detalle y las dos bandejas."""
        return {
            'idSolicitud': self.idSolicitud,
            'idPaciente': self.idPaciente,
            'idEnfermero': self.idEnfermero,
            'idServicio': self.idServicio,
            'fecha': self.fecha.isoformat(),
            'hora': self.hora.strftime('%H:%M'),
            'estado': self.estado,
            'direccionAtencion': self.direccionAtencion,
            'paciente': {
                'idPaciente': self.paciente.id,
                'nombre': self.paciente.nombre,
                'apellido': self.paciente.apellido,
                'telefono': self.paciente.telefono,
            },
            'enfermero': {
                'idEnfermero': self.enfermero.id,
                'nombre': self.enfermero.nombre,
                'apellido': self.enfermero.apellido,
                'matricula': self.enfermero.matricula,
                'especialidad': self.enfermero.especialidad,
                'telefono': self.enfermero.telefono,
            },
            'servicio': self.servicio.to_dict(),
        }
