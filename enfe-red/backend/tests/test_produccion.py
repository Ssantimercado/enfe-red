"""B5: preparación para producción (health, encabezados, logging, preparar-bd, serve.py y backups)."""
import gzip
import io
import json
import logging
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from cryptography.fernet import Fernet
from flask import Flask
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

import configuracion
import serve
from database import db
from extensions import bcrypt
from models.servicio_models import Servicio
from models.usuario_models import Usuario
from preparar_bd import debe_preparar_al_arrancar, preparar_base
from routes.salud_routes import salud_bp
from scripts import backup_mysql

DIR_BACKEND = Path(__file__).resolve().parent.parent


def crear_app_pruebas():
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                      JWT_SECRET_KEY='testing-key-with-at-least-32-characters', BCRYPT_LOG_ROUNDS=4)
    app.logger.disabled = True
    db.init_app(app)
    bcrypt.init_app(app)
    app.register_blueprint(salud_bp, url_prefix='/api')
    return app


class SaludYEncabezadosTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app_pruebas()
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.engine.dispose()
        self.context.pop()

    def test_health_ok_con_la_base_respondiendo(self):
        respuesta = self.app.test_client().get('/api/health')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json, {'estado': 'ok'})
        self.assertEqual(respuesta.headers['Cache-Control'], 'no-store')

    def test_health_503_si_la_base_no_esta_migrada(self):
        db.drop_all()
        respuesta = self.app.test_client().get('/api/health')
        self.assertEqual((respuesta.status_code, respuesta.json), (503, {'estado': 'error'}))
        db.create_all()
        self.assertEqual(self.app.test_client().get('/api/health').status_code, 200)

    def test_verificar_esquema_corta_el_arranque_si_falta_preparar_bd(self):
        from preparar_bd import verificar_esquema
        verificar_esquema()
        with db.engine.begin() as connection:
            connection.execute(text('ALTER TABLE usuarios DROP COLUMN versionToken'))
        with self.assertRaisesRegex(RuntimeError, r'usuarios\.versionToken.*preparar-bd'):
            verificar_esquema()
        # Si la base todavía no responde no corta: lo informa /api/health.
        falla = OperationalError('SELECT 1', {}, Exception('sin conexión'))
        with patch('preparar_bd.inspect', side_effect=falla):
            verificar_esquema()

    def test_health_503_sin_detalles_si_la_base_no_responde(self):
        falla = OperationalError('SELECT 1', {}, Exception('Access denied for user root@10.0.0.1'))
        with patch('routes.salud_routes.db.session.execute', side_effect=falla):
            respuesta = self.app.test_client().get('/api/health')
        self.assertEqual(respuesta.status_code, 503)
        self.assertEqual(respuesta.json, {'estado': 'error'})
        self.assertNotIn('Access denied', respuesta.get_data(as_text=True))

    def test_encabezados_de_seguridad_en_todas_las_respuestas(self):
        with patch.dict(os.environ, {'HTTPS': ''}):
            configuracion.configurar_encabezados(self.app)
        cliente = self.app.test_client()
        for respuesta in (cliente.get('/api/health'), cliente.get('/no-existe')):
            self.assertEqual(respuesta.headers['X-Content-Type-Options'], 'nosniff')
            self.assertEqual(respuesta.headers['Referrer-Policy'], 'strict-origin-when-cross-origin')
            self.assertEqual(respuesta.headers['X-Frame-Options'], 'DENY')
            self.assertNotIn('Strict-Transport-Security', respuesta.headers)

    def test_hsts_solo_con_https(self):
        with patch.dict(os.environ, {'HTTPS': '1'}):
            configuracion.configurar_encabezados(self.app)
        respuesta = self.app.test_client().get('/api/health')
        self.assertEqual(respuesta.headers['Strict-Transport-Security'], 'max-age=31536000')


