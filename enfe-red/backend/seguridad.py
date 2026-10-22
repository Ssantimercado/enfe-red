"""Control de sesión común a todas las rutas protegidas con JWT."""
from flask import jsonify
from flask_jwt_extended import create_access_token, create_refresh_token

from database import db
from models.usuario_models import Usuario

MENSAJE_CUENTA_INACTIVA = 'Tu cuenta no está activa. Si creés que es un error, contactá a soporte.'
MENSAJE_SESION_CERRADA = 'Tu sesión se cerró. Volvé a iniciar sesión.'


def _claims(usuario):
    # versionToken: al cambiar o recuperar la contraseña sube y los tokens anteriores dejan de valer.
    return {
        'rol': usuario.rol,
        'nivelPermiso': usuario.nivelPermiso,
        'versionToken': usuario.versionToken or 0,
    }


def crear_token_acceso(usuario):
    return create_access_token(identity=str(usuario.id), additional_claims=_claims(usuario))


def crear_tokens(usuario):
    """Token de acceso (corto) y de renovación (largo), con las claves que usa el login."""
    return {
        'token': crear_token_acceso(usuario),
        'refresh_token': create_refresh_token(identity=str(usuario.id), additional_claims=_claims(usuario)),
    }


def _usuario_del_token(datos_token):
    try:
        return db.session.get(Usuario, int(datos_token['sub']))
    except (KeyError, TypeError, ValueError):
        return None


def configurar_sesiones(jwt):
    """HU10: una cuenta suspendida (o eliminada) pierde la sesión en cualquier ruta, no solo en el login."""

    @jwt.token_in_blocklist_loader
    def sesion_revocada(_cabecera, datos_token):
        usuario = _usuario_del_token(datos_token)
        if usuario is None or bool(usuario.suspendido) or bool(usuario.eliminado):
            return True
        # Los tokens emitidos antes de existir la versión no la traen: valen como versión 0.
        return datos_token.get('versionToken', 0) != (usuario.versionToken or 0)

    @jwt.revoked_token_loader
    def respuesta_sesion_revocada(_cabecera, datos_token):
        # 401 hace que el frontend cierre la sesión y vuelva al login.
        usuario = _usuario_del_token(datos_token)
        if usuario is None or bool(usuario.suspendido) or bool(usuario.eliminado):
            return jsonify({'error': MENSAJE_CUENTA_INACTIVA}), 401
        return jsonify({'error': MENSAJE_SESION_CERRADA}), 401

    @jwt.expired_token_loader
    def respuesta_sesion_vencida(_cabecera, _datos_token):
        return jsonify({'error': 'Tu sesión venció. Volvé a iniciar sesión.'}), 401
