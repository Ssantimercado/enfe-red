"""Cifrado de datos de salud (historial médico) con Fernet.

La clave va en CLAVE_CIFRADO_DATOS. Fuera de debug el backend no arranca sin ella. En desarrollo
(FLASK_DEBUG=1) sin clave el historial se guarda como texto: así ningún dato real queda atado a una
clave de prueba que después se pierde. Las pruebas automáticas cifran con una clave derivada.

Para cambiar la clave: la nueva va en CLAVE_CIFRADO_DATOS, la vieja en CLAVE_CIFRADO_ANTERIOR, y
después se corre flask --app app recifrar-historiales (o preparar-bd).
"""
import base64
import hashlib
import os
import re

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from flask import current_app

import configuracion

# Los tokens Fernet empiezan con la versión (0x80) y la fecha: en base64, "gAAAAA".
PATRON_TOKEN_FERNET = re.compile(r'gAAAAA[A-Za-z0-9_-]{50,}={0,2}')
MENSAJE_FALTA_CLAVE = (
    'Falta CLAVE_CIFRADO_DATOS en backend/.env (cifra el historial médico). Generala con: '
    'python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
)


class ErrorCifrado(RuntimeError):
    """El dato está cifrado con otra clave: no se devuelve basura ni se pisa el valor guardado."""


def _clave_desarrollo(app):
    secreto = (app.config.get('JWT_SECRET_KEY') or '').encode('utf-8')
    return base64.urlsafe_b64encode(hashlib.sha256(b'enfered-cifrado-datos:' + secreto).digest())


def _fernet(clave, variable):
    try:
        return Fernet(clave.encode('utf-8'))
    except (TypeError, ValueError) as error:
        raise RuntimeError(f'{variable} no es una clave válida. {MENSAJE_FALTA_CLAVE}') from error


def _valor(app, variable):
    return (app.config.get(variable) or os.getenv(variable, '')).strip()


def configurar_cifrado(app):
    """Prepara el cifrador de la app. Se llama al arrancar para fallar antes de atender pedidos."""
    fernet = app.extensions.get('cifrado_datos')
    if fernet is not None:
        return fernet
    clave = _valor(app, 'CLAVE_CIFRADO_DATOS')
    # Se descifra con la clave actual, las anteriores y la de desarrollo (datos de versiones previas);
    # se cifra siempre con la primera.
    anteriores = [_fernet(c.strip(), 'CLAVE_CIFRADO_ANTERIOR')
                  for c in _valor(app, 'CLAVE_CIFRADO_ANTERIOR').split(',') if c.strip()]
    desarrollo = Fernet(_clave_desarrollo(app))
    if clave:
        principal = _fernet(clave, 'CLAVE_CIFRADO_DATOS')
        fernet, cifra = MultiFernet([principal, *anteriores, desarrollo]), True
    elif app.testing:
        principal = desarrollo
        fernet, cifra = MultiFernet([desarrollo, *anteriores]), True
    elif configuracion.es_debug():
        principal = desarrollo
        # Mismo criterio que el resto del backend (FLASK_DEBUG=1): "true" o "yes" no cuentan.
        app.logger.warning(
            'CLAVE_CIFRADO_DATOS no está configurada: en desarrollo el historial médico se guarda sin '
            'cifrar. Configurala antes de usar datos reales y corré flask --app app preparar-bd.'
        )
        fernet, cifra = MultiFernet([desarrollo, *anteriores]), False
    else:
        raise RuntimeError(MENSAJE_FALTA_CLAVE)
    app.extensions['cifrado_datos'] = fernet
    app.extensions['cifrado_principal'] = principal
    app.extensions['cifrado_activo'] = cifra
    return fernet


def cifrado_activo(app=None):
    """True si los datos nuevos se guardan cifrados (hay clave propia, o son las pruebas)."""
    app = app or current_app
    configurar_cifrado(app)
    return app.extensions['cifrado_activo']


def parece_cifrado(valor):
    return isinstance(valor, str) and PATRON_TOKEN_FERNET.fullmatch(valor) is not None


def cifrar(texto):
    if texto is None:
        return None
    if not cifrado_activo():
        return str(texto)
    return configurar_cifrado(current_app).encrypt(str(texto).encode('utf-8')).decode('ascii')


def descifrar(valor):
    """Texto original. Los valores viejos guardados sin cifrar se devuelven tal cual."""
    if valor is None:
        return None
    try:
        return configurar_cifrado(current_app).decrypt(valor.encode('utf-8')).decode('utf-8')
    except InvalidToken:
        if not parece_cifrado(valor):
            return valor
        current_app.logger.error('No se pudo descifrar un dato: revisá CLAVE_CIFRADO_DATOS y CLAVE_CIFRADO_ANTERIOR.')
        raise ErrorCifrado('No se pudo descifrar el dato con la clave configurada')


def recifrar(valor):
    """Valor cifrado con la clave actual. Devuelve None si no hace falta cambiarlo.

    Texto plano se cifra; un token de una clave anterior se vuelve a cifrar con la actual.
    Lanza ErrorCifrado si ninguna clave configurada lo abre.
    """
    if valor is None or valor == '' or not cifrado_activo():
        return None
    fernet = configurar_cifrado(current_app)
    if not parece_cifrado(valor):
        return fernet.encrypt(valor.encode('utf-8')).decode('ascii')
    try:
        current_app.extensions['cifrado_principal'].decrypt(valor.encode('utf-8'))
        return None
    except InvalidToken:
        pass
    try:
        return fernet.rotate(valor.encode('utf-8')).decode('ascii')
    except InvalidToken as error:
        raise ErrorCifrado('No se pudo descifrar el dato con las claves configuradas') from error