class ConfiguracionTest(unittest.TestCase):
    def test_sin_frontend_origins_fuera_de_debug_no_arranca(self):
        with patch.dict(os.environ, {'FRONTEND_ORIGINS': '', 'FLASK_DEBUG': '0'}):
            with self.assertRaisesRegex(RuntimeError, 'Falta FRONTEND_ORIGINS'):
                configuracion.origenes_frontend()

    def test_en_debug_usa_localhost_por_defecto(self):
        with patch.dict(os.environ, {'FRONTEND_ORIGINS': '', 'FLASK_DEBUG': '1'}):
            self.assertEqual(configuracion.origenes_frontend(),
                             ['http://localhost:5173', 'http://127.0.0.1:5173'])

    def test_lee_la_lista_y_rechaza_el_comodin_en_produccion(self):
        with patch.dict(os.environ, {'FRONTEND_ORIGINS': ' https://enfered.example/ , https://www.enfered.example',
                                     'FLASK_DEBUG': '0'}):
            self.assertEqual(configuracion.origenes_frontend(),
                             ['https://enfered.example', 'https://www.enfered.example'])
        with patch.dict(os.environ, {'FRONTEND_ORIGINS': '*', 'FLASK_DEBUG': '0'}):
            with self.assertRaises(RuntimeError):
                configuracion.origenes_frontend()

    def test_preparar_al_arrancar_solo_en_debug_o_con_auto_migrar(self):
        casos = [({'FLASK_DEBUG': '1', 'AUTO_MIGRAR': ''}, True), ({'FLASK_DEBUG': '0', 'AUTO_MIGRAR': '1'}, True),
                 ({'FLASK_DEBUG': '0', 'AUTO_MIGRAR': '0'}, False), ({'FLASK_DEBUG': '', 'AUTO_MIGRAR': ''}, False)]
        for entorno, esperado in casos:
            with self.subTest(entorno=entorno), patch.dict(os.environ, entorno):
                self.assertEqual(debe_preparar_al_arrancar(), esperado)


