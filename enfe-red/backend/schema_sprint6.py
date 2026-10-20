"""Agrega estado de suspensión y nivel de permiso sin recrear usuarios."""
from sqlalchemy import inspect, text

from database import db


def inicializar_bd_sprint6():
    columnas = {columna['name'] for columna in inspect(db.engine).get_columns('usuarios')}
    with db.engine.begin() as connection:
        if 'suspendido' not in columnas:
            connection.execute(text(
                'ALTER TABLE usuarios ADD COLUMN suspendido BOOLEAN NOT NULL DEFAULT FALSE'
            ))
        if 'nivelPermiso' not in columnas:
            connection.execute(text(
                'ALTER TABLE usuarios ADD COLUMN nivelPermiso VARCHAR(30) NULL'
            ))
