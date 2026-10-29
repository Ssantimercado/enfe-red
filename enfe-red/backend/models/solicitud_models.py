from datetime import datetime, timedelta

from database import db
from models.servicio_models import DURACION_POR_DEFECTO, Servicio
from models.usuario_models import Enfermero, Paciente


ESTADOS_ACTIVOS = ('Pendiente', 'Aceptada')
# 'Vencida': quedó Pendiente y llegó la hora del turno sin respuesta del enfermero.
ESTADOS_SOLICITUD = (*ESTADOS_ACTIVOS, 'Rechazada', 'Cancelada', 'Realizada', 'Vencida')
# schema_mejoras.py recrea la restricción en bases existentes con este mismo texto.
CHECK_ESTADO_SOLICITUD = 'estado IN (' + ', '.join(f"'{estado}'" for estado in ESTADOS_SOLICITUD) + ')'
MAX_MOTIVO_CANCELACION = 200


# El enfermero ve el punto de atención mientras el turno está en curso; al cerrarse se borra.
SIN_UBICACION = {'latitudAtencion': None, 'longitudAtencion': None}


class SolicitudServicio(db.Model):
    """Pedido de un paciente; conserva los nombres de campos del diagrama."""

    __tablename__ = 'solicitudes_servicio'
    __table_args__ = (
        db.CheckConstraint(CHECK_ESTADO_SOLICITUD, name='ck_solicitud_estado'),
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
    # Quién canceló: 'paciente', 'enfermero' o 'administrador' (al suspender una cuenta).
    canceladaPor = db.Column(db.String(20), nullable=True)
    motivoCancelacion = db.Column(db.String(MAX_MOTIVO_CANCELACION), nullable=True)
    # Punto del mapa donde se recibe la atención: el paciente lo marca al pedir el turno.
    # Las solicitudes anteriores a esta mejora no lo tienen.
    latitudAtencion = db.Column(db.Float, nullable=True)
    longitudAtencion = db.Column(db.Float, nullable=True)
    # Pago de la atención, sin pasarela: el paciente avisa que pagó y el enfermero confirma que le llegó.
    # La confirmación del enfermero es la que cierra la atención (pasa a Realizada).
    pagoInformadoEn = db.Column(db.DateTime, nullable=True)
    pagoConfirmadoEn = db.Column(db.DateTime, nullable=True)

    paciente = db.relationship(Paciente)
    enfermero = db.relationship(Enfermero)
    servicio = db.relationship(Servicio)

    def contacto_enfermero(self):
        """Teléfono y email del enfermero: el paciente los ve solo con la solicitud Aceptada."""
        if self.estado != 'Aceptada':
            return None
        usuario = self.enfermero.usuario
        if usuario is None or usuario.eliminado:
            return None
        return {'telefono': self.enfermero.telefono, 'email': usuario.email}

    def ubicacion_atencion(self):
        """El punto solo viaja mientras el turno está en curso: después nadie necesita saber dónde vive el paciente."""
        if self.estado not in ESTADOS_ACTIVOS or self.latitudAtencion is None or self.longitudAtencion is None:
            return None
        return {'latitud': self.latitudAtencion, 'longitud': self.longitudAtencion}

    def olvidar_ubicacion(self):
        self.latitudAtencion = self.longitudAtencion = None

    def hora_fin(self):
        minutos = (self.servicio.duracionMinutos if self.servicio else None) or DURACION_POR_DEFECTO
        return datetime.combine(self.fecha, self.hora) + timedelta(minutes=minutos)

    def to_dict(self):
        """Comprobante compartido por el detalle y las dos bandejas.

        El enfermero ve el teléfono del paciente (lo consiente en la política de privacidad);
        el contacto del enfermero va en 'contacto' y solo con el pedido Aceptado.
        """
        return {
            'idSolicitud': self.idSolicitud,
            'idPaciente': self.idPaciente,
            'idEnfermero': self.idEnfermero,
            'idServicio': self.idServicio,
            'fecha': self.fecha.isoformat(),
            'hora': self.hora.strftime('%H:%M'),
            'horaFin': self.hora_fin().strftime('%H:%M'),
            'estado': self.estado,
            'canceladaPor': self.canceladaPor,
            'motivoCancelacion': self.motivoCancelacion,
            'direccionAtencion': self.direccionAtencion,
            'ubicacionAtencion': self.ubicacion_atencion(),
            'pagoInformadoEn': self.pagoInformadoEn.isoformat(timespec='minutes') if self.pagoInformadoEn else None,
            'pagoConfirmadoEn': self.pagoConfirmadoEn.isoformat(timespec='minutes') if self.pagoConfirmadoEn else None,
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
            },
            'servicio': self.servicio.to_dict(),
            'contacto': self.contacto_enfermero(),
        }