class LoggingTest(unittest.TestCase):
    def setUp(self):
        self.raiz = logging.getLogger()
        self.nivel_original = self.raiz.level
        self.manejadores_originales = list(self.raiz.handlers)

    def tearDown(self):
        self.raiz.handlers[:] = self.manejadores_originales
        self.raiz.setLevel(self.nivel_original)

    def test_escribe_en_stdout_con_fecha_y_nivel_configurable(self):
        salida = io.StringIO()
        with patch.dict(os.environ, {'LOG_LEVEL': 'warning'}), patch('configuracion.sys.stdout', salida):
            self.assertEqual(configuracion.configurar_logging(), 'WARNING')
            configuracion.configurar_logging()  # No duplica el manejador.
        self.assertEqual(self.raiz.level, logging.WARNING)
        propios = [m for m in self.raiz.handlers if getattr(m, 'enfered', False)]
        self.assertEqual(len(propios), 1)
        logging.getLogger('enfered.prueba').info('no se ve')
        logging.getLogger('enfered.prueba').warning('aviso de prueba')
        texto = salida.getvalue()
        self.assertNotIn('no se ve', texto)
        self.assertRegex(texto, r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WARNING \[enfered\.prueba\] aviso de prueba')

    def test_por_defecto_info_y_rechaza_niveles_invalidos(self):
        with patch.dict(os.environ, {'LOG_LEVEL': ''}), patch('configuracion.sys.stdout', io.StringIO()):
            self.assertEqual(configuracion.configurar_logging(), 'INFO')
        with patch.dict(os.environ, {'LOG_LEVEL': 'charlatan'}):
            with self.assertRaisesRegex(RuntimeError, 'LOG_LEVEL'):
                configuracion.configurar_logging()


class PrepararBaseTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app_pruebas()
        self.context = self.app.app_context()
        self.context.push()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    @patch.dict(os.environ, {'CARGAR_DEMO': '0'})
    def test_crea_el_esquema_completo_y_se_puede_repetir(self):
        preparar_base()
        preparar_base()  # Idempotente: no duplica catálogo ni falla con las columnas ya agregadas.
        tablas = set(inspect(db.engine).get_table_names())
        self.assertTrue({'usuarios', 'enfermeros', 'pacientes', 'solicitudes_servicio', 'servicios',
                         'notificaciones', 'auditoria_admin'} <= tablas)
        columnas = {c['name'] for c in inspect(db.engine).get_columns('usuarios')}
        self.assertTrue({'suspendido', 'versionTerminos', 'versionToken', 'eliminado'} <= columnas)
        self.assertGreater(Servicio.query.count(), 0)
        self.assertEqual(Usuario.query.count(), 0)  # Sin CARGAR_DEMO no crea cuentas demo.

    @patch.dict(os.environ, {'CARGAR_DEMO': '0'})
    def test_comando_preparar_bd(self):
        from cli_admin import registrar_comandos
        registrar_comandos(self.app)
        resultado = self.app.test_cli_runner().invoke(args=['preparar-bd'])
        self.assertEqual(resultado.exit_code, 0, resultado.output)
        self.assertIn('Base de datos lista', resultado.output)
        self.assertIn('solicitudes_servicio', inspect(db.engine).get_table_names())


class ArranqueAppTest(unittest.TestCase):
    """Importa app.py en otro proceso, con SQLite en memoria y sin leer backend/.env."""

    def correr(self, codigo, **entorno):
        base = {clave: valor for clave, valor in os.environ.items()
                if clave in ('PATH', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE')}
        base.update({
            'DATABASE_URL': 'sqlite:///:memory:', 'JWT_SECRET_KEY': 'x' * 40,
            'CLAVE_CIFRADO_DATOS': Fernet.generate_key().decode(), 'FLASK_DEBUG': '0', 'LOG_LEVEL': 'ERROR',
            'PYTHONIOENCODING': 'utf-8',
        })
        base.update(entorno)
        # load_dotenv desactivado: la prueba nunca toca la base ni la configuración reales.
        preambulo = 'import dotenv\ndotenv.load_dotenv = lambda *a, **k: False\n'
        return subprocess.run([sys.executable, '-c', preambulo + codigo], cwd=DIR_BACKEND, env=base,
                              capture_output=True, text=True, encoding='utf-8', timeout=120)

    def test_sin_frontend_origins_en_produccion_falla_con_mensaje_claro(self):
        resultado = self.correr('import app')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('Falta FRONTEND_ORIGINS', resultado.stderr)

    def test_en_produccion_no_migra_al_importar_y_responde_health(self):
        codigo = (
            'import json\nfrom sqlalchemy import inspect\nfrom app import app, db\n'
            'with app.app_context():\n    tablas_antes = inspect(db.engine).get_table_names()\n'
            'r = app.test_client().get("/api/health")\n'
            'resultado = app.test_cli_runner().invoke(args=["preparar-bd"])\n'
            'with app.app_context():\n    tablas_despues = inspect(db.engine).get_table_names()\n'
            'r2 = app.test_client().get("/api/health")\n'
            'print(json.dumps({"antes": tablas_antes, "despues": tablas_despues, "estado": r.status_code,'
            ' "json": r.json, "frame": r.headers.get("X-Frame-Options"), "cli": resultado.exit_code,'
            ' "despues_estado": r2.status_code}))\n'
        )
        resultado = self.correr(codigo, FRONTEND_ORIGINS='https://enfered.example')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        datos = json.loads(resultado.stdout.strip().splitlines()[-1])
        self.assertEqual(datos['antes'], [])
        # Sin preparar la base, health avisa que no está lista (antes decía ok y el login daba 500).
        self.assertEqual((datos['estado'], datos['json'], datos['frame']), (503, {'estado': 'error'}, 'DENY'))
        self.assertEqual(datos['cli'], 0)
        self.assertIn('usuarios', datos['despues'])
        self.assertEqual(datos['despues_estado'], 200)

    def test_con_auto_migrar_prepara_la_base_al_importar(self):
        codigo = ('from sqlalchemy import inspect\nfrom app import app, db\n'
                  'with app.app_context():\n    print("usuarios" in inspect(db.engine).get_table_names())\n')
        resultado = self.correr(codigo, FRONTEND_ORIGINS='https://enfered.example', AUTO_MIGRAR='1')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertEqual(resultado.stdout.strip().splitlines()[-1], 'True')


class ServeTest(unittest.TestCase):
    def test_opciones_por_defecto(self):
        with patch.dict(os.environ, {'PORT': '', 'WAITRESS_THREADS': '', 'PROXY_CONFIABLE': ''}):
            opciones = serve.opciones_servidor()
        self.assertEqual((opciones['host'], opciones['port'], opciones['threads']), ('0.0.0.0', 5000, 4))
        # La app los ignora sin PROXY_CONFIABLE=1, pero necesita verlos para avisar que falta configurarlo.
        self.assertFalse(opciones['clear_untrusted_proxy_headers'])

    def test_lee_puerto_hilos_y_respeta_el_proxy_confiable(self):
        with patch.dict(os.environ, {'PORT': '8080', 'WAITRESS_THREADS': '8', 'PROXY_CONFIABLE': '1'}):
            opciones = serve.opciones_servidor()
        self.assertEqual((opciones['port'], opciones['threads']), (8080, 8))
        # Si waitress borrara X-Forwarded-For, todos los pedidos parecerían venir del proxy.
        self.assertFalse(opciones['clear_untrusted_proxy_headers'])

    def test_valores_invalidos(self):
        for entorno in ({'PORT': '70000'}, {'PORT': 'abc'}, {'WAITRESS_THREADS': '0'}):
            with self.subTest(entorno=entorno), patch.dict(os.environ, entorno):
                with self.assertRaises(RuntimeError):
                    serve.opciones_servidor()


class _ProcesoFalso:
    def __init__(self, contenido=b'-- dump\nCREATE TABLE usuarios (id INT);\n', codigo=0, error=b''):
        self.stdout = io.BytesIO(contenido)
        self.codigo = codigo
        self.error = error
        self.stderr_destino = None

    def wait(self):
        if self.stderr_destino is not None:
            self.stderr_destino.write(self.error)
        return self.codigo


class BackupTest(unittest.TestCase):
    URL = 'mysql+pymysql://enfered:cl%22a%5Cve%23secreta@db.local:3307/enfe_red'

    def setUp(self):
        self.carpeta = tempfile.TemporaryDirectory()
        self.addCleanup(self.carpeta.cleanup)
        self.conexion = backup_mysql.datos_conexion(self.URL)

    def simular(self, proceso):
        visto = {}

        def popen(comando, stdout, stderr):
            ruta = next(a.split('=', 1)[1] for a in comando if a.startswith('--defaults-extra-file='))
            visto['comando'] = comando
            visto['ruta_opciones'] = ruta
            visto['opciones'] = Path(ruta).read_text(encoding='utf-8')
            proceso.stderr_destino = stderr
            return proceso

        return patch('scripts.backup_mysql.subprocess.Popen', side_effect=popen), visto

    def test_lee_database_url(self):
        self.assertEqual(self.conexion, {'host': 'db.local', 'port': 3307, 'user': 'enfered',
                                         'password': 'cl"a\\ve#secreta', 'database': 'enfe_red', 'socket': None})
        for url in ('', 'sqlite:///enfered.db', 'mysql+pymysql://u:c@localhost/'):
            with self.subTest(url=url), self.assertRaises(backup_mysql.ErrorBackup):
                backup_mysql.datos_conexion(url)

    def test_genera_el_gzip_sin_poner_la_clave_en_la_linea_de_comandos(self):
        simulacion, visto = self.simular(_ProcesoFalso())
        with simulacion:
            destino, borradas = backup_mysql.hacer_backup(self.conexion, self.carpeta.name, 14,
                                                          ahora=datetime(2026, 10, 22, 3, 0, 0))
        self.assertEqual(destino.name, 'enfered-enfe_red-20261022-030000.sql.gz')
        with gzip.open(destino, 'rb') as archivo:
            self.assertIn(b'CREATE TABLE usuarios', archivo.read())
        self.assertEqual(borradas, [])
        self.assertFalse(any('secreta' in parte for parte in visto['comando']))
        self.assertEqual(visto['comando'][-1], 'enfe_red')
        self.assertIn('--single-transaction', visto['comando'])
        self.assertIn('password="cl\\"a\\\\ve#secreta"', visto['opciones'])
        self.assertIn('port=3307', visto['opciones'])
        self.assertFalse(Path(visto['ruta_opciones']).exists())  # El archivo con la clave se borra.

    def test_si_mysqldump_falla_no_deja_copia_ni_archivo_de_opciones(self):
        simulacion, visto = self.simular(_ProcesoFalso(contenido=b'-- a medias', codigo=2,
                                                       error=b'Access denied for user'))
        with simulacion, self.assertRaisesRegex(backup_mysql.ErrorBackup, 'Access denied'):
            backup_mysql.hacer_backup(self.conexion, self.carpeta.name, 14)
        self.assertEqual(list(Path(self.carpeta.name).iterdir()), [])
        self.assertFalse(Path(visto['ruta_opciones']).exists())

    def test_sin_mysqldump_explica_que_instalar(self):
        with patch('scripts.backup_mysql.subprocess.Popen', side_effect=FileNotFoundError()):
            with self.assertRaisesRegex(backup_mysql.ErrorBackup, 'MYSQLDUMP'):
                backup_mysql.hacer_backup(self.conexion, self.carpeta.name, 14)
        self.assertEqual(list(Path(self.carpeta.name).iterdir()), [])

    def test_conserva_solo_las_ultimas_copias(self):
        carpeta = Path(self.carpeta.name)
        for dia in range(1, 6):
            (carpeta / f'enfered-enfe_red-202610{dia:02d}-030000.sql.gz').write_bytes(b'x')
        (carpeta / 'enfered-otra_base-20261001-030000.sql.gz').write_bytes(b'x')
        (carpeta / 'notas.txt').write_text('no se toca')
        simulacion, _ = self.simular(_ProcesoFalso())
        with simulacion:
            destino, borradas = backup_mysql.hacer_backup(self.conexion, carpeta, 3,
                                                          ahora=datetime(2026, 10, 22, 3, 0, 0))
        restantes = sorted(p.name for p in carpeta.iterdir())
        self.assertEqual(restantes, [
            'enfered-enfe_red-20261004-030000.sql.gz', 'enfered-enfe_red-20261005-030000.sql.gz',
            destino.name, 'enfered-otra_base-20261001-030000.sql.gz', 'notas.txt',
        ])
        self.assertEqual(len(borradas), 3)

    def test_valida_backup_conservar(self):
        with patch.dict(os.environ, {'BACKUP_CONSERVAR': ''}):
            self.assertEqual(backup_mysql._conservar(), 14)
        with patch.dict(os.environ, {'BACKUP_CONSERVAR': '0'}), self.assertRaises(backup_mysql.ErrorBackup):
            backup_mysql._conservar()


if __name__ == '__main__':
    unittest.main()
