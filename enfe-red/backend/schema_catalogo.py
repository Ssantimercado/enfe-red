"""SCRUM-14/53 y SCRUM-30/50: servicios que ofrece cada enfermero y catálogo editable, en bases existentes."""
from sqlalchemy import inspect, text

from database import db
from models.servicio_models import enfermero_servicios


def inicializar_bd_catalogo():
    inspector = inspect(db.engine)
    with db.engine.begin() as connection:
        if inspector.has_table('servicios'):
            columnas = {columna['name'] for columna in inspector.get_columns('servicios')}
            if 'activo' not in columnas:
                # Todo el catálogo existente sigue disponible.
                connection.execute(text('ALTER TABLE servicios ADD COLUMN activo BOOLEAN NOT NULL DEFAULT TRUE'))
        # Los enfermeros existentes arrancan sin servicios declarados: siguen recibiendo cualquier pedido.
        enfermero_servicios.create(connection, checkfirst=True)
