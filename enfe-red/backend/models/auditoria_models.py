"""Registro de las acciones de los administradores (quién hizo qué y cuándo)."""
from datetime import datetime, timezone

from database import db

MAX_DETALLE = 255
ACCIONES_AUDITORIA = (
    'suspender_usuario', 'reactivar_usuario', 'aprobar_matricula', 'rechazar_matricula',
    'ocultar_resena', 'mostrar_resena',
)


def _ahora_utc():
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


class AuditoriaAdmin(db.Model):
    __tablename__ = 'auditoria_admin'
    __table_args__ = (
        db.Index('ix_auditoria_fecha', 'fecha', 'idAuditoria'),
    )

    idAuditoria = db.Column(db.Integer, primary_key=True)
    idAdmin = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False)
    accion = db.Column(db.String(30), nullable=False)
    # 'usuario', 'enfermero' o 'resena', con el id correspondiente.
    tipoObjetivo = db.Column(db.String(20), nullable=False)
    idObjetivo = db.Column(db.Integer, nullable=False)
    # Texto corto para entender la acción; nunca lleva datos de salud ni el texto de una reseña.
    detalle = db.Column(db.String(MAX_DETALLE), nullable=True)
    fecha = db.Column(db.DateTime, nullable=False, default=_ahora_utc)

    def to_dict(self, admin=None):
        return {
            'idAuditoria': self.idAuditoria,
            'idAdmin': self.idAdmin,
            'adminEmail': admin.email if admin else None,
            'accion': self.accion,
            'tipoObjetivo': self.tipoObjetivo,
            'idObjetivo': self.idObjetivo,
            'detalle': self.detalle,
            'fecha': self.fecha.isoformat(timespec='seconds') + 'Z',
        }


def registrar_auditoria(id_admin, accion, tipo_objetivo, id_objetivo, detalle=None):
    """Agrega el registro a la transacción en curso: se guarda junto con la acción o no se guarda."""
    if accion not in ACCIONES_AUDITORIA:
        raise ValueError(f'Acción de auditoría no admitida: {accion}')
    registro = AuditoriaAdmin(
        idAdmin=id_admin, accion=accion, tipoObjetivo=tipo_objetivo, idObjetivo=id_objetivo,
        detalle=(detalle or None) and detalle[:MAX_DETALLE],
    )
    db.session.add(registro)
    return registro
