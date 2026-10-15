from sqlalchemy import inspect, text

from database import db
from models.solicitud_models import SolicitudServicio


def inicializar_bd_sprint4():
    """Crear las tablas y ampliar bases previas sin borrar ni verificar usuarios."""
    # Importar SolicitudServicio registra también Servicio en los metadatos.
    db.create_all()
    with db.engine.begin() as connection:
        columnas = {columna['name'] for columna in inspect(connection).get_columns('enfermeros')}
        if 'verificado' not in columnas:
            connection.execute(text(
                'ALTER TABLE enfermeros ADD COLUMN verificado BOOLEAN NOT NULL DEFAULT FALSE'
            ))
