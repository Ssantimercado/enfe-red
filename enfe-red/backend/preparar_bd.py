"""Creación de tablas, migraciones idempotentes y datos base, en un solo lugar.

En producción se corre una vez por despliegue, antes de levantar serve.py:

    flask --app app preparar-bd

Al arrancar la app solo se corre sola con FLASK_DEBUG=1 o AUTO_MIGRAR=1 (y siempre con python app.py,
el servidor de desarrollo). Así varios workers no migran la misma base a la vez.
"""
import os

from flask import current_app
from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError

from database import db
from schema_catalogo import inicializar_bd_catalogo
from schema_legal import inicializar_bd_legal
from schema_mejoras import inicializar_bd_mejoras
from schema_sprint4 import inicializar_bd_sprint4, inicializar_catalogo_servicios
from schema_sprint6 import inicializar_bd_sprint6
from seed_sprint3 import cargar_datos_demo, inicializar_bd_sprint3


# Una columna de cada migración reciente: si falta alguna, no se corrió preparar-bd con este código.
COLUMNAS_REQUERIDAS = {
    'usuarios': ('versionToken', 'eliminado'),
    'servicios': ('duracionMinutos', 'activo'),
    'enfermero_servicios': (),
    'calificaciones_servicio': ('oculta',),
    'enfermeros': ('motivoRechazo',),
}
MENSAJE_FALTA_PREPARAR = (
    'A la base de datos le faltan tablas o columnas de esta versión ({faltan}). Antes de arrancar '
    'corré: flask --app app preparar-bd'
)


def faltantes_del_esquema():
    """Tablas o columnas que faltan (vacío si la base está al día). Requiere app_context.

    Si la base no responde lanza OperationalError: quien llama decide qué hacer.
    """
    inspector = inspect(db.engine)
    tablas = set(inspector.get_table_names())
    faltan = []
    for tabla, columnas in COLUMNAS_REQUERIDAS.items():
        if tabla not in tablas:
            faltan.append(tabla)
            continue
        existentes = {columna['name'] for columna in inspector.get_columns(tabla)}
        faltan.extend(f'{tabla}.{columna}' for columna in columnas if columna not in existentes)
    return faltan


def verificar_esquema():
    """Corta el arranque del servidor de producción si la base no está migrada.

    Sin esto la app arrancaba y /api/health decía ok, pero el login daba 500 por columnas faltantes.
    Si la base todavía no responde (arranca más lento que el backend) solo se avisa.
    """
    try:
        faltan = faltantes_del_esquema()
    except OperationalError as error:
        current_app.logger.warning('No se pudo revisar la base al arrancar (%s).', type(error).__name__)
        return
    if faltan:
        raise RuntimeError(MENSAJE_FALTA_PREPARAR.format(faltan=', '.join(faltan)))


def debe_preparar_al_arrancar():
    return os.getenv('FLASK_DEBUG') == '1' or os.getenv('AUTO_MIGRAR') == '1'


def preparar_base():
    """Deja la base lista sin borrar datos. Se puede repetir: cada paso revisa qué falta. Requiere app_context."""
    # El orden importa: el esquema de solicitudes va antes de consultar/sembrar los perfiles existentes.
    inicializar_bd_sprint4()
    inicializar_bd_sprint6()
    inicializar_bd_legal()
    inicializar_bd_mejoras()
    inicializar_bd_catalogo()
    inicializar_bd_sprint3()
    inicializar_catalogo_servicios()
    # Las cuentas demo (clave 123456) solo se crean a pedido; también con: flask --app app cargar-demo
    if os.getenv('CARGAR_DEMO', '0') == '1':
        try:
            current_app.logger.warning('CARGAR_DEMO=1: cuentas demo listas (%s nuevas).', cargar_datos_demo())
        except Exception:
            db.session.rollback()
            current_app.logger.exception('No se pudieron cargar las cuentas demo')
    current_app.logger.info('Base de datos lista (tablas y migraciones al día).')
