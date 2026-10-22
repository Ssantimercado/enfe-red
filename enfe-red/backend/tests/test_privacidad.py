"""Privacidad de datos: cartilla pública, contacto habilitado, teléfono, Ley 25.326 y cifrado del historial."""
import json
import unittest
from datetime import date, datetime, time
from unittest.mock import patch

from cryptography.fernet import Fernet
from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect, text

from database import db
from extensions import bcrypt
from models.calificacion_models import Calificacion
from models.mensaje_models import Mensaje
from models.notificacion_models import Notificacion
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Disponibilidad, Enfermero, Paciente, Usuario
from routes.admin_routes import admin_bp
from routes.auth_routes import auth_bp
from routes.cuenta_routes import cuenta_bp
from routes.solicitud_routes import solicitud_bp
from routes.usuario_routes import normalizar_telefono, usuario_bp
from schema_sprint7 import inicializar_bd_sprint7, recifrar_historiales
from seguridad import configurar_sesiones
from services import cifrado

CLAVE_JWT = 'testing-key-with-at-least-32-characters'
MENSAJE_TELEFONO = 'Escribí el teléfono con código de área, sin 0 ni 15. Por ejemplo: 261 555 1234.'


def crear_app(**config):
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                      JWT_SECRET_KEY=CLAVE_JWT, BCRYPT_LOG_ROUNDS=4, **config)
    app.logger.disabled = True
    db.init_app(app)
    bcrypt.init_app(app)
    configurar_sesiones(JWTManager(app))
    for blueprint in (usuario_bp, auth_bp, solicitud_bp, admin_bp, cuenta_bp):
        app.register_blueprint(blueprint, url_prefix='/api')
    return app


class BasePrivacidadTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app()
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        clave = bcrypt.generate_password_hash('clave-correcta').decode()
        db.session.add_all([
            Usuario(id=1, email='admin@test.local', password_hash=clave, rol='administrador', nivelPermiso='total'),
            Usuario(id=11, email='ana@test.local', password_hash=clave, rol='paciente',
                    versionTerminos='1.0', aceptoTerminosEn=datetime(2030, 1, 1, 12, 0)),
            Usuario(id=12, email='otra@test.local', password_hash=clave, rol='paciente'),
            Usuario(id=21, email='laura@test.local', password_hash=clave, rol='enfermero'),
            Usuario(id=22, email='oculto@test.local', password_hash=clave, rol='enfermero'),
            Usuario(id=23, email='carlos@test.local', password_hash=clave, rol='enfermero'),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', apellido='Pérez', telefono='2611111111',
                     direccion='Casa de Ana 123', historial_medico='Diabetes tipo 2, alérgica a la penicilina',
                     obraSocial='OSEP', latitud=-32.8901, longitud=-68.8402, ubicacion_compartida=True),
            Paciente(id=102, usuario_id=12, nombre='Otra'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', apellido='Gómez', matricula='MP-1',
                      telefono='2612222222', direccion='San Martín 1250', ciudad='Godoy Cruz',
                      verificado=True, disponible=True, latitud=-32.92634, longitud=-68.84449),
            Enfermero(id=202, usuario_id=22, nombre='Oculto', matricula='MP-2', ciudad='Maipú',
                      verificado=False, disponible=True),
            Enfermero(id=203, usuario_id=23, nombre='Carlos', matricula='MP-3', telefono='2613333333',
                      ciudad='godoy  cruz', verificado=True, disponible=True, latitud=-32.92001, longitud=-68.84001),
            Disponibilidad(enfermero_id=201, dia_semana='Lunes', hora_inicio=time(8), hora_fin=time(12)),
            Servicio(idServicio=301, tipoServicio='Curaciones'),
        ])
        db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def token(self, usuario, **claims):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario), additional_claims=claims)}

    def solicitud(self, estado='Pendiente', enfermero=201, paciente=101, fecha=date(2030, 1, 11), hora=time(10)):
        solicitud = SolicitudServicio(idPaciente=paciente, idEnfermero=enfermero, idServicio=301, fecha=fecha,
                                      hora=hora, estado=estado, direccionAtencion='Casa de Ana 123')
        db.session.add(solicitud)
        db.session.commit()
        return solicitud.idSolicitud


