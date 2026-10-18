import unittest
from datetime import date, time, timedelta, datetime, timezone
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from database import db
from models.usuario_models import Usuario, Paciente, Enfermero
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.mensaje_models import Mensaje
from routes.comunicacion_routes import comunicacion_bp


class ComunicacionTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
        self.app.logger.disabled = True
        db.init_app(self.app)
        JWTManager(self.app)
        self.app.register_blueprint(comunicacion_bp, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        with db.engine.connect() as connection:
            connection.exec_driver_sql('PRAGMA foreign_keys=ON')
        db.create_all()
        db.session.add_all([
            Usuario(id=i, email=f'{i}@test.local', password_hash='privado', rol=rol)
            for i, rol in [(11, 'paciente'), (12, 'paciente'), (21, 'enfermero'), (22, 'enfermero')]
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', historial_medico='CONFIDENCIAL'),
            Paciente(id=102, usuario_id=12, nombre='Otro'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', matricula='MAT-1'),
            Enfermero(id=202, usuario_id=22, nombre='Otro', matricula='MAT-2'),
            Servicio(idServicio=301, tipoServicio='Curaciones', precioEstimado=8000),
        ])
        db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def headers(self, usuario=11, **kwargs):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario), **kwargs)}

    def solicitud(self, estado='Aceptada', paciente=101, enfermero=201, fecha=None, hora=None):
        item = SolicitudServicio(idPaciente=paciente, idEnfermero=enfermero, idServicio=301,
                                 fecha=fecha or date(2030, 1, 10), hora=hora or time(10), estado=estado,
                                 direccionAtencion='Dirección de prueba')
        db.session.add(item)
        db.session.commit()
        return item.idSolicitud

    def test_historial_filtra_estados_y_participantes(self):
        hoy = datetime.now(timezone(timedelta(hours=-3))).date()
        pasado = hoy - timedelta(days=2)
        ids = {
            'Pendiente': self.solicitud('Pendiente', fecha=pasado),
            'Aceptada_futura': self.solicitud('Aceptada', fecha=hoy + timedelta(days=1)),
            'Aceptada_pasada': self.solicitud('Aceptada', fecha=pasado),
            'Realizada': self.solicitud('Realizada', fecha=hoy - timedelta(days=1)),
            'Rechazada': self.solicitud('Rechazada', fecha=pasado),
            'Cancelada': self.solicitud('Cancelada', fecha=pasado),
        }
        self.solicitud('Realizada', paciente=102, enfermero=202, fecha=pasado)
        for usuario in (11, 21):
            response = self.client.get(f'/api/usuarios/{usuario}/historial', headers=self.headers(usuario))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                [item['idSolicitud'] for item in response.json],
                [ids['Realizada'], ids['Aceptada_pasada']],
            )
            self.assertNotIn('CONFIDENCIAL', response.get_data(as_text=True))
            self.assertNotIn('password_hash', response.get_data(as_text=True))

    def test_historial_privado_y_vacio(self):
        self.assertEqual(self.client.get('/api/usuarios/11/historial', headers=self.headers()).json, [])
        self.assertEqual(self.client.get('/api/usuarios/12/historial', headers=self.headers()).status_code, 403)
        self.assertEqual(self.client.get('/api/usuarios/101/historial', headers=self.headers()).status_code, 403)

    def test_historial_incluye_solicitud_de_hoy_cuando_paso_la_hora_del_servicio(self):
        ahora = datetime(2026, 10, 18, 13, 24, tzinfo=timezone(timedelta(hours=-3)))
        pasada = self.solicitud(fecha=ahora.date(), hora=time(13, 22))
        futura = self.solicitud(fecha=ahora.date(), hora=time(13, 25))
        with patch('routes.comunicacion_routes.datetime') as reloj:
            reloj.now.return_value = ahora
            response = self.client.get(
                '/api/usuarios/11/historial',
                headers=self.headers(),
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['idSolicitud'] for item in response.json], [pasada])
        self.assertNotIn(futura, [item['idSolicitud'] for item in response.json])

    def test_participantes_pueden_calificarse_una_vez_y_ver_ambas_calificaciones(self):
        id_solicitud = self.solicitud(fecha=date(2020, 1, 10))
        ruta = f'/api/solicitudes/{id_solicitud}/calificaciones'
        paciente = self.client.post(
            ruta,
            headers=self.headers(11),
            json={'estrellas': 5, 'comentario': 'Excelente atención.'},
        )
        self.assertEqual(paciente.status_code, 201)
        self.assertEqual(paciente.json['calificacion']['idUsuarioCalificado'], 21)
        self.assertEqual(
            self.client.post(
                ruta,
                headers=self.headers(11),
                json={'estrellas': 4, 'comentario': 'Otra opinión.'},
            ).status_code,
            409,
        )

        enfermero = self.client.post(
            ruta,
            headers=self.headers(21),
            json={'estrellas': 4, 'comentario': 'Buena comunicación.'},
        )
        self.assertEqual(enfermero.status_code, 201)
        self.assertEqual(enfermero.json['calificacion']['idUsuarioCalificado'], 11)
        historial = self.client.get('/api/usuarios/11/historial', headers=self.headers(11))
        self.assertEqual(historial.status_code, 200)
        self.assertEqual(len(historial.json[0]['calificaciones']), 2)

    def test_calificacion_valida_escala_y_limite_de_palabras(self):
        id_solicitud = self.solicitud(fecha=date(2020, 1, 10))
        ruta = f'/api/solicitudes/{id_solicitud}/calificaciones'
        for datos in (
            {'estrellas': 0, 'comentario': 'Opinión'},
            {'estrellas': 6, 'comentario': 'Opinión'},
            {'estrellas': True, 'comentario': 'Opinión'},
            {'estrellas': 5, 'comentario': ''},
            {'estrellas': 5, 'comentario': 'palabra ' * 251},
        ):
            with self.subTest(datos=datos):
                self.assertEqual(
                    self.client.post(ruta, headers=self.headers(), json=datos).status_code,
                    400,
                )
        response = self.client.post(
            ruta,
            headers=self.headers(),
            json={'estrellas': 1, 'comentario': 'palabra ' * 249 + 'final'},
        )
        self.assertEqual(response.status_code, 201)

    def test_solo_participantes_y_servicios_ya_aceptados_y_vencidos_pueden_calificar(self):
        ruta = f'/api/solicitudes/{self.solicitud(fecha=date(2020, 1, 10))}/calificaciones'
        datos = {'estrellas': 5, 'comentario': 'Buen servicio.'}
        self.assertEqual(
            self.client.post(ruta, headers=self.headers(12), json=datos).status_code,
            403,
        )
        self.assertEqual(self.client.post(ruta, json=datos).status_code, 401)

        pendiente = self.solicitud('Pendiente', fecha=date(2020, 1, 10))
        response = self.client.post(
            f'/api/solicitudes/{pendiente}/calificaciones',
            headers=self.headers(),
            json=datos,
        )
        self.assertEqual(response.status_code, 409)

        futura = self.solicitud(fecha=date(2030, 1, 10))
        response = self.client.post(
            f'/api/solicitudes/{futura}/calificaciones',
            headers=self.headers(),
            json=datos,
        )
        self.assertEqual(response.status_code, 409)

    def test_chat_bidireccional_orden_y_fecha_utc(self):
        ruta = f'/api/solicitudes/{self.solicitud()}/mensajes'
        self.assertEqual(self.client.get(ruta, headers=self.headers()).json, [])
        for usuario in (11, 21):
            response = self.client.post(ruta, headers=self.headers(usuario), json={'contenido': '  Hola, ¿cómo estás?  '})
            self.assertEqual(response.status_code, 201)
            self.assertEqual(response.json['idEmisor'], usuario)
            self.assertEqual(response.json['contenido'], 'Hola, ¿cómo estás?')
            self.assertTrue(response.json['fechaHora'].endswith('Z'))
        for usuario in (11, 21):
            items = self.client.get(ruta, headers=self.headers(usuario)).json
            self.assertEqual([m['idEmisor'] for m in items], [11, 21])
            self.assertLess(items[0]['idMensaje'], items[1]['idMensaje'])

    def test_otros_usuarios_no_pueden_leer_ni_enviar(self):
        ruta = f'/api/solicitudes/{self.solicitud()}/mensajes'
        for usuario in (12, 22):
            self.assertEqual(self.client.get(ruta, headers=self.headers(usuario)).status_code, 403)
            self.assertEqual(self.client.post(ruta, headers=self.headers(usuario), json={'contenido': 'Hola'}).status_code, 403)
        self.assertEqual(Mensaje.query.count(), 0)

    def test_estados_no_aceptados_bloquean_envio(self):
        for estado in ('Pendiente', 'Rechazada', 'Cancelada', 'Realizada'):
            ruta = f'/api/solicitudes/{self.solicitud(estado)}/mensajes'
            for usuario in (11, 21):
                self.assertEqual(self.client.post(ruta, headers=self.headers(usuario), json={'contenido': 'Hola'}).status_code, 409)
        self.assertEqual(Mensaje.query.count(), 0)

    def test_conserva_lectura_tras_cierre_y_aisla_conversaciones(self):
        id_solicitud = self.solicitud()
        ruta = f'/api/solicitudes/{id_solicitud}/mensajes'
        self.client.post(ruta, headers=self.headers(), json={'contenido': 'Hola'})
        item = db.session.get(SolicitudServicio, id_solicitud)
        item.estado = 'Realizada'
        db.session.commit()
        self.assertEqual(len(self.client.get(ruta, headers=self.headers()).json), 1)
        otra = f'/api/solicitudes/{self.solicitud()}/mensajes'
        self.assertEqual(self.client.get(otra, headers=self.headers()).json, [])

    def test_validacion_y_suplantacion(self):
        ruta = f'/api/solicitudes/{self.solicitud()}/mensajes'
        for datos in ([], {}, {'contenido': None}, {'contenido': 2}, {'contenido': '   '},
                      {'contenido': 'a' * 2001}, {'contenido': 'hola', 'idEmisor': 21},
                      {'contenido': 'hola', 'idSolicitud': 99}, {'contenido': 'hola', 'fechaHora': '2030'}):
            with self.subTest(datos=datos):
                self.assertEqual(self.client.post(ruta, headers=self.headers(), json=datos).status_code, 400)
        self.assertEqual(self.client.post(ruta, headers=self.headers(), data='{', content_type='application/json').status_code, 400)
        self.assertEqual(Mensaje.query.count(), 0)
        self.assertEqual(self.client.post(ruta, headers=self.headers(), json={'contenido': 'a' * 2000}).status_code, 201)

    def test_autenticacion_y_solicitud_inexistente(self):
        ruta = f'/api/solicitudes/{self.solicitud()}/mensajes'
        for headers in ({}, self.headers(999), self.headers(expires_delta=timedelta(seconds=-1))):
            self.assertEqual(self.client.get('/api/usuarios/11/historial', headers=headers).status_code, 401)
            self.assertEqual(self.client.get(ruta, headers=headers).status_code, 401)
            self.assertEqual(self.client.post(ruta, headers=headers, json={'contenido': 'Hola'}).status_code, 401)
        self.assertEqual(self.client.get('/api/solicitudes/999/mensajes', headers=self.headers()).status_code, 404)
        self.assertEqual(self.client.post('/api/solicitudes/999/mensajes', headers=self.headers(), json={'contenido': 'Hola'}).status_code, 404)

    def test_error_commit_hace_rollback(self):
        ruta = f'/api/solicitudes/{self.solicitud()}/mensajes'
        with patch('routes.comunicacion_routes.db.session.commit', side_effect=SQLAlchemyError('dato privado')):
            response = self.client.post(ruta, headers=self.headers(), json={'contenido': 'Hola'})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('dato privado', response.get_data(as_text=True))
        self.assertEqual(Mensaje.query.count(), 0)
        self.assertEqual(self.client.post(ruta, headers=self.headers(), json={'contenido': 'Reintento'}).status_code, 201)

    def test_esquema_e_inicializacion_repetida(self):
        db.create_all()
        inspector = inspect(db.engine)
        self.assertEqual({col['name'] for col in inspector.get_columns('mensajes')},
                         {'idMensaje', 'idSolicitud', 'idEmisor', 'contenido', 'fechaHora'})
        self.assertEqual({fk['referred_table'] for fk in inspector.get_foreign_keys('mensajes')},
                         {'usuarios', 'solicitudes_servicio'})


if __name__ == '__main__':
    unittest.main()
