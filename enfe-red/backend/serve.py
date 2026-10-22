"""Servidor de producción con waitress (funciona igual en Windows, Linux y Docker).

    flask --app app preparar-bd    # una vez por despliegue
    python serve.py

python app.py queda solo para desarrollo: el servidor de Flask no está pensado para gente real.
"""
import logging

from waitress import serve

from configuracion import entero_positivo

logger = logging.getLogger('enfered.serve')


def opciones_servidor():
    puerto = entero_positivo('PORT', 5000)
    if puerto > 65535:
        raise RuntimeError('PORT tiene que ser un número entre 1 y 65535 (ver .env.example).')
    return {
        'host': '0.0.0.0',
        'port': puerto,
        'threads': entero_positivo('WAITRESS_THREADS', 4),
        # No anuncia qué servidor ni qué versión corre.
        'ident': 'Enfered',
        # waitress no borra los X-Forwarded-*: con PROXY_CONFIABLE=1 los usa ProxyFix para conocer la IP
        # real; sin él la app no los usa, pero los ve y avisa en el log que falta configurarlo.
        'clear_untrusted_proxy_headers': False,
    }


def main():
    # Importar la app carga backend/.env y valida la configuración: si falta algo, no arranca.
    from app import app
    from preparar_bd import verificar_esquema

    # Sin AUTO_MIGRAR la base no se migra sola: mejor no arrancar que responder 500 en cada login.
    with app.app_context():
        verificar_esquema()
    opciones = opciones_servidor()
    logger.info('Enfered escuchando en el puerto %s con %s hilos.', opciones['port'], opciones['threads'])
    serve(app, **opciones)


if __name__ == '__main__':
    main()
