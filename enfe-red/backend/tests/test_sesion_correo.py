"""Mejoras posteriores al Sprint 6: sesión con renovación, límites de intentos en la base, recuperación y correo."""
import os
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token, decode_token
from sqlalchemy import inspect, text

from cli_admin import registrar_comandos
from database import db
from extensions import bcrypt
from models.acceso_models import CodigoRecuperacion, IntentoAcceso
from models.usuario_models import Usuario
from routes.auth_routes import auth_bp
from routes.usuario_routes import usuario_bp
from schema_mejoras import inicializar_bd_mejoras
from seguridad import configurar_sesiones
from services import correo

SIN_SMTP = {'SMTP_HOST': '', 'CORREO_REMITENTE': '', 'SMTP_USUARIO': ''}
CON_SMTP = {
    'SMTP_HOST': 'smtp.test.local', 'SMTP_PORT': '587', 'SMTP_USUARIO': 'avisos@test.local',
    'SMTP_CLAVE': 'clave-smtp', 'SMTP_TLS': '1', 'CORREO_REMITENTE': 'no-responder@test.local',
}


class BaseSesionTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters', BCRYPT_LOG_ROUNDS=4)
        self.app.logger.disabled = True
        db.init_app(self.app)
        bcrypt.init_app(self.app)
        configurar_sesiones(JWTManager(self.app))
        self.app.register_blueprint(usuario_bp, url_prefix='/api')
        self.app.register_blueprint(auth_bp, url_prefix='/api')
        registrar_comandos(self.app)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        hash_clave = bcrypt.generate_password_hash('clave-original').decode()
        db.session.add_all([
            Usuario(id=1, email='ana@test.local', password_hash=hash_clave, rol='paciente'),
            # Cuenta vieja guardada con mayúsculas, de antes de normalizar los emails.
            Usuario(id=2, email='Viejo@Test.Local', password_hash=hash_clave, rol='enfermero'),
            Usuario(id=3, email='susp@test.local', password_hash=hash_clave, rol='paciente', suspendido=True),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        # Ningún correo sale de verdad durante las pruebas.
        self.envio = patch('routes.auth_routes.enviar_correo_en_segundo_plano').start()

    def tearDown(self):
        patch.stopall()
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def login(self, email='ana@test.local', password='clave-original', ip='10.0.0.1'):
        return self.client.post('/api/login', json={'email': email, 'password': password},
                                environ_base={'REMOTE_ADDR': ip})

    @staticmethod
    def auth(token):
        return {'Authorization': 'Bearer ' + token}


class SesionTest(BaseSesionTest):
    def test_login_devuelve_token_y_refresh_con_la_version(self):
        respuesta = self.login()
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['rol'], 'paciente')
        acceso = decode_token(respuesta.json['token'])
        renovacion = decode_token(respuesta.json['refresh_token'])
        self.assertEqual((acceso['type'], renovacion['type']), ('access', 'refresh'))
        self.assertEqual(acceso['versionToken'], 0)
        self.assertEqual(renovacion['versionToken'], 0)
        self.assertGreater(renovacion['exp'], acceso['exp'])

    def test_refresh_entrega_un_token_de_acceso_nuevo(self):
        tokens = self.login().json
        renovado = self.client.post('/api/token/refresh', headers=self.auth(tokens['refresh_token']))
        self.assertEqual(renovado.status_code, 200)
        self.assertEqual(decode_token(renovado.json['token'])['type'], 'access')
        self.assertNotIn('refresh_token', renovado.json)
        # El token de acceso no sirve para renovar.
        self.assertNotEqual(self.client.post('/api/token/refresh', headers=self.auth(tokens['token'])).status_code, 200)

    def test_tokens_sin_version_siguen_valiendo_hasta_el_primer_cambio(self):
        viejo = create_access_token(identity='1')
        datos = {'password_actual': 'clave-original', 'password_nueva': 'clave-nueva-1'}
        self.assertEqual(self.client.put('/api/perfil/password', json=datos, headers=self.auth(viejo)).status_code, 200)
        rechazado = self.client.put('/api/perfil/password', json=datos, headers=self.auth(viejo))
        self.assertEqual(rechazado.status_code, 401)
        self.assertEqual(rechazado.json['error'], 'Tu sesión se cerró. Volvé a iniciar sesión.')

    def test_cuenta_suspendida_mantiene_su_mensaje(self):
        respuesta = self.client.put('/api/perfil/password', json={}, headers=self.auth(
            create_access_token(identity='3')))
        self.assertEqual(respuesta.status_code, 401)
        self.assertIn('no está activa', respuesta.json['error'])

    def test_cambiar_password_cierra_las_otras_sesiones_y_da_tokens_nuevos(self):
        tokens = self.login().json
        cambio = self.client.put('/api/perfil/password', headers=self.auth(tokens['token']), json={
            'password_actual': 'clave-original', 'password_nueva': 'clave-nueva-1'})
        self.assertEqual(cambio.status_code, 200)
        self.assertEqual(db.session.get(Usuario, 1).versionToken, 1)
        self.assertEqual(decode_token(cambio.json['token'])['versionToken'], 1)
        self.assertEqual(self.client.post('/api/token/refresh', headers=self.auth(tokens['refresh_token'])).status_code, 401)
        self.assertEqual(self.client.post('/api/token/refresh', headers=self.auth(
            cambio.json['refresh_token'])).status_code, 200)
        self.assertEqual(self.login(password='clave-nueva-1').status_code, 200)

    def test_cambiar_password_valida_los_datos(self):
        token = self.login().json['token']
        casos = [
            ({}, 400),
            ({'password_actual': 'clave-original', 'password_nueva': 'corta'}, 400),
            ({'password_actual': 'clave-original', 'password_nueva': 'x' * 73}, 400),
            ({'password_actual': 'equivocada', 'password_nueva': 'clave-nueva-1'}, 400),
        ]
        for cuerpo, estado in casos:
            with self.subTest(cuerpo=cuerpo):
                self.assertEqual(self.client.put('/api/perfil/password', json=cuerpo,
                                                 headers=self.auth(token)).status_code, estado)
        self.assertEqual(self.client.put('/api/perfil/password', json={'password_actual': 'x', 'password_nueva': 'y' * 8}).status_code, 401)
        for _ in range(4):
            self.client.put('/api/perfil/password', headers=self.auth(token),
                            json={'password_actual': 'equivocada', 'password_nueva': 'clave-nueva-1'})
        bloqueado = self.client.put('/api/perfil/password', headers=self.auth(token),
                                    json={'password_actual': 'clave-original', 'password_nueva': 'clave-nueva-1'})
        self.assertEqual(bloqueado.status_code, 429)
        self.assertEqual(db.session.get(Usuario, 1).versionToken, 0)

    def test_resetear_password_cierra_todas_las_sesiones(self):
        tokens = self.login().json
        with patch('routes.auth_routes.secrets.randbelow', return_value=135790):
            self.client.post('/api/recuperar-password', json={'email': 'ana@test.local'})
        reset = self.client.post('/api/reset-password', json={
            'email': 'ana@test.local', 'codigo': '135790', 'nueva_password': 'clave-nueva-1'})
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(db.session.get(Usuario, 1).versionToken, 1)
        self.assertEqual(self.client.post('/api/token/refresh', headers=self.auth(tokens['refresh_token'])).status_code, 401)


class LimitesTest(BaseSesionTest):
    def test_cinco_fallos_por_email_bloquean_aunque_la_clave_sea_correcta(self):
        for _ in range(5):
            self.assertEqual(self.login(password='equivocada').status_code, 401)
        bloqueado = self.login()
        self.assertEqual(bloqueado.status_code, 429)
        self.assertIn('Esperá 15 minutos', bloqueado.json['error'])
        # Otra cuenta desde la misma IP todavía puede entrar.
        self.assertEqual(self.login(email='viejo@test.local').status_code, 200)
        # Se guarda en la base, sin el email en claro (vale con varios procesos).
        self.assertEqual(IntentoAcceso.query.filter_by(tipo='login_email').count(), 5)
        self.assertFalse(IntentoAcceso.query.filter(IntentoAcceso.clave.contains('ana')).count())

    def test_veinte_fallos_por_ip_bloquean_esa_ip(self):
        for numero in range(20):
            self.login(email=f'nadie{numero}@test.local', password='equivocada', ip='10.0.0.9')
        self.assertEqual(self.login(ip='10.0.0.9').status_code, 429)
        self.assertEqual(self.login(ip='10.0.0.2').status_code, 200)

    def test_login_correcto_reinicia_los_fallos_del_email(self):
        for _ in range(4):
            self.login(password='equivocada')
        self.assertEqual(self.login().status_code, 200)
        for _ in range(4):
            self.login(password='equivocada')
        self.assertEqual(self.login().status_code, 200)

    def test_registro_permite_cinco_por_ip_por_hora(self):
        base = {'nombre': 'Persona Nueva', 'password': 'clave-segura', 'rol': 'paciente', 'aceptaTerminos': True}
        for numero in range(5):
            respuesta = self.client.post('/api/registro', json={**base, 'email': f'nueva{numero}@test.local'},
                                         environ_base={'REMOTE_ADDR': '10.0.0.5'})
            self.assertEqual(respuesta.status_code, 201)
        limitado = self.client.post('/api/registro', json={**base, 'email': 'otra@test.local'},
                                    environ_base={'REMOTE_ADDR': '10.0.0.5'})
        self.assertEqual(limitado.status_code, 429)
        self.assertIn('Esperá una hora', limitado.json['error'])
        self.assertEqual(self.client.post('/api/registro', json={**base, 'email': 'otra@test.local'},
                                          environ_base={'REMOTE_ADDR': '10.0.0.6'}).status_code, 201)

    def test_errores_del_formulario_no_cuentan_para_el_registro(self):
        for _ in range(6):
            self.client.post('/api/registro', json={'nombre': 'X', 'email': 'malo', 'password': 'x'})
        self.assertEqual(IntentoAcceso.query.filter_by(tipo='registro_ip').count(), 0)


    def simular_mysql_sin_tildes(self):
        """MySQL 8 (utf8mb4_0900_ai_ci) encuentra la cuenta aunque el email tenga otra tilde."""
        import unicodedata
        from routes import auth_routes

        def sin_tildes(texto):
            return ''.join(c for c in unicodedata.normalize('NFKD', texto) if not unicodedata.combining(c))

        def buscar(email):
            buscado = sin_tildes(auth_routes.normalizar_email(email))
            return next((u for u in Usuario.query.all() if sin_tildes(u.email.lower()) == buscado), None)

        patch('routes.auth_routes.buscar_usuario_por_email', side_effect=buscar).start()
        patch('routes.usuario_routes.buscar_usuario_por_email', side_effect=buscar).start()

    def test_variantes_del_email_de_una_cuenta_comparten_el_limite(self):
        self.simular_mysql_sin_tildes()
        variantes = ['ana@test.local', 'aná@test.local', 'ána@test.local', 'anà@test.local', 'âna@test.local']
        for numero, email in enumerate(variantes):
            # Desde IPs distintas: el que corta es el límite de la cuenta, no el de la IP.
            self.assertEqual(self.login(email=email, password='equivocada', ip=f'10.1.0.{numero}').status_code, 401)
        self.assertEqual(self.login(email='änä@test.local', ip='10.1.0.9').status_code, 429)
        # Recuperación: el tope de 3 códigos vale para la cuenta, se escriba como se escriba.
        for numero, email in enumerate(variantes):
            self.client.post('/api/recuperar-password', json={'email': email},
                             environ_base={'REMOTE_ADDR': f'10.2.0.{numero}'})
        self.assertEqual(self.envio.call_count, 3)

    def test_recuperar_la_clave_levanta_el_bloqueo_del_login(self):
        for _ in range(5):
            self.login(password='equivocada')
        self.assertEqual(self.login().status_code, 429)
        with patch('routes.auth_routes.secrets.randbelow', return_value=246810):
            self.client.post('/api/recuperar-password', json={'email': 'ana@test.local'})
        self.assertEqual(self.client.post('/api/reset-password', json={
            'email': 'ana@test.local', 'codigo': '246810', 'nueva_password': 'clave-nueva-1'}).status_code, 200)
        self.assertEqual(self.login(password='clave-nueva-1').status_code, 200)

    def test_recuperacion_tiene_limite_por_ip(self):
        for numero in range(10):
            respuesta = self.client.post('/api/recuperar-password', json={'email': f'nadie{numero}@test.local'},
                                         environ_base={'REMOTE_ADDR': '10.3.0.1'})
            self.assertEqual(respuesta.status_code, 200)
        limitado = self.client.post('/api/recuperar-password', json={'email': 'ana@test.local'},
                                    environ_base={'REMOTE_ADDR': '10.3.0.1'})
        self.assertEqual(limitado.status_code, 429)
        self.envio.assert_not_called()
        self.assertEqual(self.client.post('/api/recuperar-password', json={'email': 'ana@test.local'},
                                          environ_base={'REMOTE_ADDR': '10.3.0.2'}).status_code, 200)
        self.envio.assert_called_once()

    def test_reset_tiene_limite_por_ip(self):
        for numero in range(20):
            self.client.post('/api/reset-password', json={
                'email': f'nadie{numero}@test.local', 'codigo': '000000', 'nueva_password': 'clave-nueva-1'},
                environ_base={'REMOTE_ADDR': '10.4.0.1'})
        with patch('routes.auth_routes.secrets.randbelow', return_value=97531):
            self.client.post('/api/recuperar-password', json={'email': 'ana@test.local'},
                             environ_base={'REMOTE_ADDR': '10.4.0.2'})
        datos = {'email': 'ana@test.local', 'codigo': '097531', 'nueva_password': 'clave-nueva-1'}
        self.assertEqual(self.client.post('/api/reset-password', json=datos,
                                          environ_base={'REMOTE_ADDR': '10.4.0.1'}).status_code, 429)


    def test_avisa_una_vez_si_hay_un_proxy_sin_configurar(self):
        from services import limites
        patch.object(limites, '_proxy_avisado', False).start()
        self.app.logger.disabled = False
        cabeceras = {'X-Forwarded-For': '200.1.1.1'}
        with patch.dict(os.environ, {'PROXY_CONFIABLE': '0'}), self.assertLogs(self.app.logger, 'WARNING') as registro:
            for _ in range(2):
                self.client.post('/api/login', json={'email': 'ana@test.local', 'password': 'x'}, headers=cabeceras)
        self.assertEqual(len([m for m in registro.output if 'PROXY_CONFIABLE' in m]), 1)


class EmailsTest(BaseSesionTest):
    def test_registro_guarda_el_email_normalizado_y_detecta_duplicados(self):
        base = {'nombre': 'Ana Nueva', 'password': 'clave-segura', 'rol': 'paciente', 'aceptaTerminos': True}
        self.assertEqual(self.client.post('/api/registro', json={**base, 'email': '  Nueva@Test.LOCAL '}).status_code, 201)
        self.assertIsNotNone(Usuario.query.filter_by(email='nueva@test.local').first())
        duplicado = self.client.post('/api/registro', json={**base, 'email': 'VIEJO@test.local'})
        self.assertEqual(duplicado.status_code, 400)
        self.assertEqual(self.login(email='NUEVA@test.local ', password='clave-segura').status_code, 200)

    def test_cuenta_vieja_con_mayusculas_entra_y_recupera(self):
        self.assertEqual(self.login(email='viejo@test.local').status_code, 200)
        with patch('routes.auth_routes.secrets.randbelow', return_value=112233):
            self.client.post('/api/recuperar-password', json={'email': ' VIEJO@test.local'})
        self.assertEqual(self.client.post('/api/reset-password', json={
            'email': 'viejo@TEST.local', 'codigo': '112233', 'nueva_password': 'clave-nueva-1'}).status_code, 200)

    def test_email_inexistente_igual_verifica_contra_un_hash(self):
        with patch('routes.auth_routes.bcrypt.check_password_hash', return_value=True) as verificar:
            respuesta = self.login(email='nadie@test.local')
        self.assertEqual(respuesta.status_code, 401)
        verificar.assert_called_once()

    def test_recuperacion_manda_el_codigo_por_correo(self):
        with patch('routes.auth_routes.secrets.randbelow', return_value=42):
            self.client.post('/api/recuperar-password', json={'email': 'ana@test.local'})
        self.envio.assert_called_once()
        destino, asunto, texto = self.envio.call_args.args
        self.assertEqual(destino, 'ana@test.local')
        self.assertIn('000042', texto)
        self.assertIn('10 minutos', texto)
        registro = CodigoRecuperacion.query.one()
        self.assertNotIn('000042', registro.codigo_hash)
        self.client.post('/api/recuperar-password', json={'email': 'nadie@test.local'})
        self.envio.assert_called_once()


class CorreoTest(unittest.TestCase):
    def setUp(self):
        self.logger = MagicMock()

    def test_envia_con_starttls_y_login(self):
        with patch.dict(os.environ, CON_SMTP), patch('services.correo.smtplib.SMTP') as smtp:
            servidor = smtp.return_value.__enter__.return_value = smtp.return_value
            self.assertTrue(correo.enviar_correo('ana@test.local', 'Asunto', 'Texto', logger=self.logger))
        smtp.assert_called_once_with('smtp.test.local', 587, timeout=correo.TIMEOUT_SMTP)
        servidor.starttls.assert_called_once()
        servidor.login.assert_called_once_with('avisos@test.local', 'clave-smtp')
        mensaje = servidor.send_message.call_args.args[0]
        self.assertEqual(mensaje['To'], 'ana@test.local')
        self.assertIn('no-responder@test.local', mensaje['From'])

    def test_puerto_465_usa_tls_directo(self):
        with patch.dict(os.environ, {**CON_SMTP, 'SMTP_PORT': '465'}), \
                patch('services.correo.smtplib.SMTP_SSL') as smtp_ssl:
            self.assertTrue(correo.enviar_correo('ana@test.local', 'Asunto', 'Texto', logger=self.logger))
        smtp_ssl.return_value.starttls.assert_not_called()

    def test_un_error_no_lanza_excepcion_ni_loguea_datos_personales(self):
        with patch.dict(os.environ, CON_SMTP), \
                patch('services.correo.smtplib.SMTP', side_effect=OSError('ana@test.local rechazado')):
            self.assertFalse(correo.enviar_correo('ana@test.local', 'Asunto', 'Código 123456', logger=self.logger))
        registrado = str(self.logger.error.call_args)
        self.assertNotIn('ana@test.local', registrado)
        self.assertNotIn('123456', registrado)

    def test_sin_smtp_en_debug_muestra_el_contenido_y_fuera_solo_advierte(self):
        with patch.dict(os.environ, SIN_SMTP), patch('services.correo.smtplib.SMTP') as smtp:
            self.assertFalse(correo.enviar_correo('ana@test.local', 'Asunto', 'Código 123456',
                                                  logger=self.logger, debug=True))
            self.assertIn('Código 123456', self.logger.warning.call_args.args)
            self.logger.reset_mock()
            self.assertFalse(correo.enviar_correo('ana@test.local', 'Asunto', 'Código 123456',
                                                  logger=self.logger, debug=False))
            self.assertNotIn('123456', str(self.logger.warning.call_args))
        smtp.assert_not_called()

    def test_segundo_plano_y_aviso_reutilizable(self):
        with patch.dict(os.environ, CON_SMTP), patch('services.correo.smtplib.SMTP') as smtp:
            hilo = correo.enviar_correo_en_segundo_plano('ana@test.local', 'Asunto', 'Texto')
            self.assertTrue(hilo.daemon)
            hilo.join(5)
            usuario = Usuario(email='ana@test.local')
            correo.enviar_aviso(usuario, 'Tu solicitud fue aceptada', 'La enfermera aceptó tu pedido.').join(5)
            self.assertIsNone(correo.enviar_aviso(Usuario(email=None), 'Asunto', 'Texto'))
        self.assertEqual(smtp.return_value.send_message.call_count, 2)
        aviso = smtp.return_value.send_message.call_args.args[0]
        self.assertIn('Enfered', aviso.get_content())


class MigracionYDemoTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', BCRYPT_LOG_ROUNDS=4)
        db.init_app(self.app)
        bcrypt.init_app(self.app)
        registrar_comandos(self.app)
        self.context = self.app.app_context()
        self.context.push()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_mejoras_agrega_version_y_tablas_sin_tocar_datos(self):
        with db.engine.begin() as connection:
            connection.execute(text(
                'CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, '
                'password_hash VARCHAR(255) NOT NULL, rol VARCHAR(50) NOT NULL, '
                'suspendido BOOLEAN NOT NULL DEFAULT 0, nivelPermiso VARCHAR(30), '
                'versionTerminos VARCHAR(10), aceptoTerminosEn DATETIME)'
            ))
            connection.execute(text(
                "INSERT INTO usuarios (id, email, password_hash, rol) VALUES (1, 'previo@test.local', 'conservar', 'paciente')"
            ))
        inicializar_bd_mejoras()
        inicializar_bd_mejoras()  # Idempotente.
        inspector = inspect(db.engine)
        self.assertIn('versionToken', {c['name'] for c in inspector.get_columns('usuarios')})
        self.assertTrue(inspector.has_table('intentos_acceso'))
        self.assertTrue(inspector.has_table('codigos_recuperacion'))
        usuario = db.session.get(Usuario, 1)
        self.assertEqual((usuario.versionToken, usuario.password_hash), (0, 'conservar'))

    def test_comando_cargar_demo(self):
        db.create_all()
        runner = self.app.test_cli_runner()
        resultado = runner.invoke(args=['cargar-demo'])
        self.assertEqual(resultado.exit_code, 0, resultado.output)
        self.assertIn('13 nuevas', resultado.output)
        self.assertIsNotNone(Usuario.query.filter_by(email='laura.gomez@test.com').first())
        self.assertIn('0 nuevas', runner.invoke(args=['cargar-demo']).output)


if __name__ == '__main__':
    unittest.main()