class CartillaPublicaTest(BasePrivacidadTest):
    def test_cartilla_no_expone_contacto_ni_ubicacion_exacta(self):
        for ruta in ('/api/enfermeros', '/api/enfermeros/buscar?per_page=100',
                     '/api/enfermeros/buscar?lat=-32.8895&lng=-68.8458'):
            with self.subTest(ruta=ruta):
                respuesta = self.client.get(ruta)
                self.assertEqual(respuesta.status_code, 200)
                lista = respuesta.json if isinstance(respuesta.json, list) else respuesta.json['enfermeros']
                laura = next(e for e in lista if e['id'] == 21)
                for campo in ('email', 'telefono', 'direccion'):
                    self.assertNotIn(campo, laura)
                self.assertEqual((laura['latitud'], laura['longitud']), (-32.93, -68.84))
                texto = respuesta.get_data(as_text=True)
                self.assertNotIn('laura@test.local', texto)
                self.assertNotIn('2612222222', texto)
                self.assertNotIn('San Martín', texto)
                self.assertNotIn(22, [e['id'] for e in lista])

    def test_cercania_usa_la_ubicacion_aproximada(self):
        lista = self.client.get('/api/enfermeros/buscar?lat=-32.9190&lng=-68.8390').json['enfermeros']
        self.assertEqual([e['id'] for e in lista], [23, 21])
        self.assertTrue(all(isinstance(e['distancia_km'], int) for e in lista))

    def test_radio_y_distancia_no_distinguen_domicilios_de_la_misma_zona(self):
        # Mismo punto redondeado que Laura (-32.93, -68.84), pero a cientos de metros de ella.
        db.session.add(Usuario(id=24, email='vecina@test.local', password_hash='x', rol='enfermero'))
        db.session.flush()
        db.session.add(Enfermero(id=204, usuario_id=24, nombre='Vecina', matricula='MP-4', verificado=True,
                                 disponible=True, latitud=-32.9251, longitud=-68.8351))
        db.session.commit()
        # El origen está casi encima de la vecina: con las coordenadas exactas saldría primero y más cerca.
        origen = 'lat=-32.9252&lng=-68.8352'
        for radio in ('', '&radio_km=1', '&radio_km=2', '&radio_km=5'):
            with self.subTest(radio=radio):
                lista = self.client.get(f'/api/enfermeros/buscar?{origen}{radio}').json['enfermeros']
                cercanas = {e['id']: e['distancia_km'] for e in lista if e['id'] in (21, 24)}
                self.assertIn(len(cercanas), (0, 2))
                self.assertEqual(len(set(cercanas.values())), min(len(cercanas), 1))
        lista = self.client.get(f'/api/enfermeros/buscar?{origen}').json['enfermeros']
        # Empatadas, el orden es por id y no por la distancia real.
        self.assertEqual([e['id'] for e in lista if e['id'] in (21, 24)], [21, 24])

    def test_radio_solo_en_kilometros_enteros(self):
        for radio in ('1.5', '0.1', '2.0001', 'abc'):
            with self.subTest(radio=radio):
                respuesta = self.client.get(f'/api/enfermeros/buscar?lat=-32.93&lng=-68.84&radio_km={radio}')
                self.assertEqual(respuesta.status_code, 400)

    def test_busqueda_no_encuentra_por_direccion(self):
        self.assertEqual(self.client.get('/api/enfermeros/buscar?q=San%20Mart').json['total_resultados'], 0)

    def test_ciudades_de_la_cartilla_ordenadas_y_sin_repetir(self):
        db.session.add(Usuario(id=24, email='lujan@test.local', password_hash='x', rol='enfermero'))
        db.session.flush()
        db.session.add(Enfermero(id=204, usuario_id=24, matricula='MP-4', ciudad=' Luján de Cuyo ',
                                 verificado=True, disponible=True))
        db.session.commit()
        respuesta = self.client.get('/api/enfermeros/ciudades')
        self.assertEqual(respuesta.status_code, 200)
        # Maipú es de un enfermero sin verificar: no aparece.
        self.assertEqual(respuesta.json, ['Godoy Cruz', 'Luján de Cuyo'])


