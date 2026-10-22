"""Límites de intentos y códigos de recuperación guardados en la base.

Viven en tablas (y no en memoria) para que valgan igual con varios procesos del servidor
y no se pierdan al reiniciarlo.
"""
from datetime import datetime, timezone

from database import db


def ahora_utc():
    # UTC sin zona, igual que el resto de las fechas guardadas en SQL.
    return datetime.now(timezone.utc).replace(tzinfo=None)


class IntentoAcceso(db.Model):
    __tablename__ = 'intentos_acceso'
    __table_args__ = (
        db.Index('ix_intento_tipo_clave_fecha', 'tipo', 'clave', 'fecha'),
    )

    id = db.Column(db.Integer, primary_key=True)
    # Qué se limita: login_email, login_ip, registro_ip, recuperacion_codigo, etc.
    tipo = db.Column(db.String(30), nullable=False)
    # Hash del email o de la IP: alcanza para contar sin guardar el dato personal.
    clave = db.Column(db.String(64), nullable=False)
    fecha = db.Column(db.DateTime, nullable=False, default=ahora_utc, index=True)


class CodigoRecuperacion(db.Model):
    __tablename__ = 'codigos_recuperacion'

    id = db.Column(db.Integer, primary_key=True)
    # Un solo código vigente por cuenta: pedir otro reemplaza al anterior.
    usuario_id = db.Column(
        db.Integer, db.ForeignKey('usuarios.id', ondelete='CASCADE'), nullable=False, unique=True
    )
    codigo_hash = db.Column(db.String(64), nullable=False)
    vence = db.Column(db.DateTime, nullable=False)
    intentos = db.Column(db.Integer, nullable=False, default=0, server_default='0')
