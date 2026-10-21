"""Control de sesión común a todas las rutas protegidas con JWT."""
from flask import jsonify

from database import db
from models.usuario_models import Usuario


def configurar_sesiones(jwt):
    """HU10: una cuenta suspendida (o eliminada) pierde la sesión en cualquier ruta, no solo en el login."""

    @jwt.token_in_blocklist_loader
    def sesion_revocada(_cabecera, datos_token):
        try:
            usuario = db.session.get(Usuario, int(datos_token['sub']))
        except (KeyError, TypeError, ValueError):
            return True
        return usuario is None or bool(usuario.suspendido)

    @jwt.revoked_token_loader
    def respuesta_sesion_revocada(_cabecera, _datos_token):
        # 401 hace que el frontend cierre la sesión y vuelva al login.
        return jsonify({'error': 'Tu cuenta no está activa. Si creés que es un error, contactá a soporte.'}), 401