class PerfilPorIdTest(BasePrivacidadTest):
    def test_perfil_publico_sin_email_ni_telefono_hasta_tener_turno_aceptado(self):
        ruta = '/api/usuarios/21'
        perfil = self.client.get(ruta, headers=self.token(11)).json
        self.assertEqual(perfil['nombre'], 'Laura')
        self.assertFalse(perfil['contacto_habilitado'])
        for campo in ('email', 'telefono', 'direccion'):
            self.assertNotIn(campo, perfil)
        self.assertEqual(len(perfil['horarios']), 1)

        id_solicitud = self.solicitud('Pendiente')
        self.assertFalse(self.client.get(ruta, headers=self.token(11)).json['contacto_habilitado'])
        db.session.get(SolicitudServicio, id_solicitud).estado = 'Aceptada'
        db.session.commit()
        perfil = self.client.get(ruta, headers=self.token(11)).json
        self.assertTrue(perfil['contacto_habilitado'])
        self.assertEqual(perfil['telefono'], '2612222222')
        self.assertNotIn('email', perfil)
        # Otro paciente sin turno aceptado sigue sin verlo.
        otro = self.client.get(ruta, headers=self.token(12)).json
        self.assertFalse(otro['contacto_habilitado'])
        self.assertNotIn('telefono', otro)

    def test_solo_enfermeros_visibles_para_terceros(self):
        for destino in (11, 12, 1, 22, 999):
            with self.subTest(destino=destino):
                respuesta = self.client.get(f'/api/usuarios/{destino}', headers=self.token(21))
                self.assertEqual(respuesta.status_code, 404)
                self.assertNotIn('@', respuesta.get_data(as_text=True))

    def test_titular_y_administrador_ven_mas(self):
        propio = self.client.get('/api/usuarios/11', headers=self.token(11)).json
        self.assertEqual(propio['email'], 'ana@test.local')
        self.assertEqual(propio['historial_medico'], 'Diabetes tipo 2, alérgica a la penicilina')
        admin = self.token(1, rol='administrador', nivelPermiso='total')
        visto_por_admin = self.client.get('/api/usuarios/11', headers=admin).json
        self.assertEqual(visto_por_admin['email'], 'ana@test.local')
        self.assertNotIn('historial_medico', visto_por_admin)
        oculto = self.client.get('/api/usuarios/22', headers=admin).json
        self.assertEqual((oculto['email'], oculto['matricula']), ('oculto@test.local', 'MP-2'))

    def test_solicitudes_del_paciente_traen_contacto_solo_si_esta_aceptada(self):
        pendiente = self.solicitud('Pendiente', hora=time(9))
        aceptada = self.solicitud('Aceptada', hora=time(11))
        lista = self.client.get('/api/solicitudes/paciente/101', headers=self.token(11)).json
        por_id = {s['idSolicitud']: s for s in lista}
        self.assertIsNone(por_id[pendiente]['contacto'])
        self.assertNotIn('telefono', por_id[pendiente]['enfermero'])
        self.assertEqual(por_id[aceptada]['contacto'], {'telefono': '2612222222', 'email': 'laura@test.local'})
        # El enfermero sigue viendo el teléfono del paciente.
        recibidas = self.client.get('/api/solicitudes/enfermero/201', headers=self.token(21)).json
        self.assertTrue(all(s['paciente']['telefono'] == '2611111111' for s in recibidas))


class TelefonoTest(BasePrivacidadTest):
    def test_normaliza_las_formas_habituales(self):
        for escrito in ('261 555 1234', '0261 555-1234', '(0261) 15 555 1234', '261 15 5551234',
                        '+54 9 261 555 1234', '5492615551234', '+54 261 555 1234'):
            with self.subTest(escrito=escrito):
                self.assertEqual(normalizar_telefono(escrito), '2615551234')
        self.assertEqual(normalizar_telefono('011 15 4444 5555'), '1144445555')
        for invalido in ('123', '555 1234', '261 555 12345 67', 'sin teléfono'):
            with self.subTest(invalido=invalido):
                self.assertIsNone(normalizar_telefono(invalido))

    def test_perfiles_validan_y_guardan_el_telefono_normalizado(self):
        for ruta, usuario in (('/api/perfil/paciente', 11), ('/api/perfil/enfermero', 21)):
            with self.subTest(ruta=ruta):
                headers = self.token(usuario)
                respuesta = self.client.put(ruta, headers=headers, json={'telefono': '0261 15 555-1234'})
                self.assertEqual(respuesta.status_code, 200, respuesta.json)
                self.assertEqual(respuesta.json['telefono'], '2615551234')
                for invalido in ('123', 12345, '9' * 41):
                    respuesta = self.client.put(ruta, headers=headers, json={'telefono': invalido})
                    self.assertEqual((respuesta.status_code, respuesta.json['error']), (400, MENSAJE_TELEFONO))
                respuesta = self.client.put(ruta, headers=headers, json={'telefono': '  '})
                self.assertEqual((respuesta.status_code, respuesta.json['telefono']), (200, ''))


