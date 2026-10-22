"""Configuración de arranque común a app.py y serve.py: entorno, registro (logs) y encabezados de seguridad."""
import logging
import os
import sys

ORIGENES_DESARROLLO = 'http://localhost:5173,http://127.0.0.1:5173'
NIVELES_LOG = ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')
FORMATO_LOG = '%(asctime)s %(levelname)s [%(name)s] %(message)s'
ENCABEZADOS_SEGURIDAD = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    # La API no se muestra dentro de otras páginas: evita que la enmarquen para engañar al usuario.
    'X-Frame-Options': 'DENY',
}
# Un año. Sin includeSubDomains para no romper otros subdominios que todavía no tengan HTTPS.
VALOR_HSTS = 'max-age=31536000'


def es_debug():
    return os.getenv('FLASK_DEBUG') == '1'


def entero_positivo(nombre, por_defecto):
    valor = os.getenv(nombre, '').strip()
    if not valor:
        return por_defecto
    if not valor.isdigit() or int(valor) <= 0:
        raise RuntimeError(f'{nombre} tiene que ser un número entero mayor que 0 (ver .env.example).')
    return int(valor)


def configurar_logging():
    """Todo el registro va a stdout, con fecha: lo junta el hosting o Docker.

    Se llama antes de crear la app para que Flask use este formato. Los mensajes nunca llevan
    emails, teléfonos ni textos de los usuarios: solo qué pasó y el tipo de error.
    """
    nombre_nivel = (os.getenv('LOG_LEVEL', '').strip() or 'INFO').upper()
    if nombre_nivel not in NIVELES_LOG:
        raise RuntimeError(f'LOG_LEVEL tiene que ser uno de {", ".join(NIVELES_LOG)} (ver .env.example).')
    raiz = logging.getLogger()
    raiz.setLevel(nombre_nivel)
    # Importar la app más de una vez (pruebas, flask CLI) no duplica las líneas.
    if not any(getattr(manejador, 'enfered', False) for manejador in raiz.handlers):
        manejador = logging.StreamHandler(sys.stdout)
        manejador.setFormatter(logging.Formatter(FORMATO_LOG, datefmt='%Y-%m-%d %H:%M:%S'))
        manejador.enfered = True
        raiz.addHandler(manejador)
    return nombre_nivel


def origenes_frontend():
    """Orígenes autorizados por CORS. Fuera de debug son obligatorios: no se adivina el dominio publicado."""
    valor = os.getenv('FRONTEND_ORIGINS', '').strip()
    if not valor:
        if not es_debug():
            raise RuntimeError(
                'Falta FRONTEND_ORIGINS en backend/.env: poné la dirección del frontend publicado '
                '(por ejemplo https://enfered.example). Solo con FLASK_DEBUG=1 se usa http://localhost:5173.'
            )
        valor = ORIGENES_DESARROLLO
    # El navegador manda el origen sin barra final; así una barra de más en el .env no bloquea al frontend.
    origenes = [origen.strip().rstrip('/') for origen in valor.split(',') if origen.strip()]
    if '*' in origenes and not es_debug():
        raise RuntimeError('FRONTEND_ORIGINS no puede ser "*" en producción: poné el dominio del frontend.')
    return origenes


def configurar_encabezados(app):
    """Encabezados de seguridad en todas las respuestas, también en los errores 404 y 500."""
    con_https = os.getenv('HTTPS') == '1'

    @app.after_request
    def agregar_encabezados_seguridad(respuesta):
        for nombre, valor in ENCABEZADOS_SEGURIDAD.items():
            respuesta.headers.setdefault(nombre, valor)
        # HSTS solo con HTTPS de verdad: si no, el navegador quedaría sin poder entrar por HTTP.
        if con_https:
            respuesta.headers.setdefault('Strict-Transport-Security', VALOR_HSTS)
        return respuesta
