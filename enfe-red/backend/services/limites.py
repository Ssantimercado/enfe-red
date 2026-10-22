"""Límite de intentos guardado en la base: vale igual con varios procesos del servidor."""
import hashlib
import hmac
import os
from datetime import timedelta

from flask import current_app, request

from database import db
from models.acceso_models import IntentoAcceso, ahora_utc

# Ningún límite usa una ventana mayor: lo más viejo ya no cuenta y se borra.
CONSERVAR_INTENTOS = timedelta(days=1)


def _clave(valor):
    # HMAC con el secreto del servidor: en la tabla no queda ni el email ni la IP.
    secreto = (current_app.config.get('JWT_SECRET_KEY') or '').encode('utf-8')
    return hmac.new(secreto, str(valor).encode('utf-8'), hashlib.sha256).hexdigest()


_proxy_avisado = False


def ip_cliente():
    """IP de quien hace el pedido (detrás de un proxy, solo si PROXY_CONFIABLE=1 en app.py)."""
    _avisar_proxy_sin_configurar()
    return request.remote_addr or 'desconocida'


def _avisar_proxy_sin_configurar():
    # Detrás de un proxy sin PROXY_CONFIABLE=1 todos parecen venir de la misma IP: los límites por IP
    # bloquearían a todo el sitio. Se avisa una vez por proceso para que se note en el log.
    global _proxy_avisado
    if _proxy_avisado or os.getenv('PROXY_CONFIABLE') == '1':
        return
    if request.headers.get('X-Forwarded-For') or request.headers.get('Forwarded'):
        _proxy_avisado = True
        current_app.logger.warning(
            'Llegan pedidos con X-Forwarded-For pero PROXY_CONFIABLE no es 1: los límites de intentos '
            'ven a todos con la IP del proxy (%s). Si el proxy es tuyo o del hosting, poné PROXY_CONFIABLE=1.',
            request.remote_addr,
        )


def contar_intentos(tipo, valor, ventana):
    desde = ahora_utc() - ventana
    return IntentoAcceso.query.filter(
        IntentoAcceso.tipo == tipo,
        IntentoAcceso.clave == _clave(valor),
        IntentoAcceso.fecha > desde,
    ).count()


def supera_limite(tipo, valor, maximo, ventana):
    return contar_intentos(tipo, valor, ventana) >= maximo


def registrar_intento(tipo, valor):
    """Suma un intento y guarda los cambios pendientes de la sesión."""
    try:
        IntentoAcceso.query.filter(IntentoAcceso.fecha < ahora_utc() - CONSERVAR_INTENTOS).delete(
            synchronize_session=False
        )
        db.session.add(IntentoAcceso(tipo=tipo, clave=_clave(valor)))
        db.session.commit()
    except Exception:
        # Si no se puede contar, no se bloquea a la persona; queda registrado para revisar.
        db.session.rollback()
        current_app.logger.exception('No se pudo registrar un intento de acceso')


def borrar_intentos(tipo, valor):
    try:
        IntentoAcceso.query.filter_by(tipo=tipo, clave=_clave(valor)).delete(synchronize_session=False)
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception('No se pudieron borrar los intentos de acceso')