class ExportarDatosTest(BasePrivacidadTest):
    def test_exporta_todos_los_datos_del_titular(self):
        realizada = self.solicitud('Realizada', fecha=date(2030, 1, 5))
        db.session.add_all([
            Mensaje(idSolicitud=realizada, idEmisor=11, contenido='Hola Laura'),
            Mensaje(idSolicitud=realizada, idEmisor=21, contenido='Mensaje de otra persona'),
            Calificacion(idSolicitud=realizada, idUsuarioAutor=11, idUsuarioCalificado=21,
                         estrellas=5, comentario='Excelente'),
            Notificacion(idUsuario=11, tipo='aceptada', mensaje='Laura aceptó tu solicitud'),
            Notificacion(idUsuario=12, tipo='mensaje', mensaje='Ajena'),
        ])
        db.session.commit()
        respuesta = self.client.get('/api/cuenta/exportar', headers=self.token(11))
        self.assertEqual(respuesta.status_code, 200)
        self.assertIn('attachment', respuesta.headers['Content-Disposition'])
        self.assertEqual(respuesta.headers['Cache-Control'], 'no-store')
        datos = json.loads(respuesta.get_data(as_text=True))
        self.assertEqual(datos['cuenta']['email'], 'ana@test.local')
        self.assertEqual(datos['perfil']['historial_medico'], 'Diabetes tipo 2, alérgica a la penicilina')
        self.assertEqual(datos['consentimiento'], {'versionTerminos': '1.0', 'aceptoTerminosEn': '2030-01-01T12:00:00Z'})
        self.assertEqual([s['idSolicitud'] for s in datos['solicitudes']], [realizada])
        self.assertEqual([m['contenido'] for m in datos['mensajesEnviados']], ['Hola Laura'])
        self.assertEqual(len(datos['calificaciones']['escritas']), 1)
        self.assertEqual([n['mensaje'] for n in datos['notificaciones']], ['Laura aceptó tu solicitud'])
        enfermero = self.client.get('/api/cuenta/exportar', headers=self.token(21)).json
        self.assertEqual(len(enfermero['calificaciones']['recibidas']), 1)
        self.assertEqual(enfermero['perfil']['horarios'][0]['dia_semana'], 'Lunes')
        self.assertEqual(self.client.get('/api/cuenta/exportar').status_code, 401)


