"""Correo transaccional por SMTP (librería estándar).

Se configura con SMTP_HOST, SMTP_PORT, SMTP_USUARIO, SMTP_CLAVE, SMTP_TLS y CORREO_REMITENTE.
Sin SMTP configurado no se envía nada: en desarrollo (debug) el contenido queda en la consola.
"""
import logging
import os
import smtplib
import threading
from email.message import EmailMessage
from email.utils import formataddr

from flask import current_app, has_app_context

NOMBRE_REMITENTE = 'Enfered'
TIMEOUT_SMTP = 15  # Segundos: un servidor colgado no debe dejar hilos esperando para siempre.


def _configuracion():
    host = os.getenv('SMTP_HOST', '').strip()
    usuario = os.getenv('SMTP_USUARIO', '').strip()
    remitente = os.getenv('CORREO_REMITENTE', '').strip() or usuario
    if not host or not remitente:
        return None
    try:
        puerto = int(os.getenv('SMTP_PORT', '587'))
    except ValueError:
        puerto = 587
    return {
        'host': host, 'puerto': puerto, 'usuario': usuario,
        'clave': os.getenv('SMTP_CLAVE', ''), 'tls': os.getenv('SMTP_TLS', '1') == '1',
        'remitente': remitente,
    }


def correo_configurado():
    return _configuracion() is not None


def _contexto_actual():
    if has_app_context():
        return current_app.logger, current_app.debug
    return logging.getLogger(__name__), False


def enviar_correo(destino, asunto, texto, logger=None, debug=None):
    """Envía un correo de texto. Nunca lanza excepción: devuelve True si salió."""
    logger_actual, debug_actual = _contexto_actual()
    logger = logger or logger_actual
    debug = debug_actual if debug is None else debug
    try:
        config = _configuracion()
        if not config:
            if debug:
                logger.warning('CORREO LOCAL (sin SMTP) - Para: %s - Asunto: %s\n%s', destino, asunto, texto)
            else:
                logger.warning('No se envió un correo: falta configurar SMTP_HOST y CORREO_REMITENTE.')
            return False
        mensaje = EmailMessage()
        mensaje['From'] = formataddr((NOMBRE_REMITENTE, config['remitente']))
        mensaje['To'] = destino
        mensaje['Subject'] = asunto
        mensaje.set_content(texto)
        # El puerto 465 usa TLS desde el inicio; el resto (587) pasa a TLS con STARTTLS.
        if config['puerto'] == 465:
            servidor = smtplib.SMTP_SSL(config['host'], config['puerto'], timeout=TIMEOUT_SMTP)
        else:
            servidor = smtplib.SMTP(config['host'], config['puerto'], timeout=TIMEOUT_SMTP)
        with servidor:
            if config['tls'] and config['puerto'] != 465:
                servidor.starttls()
            if config['usuario']:
                servidor.login(config['usuario'], config['clave'])
            servidor.send_message(mensaje)
        return True
    except Exception as error:
        # Sin destinatario ni contenido en el log: pueden ser datos personales.
        logger.error('No se pudo enviar un correo (%s)', type(error).__name__)
        return False


def enviar_correo_en_segundo_plano(destino, asunto, texto):
    """Envía el correo en un hilo aparte para no demorar la respuesta. Devuelve el hilo."""
    logger, debug = _contexto_actual()
    hilo = threading.Thread(
        target=enviar_correo, args=(destino, asunto, texto),
        kwargs={'logger': logger, 'debug': debug}, daemon=True,
    )
    hilo.start()
    return hilo


def enviar_aviso(usuario, asunto, texto):
    """Aviso por correo a una cuenta (para notificaciones). No hace nada si no tiene email."""
    destino = getattr(usuario, 'email', usuario)
    if not isinstance(destino, str) or '@' not in destino:
        return None
    pie = '\n\nEste es un aviso automático de Enfered. Para ver el detalle, entrá a tu cuenta.'
    return enviar_correo_en_segundo_plano(destino, asunto, texto + pie)
