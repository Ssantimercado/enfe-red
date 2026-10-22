"""Chequeo de salud para el hosting, Docker o un monitor externo (GET /api/health)."""
from flask import Blueprint, current_app, jsonify
from sqlalchemy import text

from database import db
from preparar_bd import MENSAJE_FALTA_PREPARAR, faltantes_del_esquema

salud_bp = Blueprint('salud_bp', __name__)


def _revisar_esquema():
    # Una vez por proceso: si la base está al día no cambia mientras el servidor corre.
    if current_app.extensions.get('esquema_al_dia'):
        return
    faltan = faltantes_del_esquema()
    if faltan:
        raise RuntimeError(MENSAJE_FALTA_PREPARAR.format(faltan=', '.join(faltan)))
    current_app.extensions['esquema_al_dia'] = True


@salud_bp.get('/health')
def health():
    """Confirma que la API responde y que la base contesta. Nunca devuelve detalles internos."""
    try:
        db.session.execute(text('SELECT 1'))
        db.session.rollback()
        _revisar_esquema()
    except Exception as error:
        # El monitor solo necesita saber que falló; el tipo de error queda en el log del servidor.
        db.session.remove()
        # Sin el detalle del error (podría traer datos de conexión), salvo el de esquema, que es nuestro.
        detalle = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        current_app.logger.error('Health check: la base de datos no está lista (%s)', detalle)
        respuesta = jsonify({'estado': 'error'})
        respuesta.status_code = 503
    else:
        respuesta = jsonify({'estado': 'ok'})
    respuesta.headers['Cache-Control'] = 'no-store'
    return respuesta