class EliminarCuentaTest(BasePrivacidadTest):
    def setUp(self):
        super().setUp()
        self.reloj = patch('routes.cuenta_routes._ahora_local', return_value=datetime(2030, 1, 10, 10, 0))
        self.reloj.start()
        self.addCleanup(self.reloj.stop)

    def eliminar(self, usuario, password='clave-correcta', **claims):
        return self.client.delete('/api/cuenta', headers=self.token(usuario, **claims), json={'password': password})

    def test_pide_la_contrasena_correcta(self):
        self.assertEqual(self.client.delete('/api/cuenta', headers=self.token(11), json={}).status_code, 400)
        respuesta = self.eliminar(11, 'otra-clave')
        self.assertEqual((respuesta.status_code, respuesta.json['error']), (400, 'La contraseña no es correcta'))
        self.assertFalse(db.session.get(Usuario, 11).eliminado)

    def test_paciente_anonimizado_y_turnos_cancelados_con_aviso(self):
        pendiente = self.solicitud('Pendiente', hora=time(9))
        futura = self.solicitud('Aceptada', hora=time(11))
        pasada = self.solicitud('Aceptada', fecha=date(2030, 1, 9))
        realizada = self.solicitud('Realizada', fecha=date(2030, 1, 5))
        db.session.add_all([
            Mensaje(idSolicitud=realizada, idEmisor=11, contenido='Gracias'),
            Calificacion(idSolicitud=realizada, idUsuarioAutor=11, idUsuarioCalificado=21,
                         estrellas=4, comentario='Muy buena'),
            Notificacion(idUsuario=11, tipo='aceptada', mensaje='Propia'),
        ])
        db.session.commit()
        respuesta = self.eliminar(11)
        self.assertEqual(respuesta.status_code, 200, respuesta.json)
        self.assertEqual(respuesta.json['solicitudesCanceladas'], 2)

        db.session.expire_all()
        usuario = db.session.get(Usuario, 11)
        self.assertEqual(usuario.email, 'eliminado-11@enfered.invalid')
        self.assertTrue(usuario.eliminado and usuario.suspendido)
        self.assertEqual(usuario.versionToken, 1)
        paciente = db.session.get(Paciente, 101)
        self.assertEqual(paciente.nombre, 'Cuenta eliminada')
        self.assertEqual(
            (paciente.apellido, paciente.telefono, paciente.direccion, paciente.historial_medico,
             paciente.obraSocial, paciente.latitud, paciente.longitud, paciente.ubicacion_compartida),
            (None, None, None, None, None, None, None, False),
        )
        estados = {s.idSolicitud: s.estado for s in SolicitudServicio.query}
        self.assertEqual(estados, {pendiente: 'Cancelada', futura: 'Cancelada', pasada: 'Aceptada',
                                   realizada: 'Realizada'})
        self.assertEqual({s.direccionAtencion for s in SolicitudServicio.query}, {'Dirección eliminada'})
        avisos = Notificacion.query.filter_by(idUsuario=21, tipo='cancelada').all()
        self.assertEqual({a.idSolicitud for a in avisos}, {pendiente, futura})
        self.assertIn('Ana Pérez eliminó su cuenta', avisos[0].mensaje)
        self.assertEqual(Notificacion.query.filter_by(idUsuario=11).count(), 0)
        # Integridad: el mensaje y la reseña siguen (con el autor anonimizado).
        self.assertEqual((Mensaje.query.count(), Calificacion.query.count()), (1, 1))
        # El token anterior ya no sirve y la contraseña tampoco.
        self.assertEqual(self.client.get('/api/perfil/paciente', headers=self.token(11)).status_code, 401)
        login = self.client.post('/api/login', json={'email': 'ana@test.local', 'password': 'clave-correcta'})
        self.assertEqual(login.status_code, 401)

    def test_enfermero_sale_de_la_cartilla_y_avisa_al_paciente(self):
        pendiente = self.solicitud('Pendiente')
        respuesta = self.eliminar(21)
        self.assertEqual(respuesta.status_code, 200, respuesta.json)
        db.session.expire_all()
        enfermero = db.session.get(Enfermero, 201)
        self.assertEqual((enfermero.nombre, enfermero.telefono, enfermero.direccion, enfermero.latitud),
                         ('Cuenta eliminada', None, None, None))
        self.assertFalse(enfermero.verificado or enfermero.disponible)
        self.assertEqual(enfermero.disponibilidades, [])
        self.assertNotIn(21, [e['id'] for e in self.client.get('/api/enfermeros').json])
        self.assertEqual(self.client.get('/api/usuarios/21', headers=self.token(11)).status_code, 404)
        aviso = Notificacion.query.filter_by(idUsuario=11, tipo='cancelada').one()
        self.assertEqual(aviso.idSolicitud, pendiente)
        self.assertIn('Laura Gómez ya no atiende por Enfered', aviso.mensaje)
        # Ni la revisión de matrículas ni el administrador pueden reactivarla.
        admin = self.token(1, rol='administrador', nivelPermiso='total')
        pendientes = self.client.get('/api/admin/enfermeros/pendientes', headers=admin).json['enfermeros']
        self.assertNotIn(201, [e['idEnfermero'] for e in pendientes])
        reactivar = self.client.put('/api/admin/usuarios/21/suspension', headers=admin, json={'suspendido': False})
        self.assertEqual(reactivar.status_code, 409)

    def test_unico_administrador_no_puede_eliminarse(self):
        respuesta = self.eliminar(1, rol='administrador', nivelPermiso='total')
        self.assertEqual(respuesta.status_code, 409)
        self.assertFalse(db.session.get(Usuario, 1).eliminado)
        db.session.add(Usuario(id=2, email='admin2@test.local', password_hash='x', rol='administrador',
                               nivelPermiso='total'))
        db.session.commit()
        self.assertEqual(self.eliminar(1, rol='administrador', nivelPermiso='total').status_code, 200)


