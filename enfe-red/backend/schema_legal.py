"""Constancia del consentimiento a términos y privacidad (Ley 25.326) en bases existentes."""
from sqlalchemy import inspect, text

from database import db

# Cambiar al publicar una nueva versión de los términos o de la política de privacidad.
VERSION_TERMINOS = '1.0'


def inicializar_bd_legal():
    columnas = {columna['name'] for columna in inspect(db.engine).get_columns('usuarios')}
    with db.engine.begin() as connection:
        if 'versionTerminos' not in columnas:
            connection.execute(text('ALTER TABLE usuarios ADD COLUMN versionTerminos VARCHAR(10) NULL'))
        if 'aceptoTerminosEn' not in columnas:
            connection.execute(text('ALTER TABLE usuarios ADD COLUMN aceptoTerminosEn DATETIME NULL'))