class CifradoHistorialTest(BasePrivacidadTest):
    def valor_guardado(self, id_paciente=101):
        with db.engine.connect() as connection:
            return connection.execute(
                text('SELECT historial_medico FROM pacientes WHERE id = :id'), {'id': id_paciente}
            ).scalar()

    def test_se_guarda_cifrado_y_se_lee_descifrado(self):
        guardado = self.valor_guardado()
        self.assertTrue(cifrado.parece_cifrado(guardado))
        self.assertNotIn('Diabetes', guardado)
        self.assertEqual(db.session.get(Paciente, 101).historial_medico, 'Diabetes tipo 2, alérgica a la penicilina')
        respuesta = self.client.put('/api/perfil/paciente', headers=self.token(11),
                                    json={'historial_medico': 'Hipertensión'})
        self.assertEqual(respuesta.json['historial_medico'], 'Hipertensión')
        self.assertNotIn('Hipertensión', self.valor_guardado())

    def test_valores_viejos_en_texto_plano_se_siguen_leyendo(self):
        with db.engine.begin() as connection:
            connection.execute(text("UPDATE pacientes SET historial_medico = 'Asma leve' WHERE id = 101"))
        db.session.expire_all()
        self.assertEqual(db.session.get(Paciente, 101).historial_medico, 'Asma leve')

    def test_token_de_otra_clave_no_se_devuelve_como_texto(self):
        ajeno = Fernet(Fernet.generate_key()).encrypt(b'Otro dato').decode()
        with db.engine.begin() as connection:
            connection.execute(text('UPDATE pacientes SET historial_medico = :v WHERE id = 101'), {'v': ajeno})
        db.session.expire_all()
        with self.assertRaises(cifrado.ErrorCifrado):
            db.session.get(Paciente, 101).historial_medico

    def test_migracion_cifra_texto_plano_una_sola_vez(self):
        with db.engine.begin() as connection:
            connection.execute(text("UPDATE pacientes SET historial_medico = 'Asma leve' WHERE id = 101"))
            connection.execute(text("UPDATE pacientes SET historial_medico = '' WHERE id = 102"))
        inicializar_bd_sprint7()
        primero = self.valor_guardado()
        self.assertTrue(cifrado.parece_cifrado(primero))
        inicializar_bd_sprint7()  # Idempotente: no vuelve a cifrar lo ya cifrado.
        self.assertEqual(self.valor_guardado(), primero)
        self.assertEqual(self.valor_guardado(102), '')
        db.session.expire_all()
        self.assertEqual(db.session.get(Paciente, 101).historial_medico, 'Asma leve')


    def test_historial_ilegible_no_rompe_el_perfil_ni_se_pisa(self):
        ajeno = Fernet(Fernet.generate_key()).encrypt(b'Dato con otra clave').decode()
        with db.engine.begin() as connection:
            connection.execute(text('UPDATE pacientes SET historial_medico = :v WHERE id = 101'), {'v': ajeno})
        db.session.expire_all()
        perfil = self.client.get('/api/perfil/paciente', headers=self.token(11))
        self.assertEqual(perfil.status_code, 200)
        self.assertIsNone(perfil.json['historial_medico'])
        self.assertTrue(perfil.json['historialIlegible'])
        # Cambiar solo el teléfono (lo pide "Solicitar servicio") funciona y no toca el historial.
        respuesta = self.client.put('/api/perfil/paciente', headers=self.token(11), json={'telefono': '261 555 1234'})
        self.assertEqual(respuesta.status_code, 200)
        # El formulario completo manda el campo vacío: tampoco pisa el dato que se puede recuperar.
        respuesta = self.client.put('/api/perfil/paciente', headers=self.token(11),
                                    json={'nombre': 'Ana', 'historial_medico': ''})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(self.valor_guardado(), ajeno)
        self.assertEqual(self.client.get('/api/cuenta/exportar', headers=self.token(11)).status_code, 200)
        respuesta = self.client.put('/api/perfil/paciente', headers=self.token(11),
                                    json={'historial_medico': 'Escrito de nuevo'})
        self.assertEqual(respuesta.json['historial_medico'], 'Escrito de nuevo')
        self.assertNotIn('historialIlegible', respuesta.json)


class RotacionClaveTest(unittest.TestCase):
    def setUp(self):
        self.nueva, self.vieja = Fernet.generate_key().decode(), Fernet.generate_key().decode()
        self.app = crear_app(CLAVE_CIFRADO_DATOS=self.nueva, CLAVE_CIFRADO_ANTERIOR=self.vieja)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add(Usuario(id=11, email='ana@test.local', password_hash='x', rol='paciente'))
        db.session.commit()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def guardar(self, valores):
        with db.engine.begin() as connection:
            for id_paciente, valor in valores.items():
                connection.execute(text(
                    'INSERT INTO pacientes (id, usuario_id, historial_medico, ubicacion_compartida) '
                    'VALUES (:id, :id, :v, 0)'), {'id': id_paciente, 'v': valor})

    def leer(self, id_paciente):
        with db.engine.connect() as connection:
            return connection.execute(text('SELECT historial_medico FROM pacientes WHERE id = :id'),
                                      {'id': id_paciente}).scalar()

    def test_pasa_todo_a_la_clave_nueva_y_avisa_lo_ilegible(self):
        desarrollo = Fernet(cifrado._clave_desarrollo(self.app))
        ajeno = Fernet(Fernet.generate_key()).encrypt(b'Perdido').decode()
        self.guardar({
            1: Fernet(self.vieja).encrypt('Asma'.encode()).decode(),
            2: desarrollo.encrypt('Celíaca'.encode()).decode(),
            3: 'Hipertensión',
            4: ajeno,
            5: Fernet(self.nueva).encrypt(b'Ya con la nueva').decode(),
        })
        ya_nueva = self.leer(5)
        self.assertEqual(recifrar_historiales(), (3, 1))
        for id_paciente, texto in ((1, 'Asma'), (2, 'Celíaca'), (3, 'Hipertensión')):
            self.assertEqual(Fernet(self.nueva).decrypt(self.leer(id_paciente).encode()).decode(), texto)
        self.assertEqual(self.leer(4), ajeno)
        self.assertEqual(self.leer(5), ya_nueva)
        self.assertEqual(recifrar_historiales(), (0, 1))
        from cli_admin import registrar_comandos
        registrar_comandos(self.app)
        resultado = self.app.test_cli_runner().invoke(args=['recifrar-historiales'])
        self.assertNotEqual(resultado.exit_code, 0)
        self.assertIn('CLAVE_CIFRADO_ANTERIOR', resultado.output)


class DesarrolloSinClaveTest(unittest.TestCase):
    def setUp(self):
        entorno = patch.dict('os.environ', {'CLAVE_CIFRADO_DATOS': '', 'CLAVE_CIFRADO_ANTERIOR': '',
                                            'FLASK_DEBUG': '1'})
        entorno.start()
        self.addCleanup(entorno.stop)
        self.app = crear_app()
        # Como el servidor de desarrollo: no son las pruebas, así que no se deriva una clave para cifrar.
        self.app.config['TESTING'] = False
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_no_cifra_datos_reales_con_la_clave_de_desarrollo(self):
        db.session.add(Usuario(id=11, email='ana@test.local', password_hash='x', rol='paciente'))
        db.session.flush()
        db.session.add(Paciente(id=101, usuario_id=11, historial_medico='Diabetes'))
        db.session.add(Usuario(id=12, email='b@test.local', password_hash='x', rol='paciente'))
        db.session.commit()
        with db.engine.begin() as connection:
            connection.execute(text("INSERT INTO pacientes (id, usuario_id, historial_medico, ubicacion_compartida) "
                                    "VALUES (102, 12, 'Asma', 0)"))
        inicializar_bd_sprint7()
        with db.engine.connect() as connection:
            valores = connection.execute(text('SELECT historial_medico FROM pacientes ORDER BY id')).scalars().all()
        self.assertEqual(valores, ['Diabetes', 'Asma'])


class ConfiguracionCifradoTest(unittest.TestCase):
    def setUp(self):
        self.entorno = patch.dict('os.environ', {'CLAVE_CIFRADO_DATOS': '', 'FLASK_DEBUG': '0'})
        self.entorno.start()
        self.addCleanup(self.entorno.stop)

    def app(self, DEBUG=False, **config):
        # Otro nombre de logger: las demás pruebas desactivan el de este módulo.
        app = Flask('prueba_cifrado')
        app.config.update(JWT_SECRET_KEY=CLAVE_JWT, DEBUG=DEBUG, **config)
        return app

    def test_fuera_de_debug_sin_clave_no_arranca(self):
        with self.assertRaises(RuntimeError) as error:
            cifrado.configurar_cifrado(self.app())
        self.assertIn('CLAVE_CIFRADO_DATOS', str(error.exception))

    def test_en_desarrollo_avisa_y_no_cifra_pero_lee_lo_cifrado_antes(self):
        with patch.dict('os.environ', {'FLASK_DEBUG': '1'}):
            app_debug = self.app(DEBUG=True)
            with self.assertLogs(app_debug.logger, 'WARNING'):
                primera = cifrado.configurar_cifrado(app_debug)
            self.assertFalse(cifrado.cifrado_activo(app_debug))
            otra = cifrado.configurar_cifrado(self.app(DEBUG=True))
        # Datos cifrados por una versión anterior con la clave de desarrollo se siguen leyendo.
        token = primera.encrypt(b'dato')
        self.assertEqual(otra.decrypt(token), b'dato')

    def test_flask_debug_distinto_de_1_cuenta_como_produccion(self):
        for valor in ('true', 'yes', 'True'):
            with self.subTest(valor=valor), patch.dict('os.environ', {'FLASK_DEBUG': valor}):
                # Flask lo toma como debug, pero el resto del backend no: sin clave no arranca.
                with self.assertRaises(RuntimeError):
                    cifrado.configurar_cifrado(self.app(DEBUG=True))

    def test_clave_configurada_y_clave_invalida(self):
        clave = Fernet.generate_key().decode()
        fernet = cifrado.configurar_cifrado(self.app(CLAVE_CIFRADO_DATOS=clave))
        self.assertEqual(Fernet(clave).decrypt(fernet.encrypt(b'x')), b'x')
        with self.assertRaises(RuntimeError):
            cifrado.configurar_cifrado(self.app(CLAVE_CIFRADO_DATOS='no-es-una-clave'))


class MigracionPrivacidadTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app()
        self.context = self.app.app_context()
        self.context.push()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_agrega_eliminado_y_cifra_historiales_existentes(self):
        with db.engine.begin() as connection:
            connection.execute(text(
                'CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, '
                'password_hash VARCHAR(255) NOT NULL, rol VARCHAR(50) NOT NULL, '
                'suspendido BOOLEAN NOT NULL DEFAULT 0, nivelPermiso VARCHAR(30), '
                'versionTerminos VARCHAR(10), aceptoTerminosEn DATETIME)'
            ))
            connection.execute(text(
                'CREATE TABLE pacientes (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL UNIQUE, '
                'nombre VARCHAR(100), historial_medico TEXT)'
            ))
            connection.execute(text(
                "INSERT INTO usuarios (id, email, password_hash, rol) VALUES (1, 'previo@test.local', 'x', 'paciente')"
            ))
            connection.execute(text(
                "INSERT INTO pacientes (id, usuario_id, nombre, historial_medico) VALUES (1, 1, 'Previo', 'Celíaca')"
            ))
        inicializar_bd_sprint7()
        inicializar_bd_sprint7()
        self.assertIn('eliminado', {c['name'] for c in inspect(db.engine).get_columns('usuarios')})
        with db.engine.connect() as connection:
            fila = connection.execute(text('SELECT u.eliminado, p.historial_medico FROM usuarios u '
                                           'JOIN pacientes p ON p.usuario_id = u.id')).one()
        self.assertFalse(fila[0])
        self.assertTrue(cifrado.parece_cifrado(fila[1]))
        self.assertEqual(cifrado.descifrar(fila[1]), 'Celíaca')


if __name__ == '__main__':
    unittest.main()
