"""SCRUM-64: notificaciones por aceptación, rechazo y mensajes nuevos."""
import unittest
from datetime import date, time
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from database import db
from models.notificacion_models import Notificacion
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario
from routes.comunicacion_routes import comunicacion_bp
from routes.notificacion_routes import notificacion_bp
from routes.solicitud_routes import solicitud_bp


class NotificacionesTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
        self.app.logger.disabled = True
        db.init_app(self.app)
        JWTManager(self.app)
        for blueprint in (solicitud_bp, comunicacion_bp, notificacion_bp):
            self.app.register_blueprint(blueprint, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=i, email=f'{i}@test.local', password_hash='privado', rol=rol)
            for i, rol in [(11, 'paciente'), (12, 'paciente'), (21, 'enfermero')]
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', apellido='Pérez'),
            Paciente(id=102, usuario_id=12, nombre='Otro'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', apellido='Gómez', matricula='MAT-1',
                      verificado=True, disponible=True),
            Servicio(idServicio=301, tipoServicio='Curaciones', precioEstimado=8000),
        ])
        db.session.commit()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def headers(self, usuario):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario))}

    def solicitud(self, estado='Pendiente'):
        item = SolicitudServicio(idPaciente=101, idEnfermero=201, idServicio=301, fecha=date(2030, 1, 10),
                                 hora=time(10, 30), estado=estado, direccionAtencion='San Martín 123')
        db.session.add(item)
        db.session.commit()
        return item.idSolicitud

    def notificaciones(self, usuario):
        respuesta = self.client.get(f'/api/notificaciones/{usuario}', headers=self.headers(usuario))
        self.assertEqual(respuesta.status_code, 200)
        return respuesta.json

    def test_aceptar_notifica_al_paciente_y_no_al_enfermero(self):
        id_solicitud = self.solicitud()
        self.assertEqual(self.notificaciones(11), [])
        respuesta = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21))
        self.assertEqual(respuesta.status_code, 200)
        [aviso] = self.notificaciones(11)
        self.assertEqual(aviso['tipo'], 'aceptada')
        self.assertEqual(aviso['idSolicitud'], id_solicitud)
        self.assertFalse(aviso['leida'])
        self.assertEqual(aviso['mensaje'], 'Laura Gómez aceptó tu solicitud de Curaciones del 10/01 a las 10:30.')
        self.assertTrue(aviso['fechaHora'].endswith('Z'))
        self.assertEqual(self.notificaciones(21), [])

    def test_rechazar_notifica_al_paciente(self):
        id_solicitud = self.solicitud()
        self.client.put(f'/api/solicitudes/{id_solicitud}/rechazar', headers=self.headers(21))
        [aviso] = self.notificaciones(11)
        self.assertEqual(aviso['tipo'], 'rechazada')
        self.assertIn('rechazó', aviso['mensaje'])

    def test_otras_transiciones_no_generan_alertas(self):
        cancelada = self.solicitud()
        self.client.put(f'/api/solicitudes/{cancelada}/cancelar', headers=self.headers(11))
        finalizada = self.solicitud(estado='Aceptada')
        self.client.put(f'/api/solicitudes/{finalizada}/finalizar', headers=self.headers(21))
        self.assertEqual(Notificacion.query.count(), 0)

    def test_transicion_rechazada_no_deja_alerta(self):
        id_solicitud = self.solicitud(estado='Rechazada')
        respuesta = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21))
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(Notificacion.query.count(), 0)

    def test_error_al_notificar_revierte_el_cambio_de_estado(self):
        id_solicitud = self.solicitud()
        with patch('routes.solicitud_routes.notificar', side_effect=SQLAlchemyError('falla')):
            respuesta = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21))
        self.assertEqual(respuesta.status_code, 500)
        db.session.expire_all()
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')
        self.assertEqual(Notificacion.query.count(), 0)

    def test_mensaje_notifica_al_otro_participante_sin_acumular(self):
        id_solicitud = self.solicitud(estado='Aceptada')
        ruta = f'/api/solicitudes/{id_solicitud}/mensajes'
        for texto in ('Hola', '¿Llegás a las 10:30?'):
            respuesta = self.client.post(ruta, headers=self.headers(11), json={'contenido': texto})
            self.assertEqual(respuesta.status_code, 201)
        avisos = self.notificaciones(21)
        self.assertEqual(len(avisos), 1)
        self.assertEqual(avisos[0]['tipo'], 'mensaje')
        self.assertEqual(avisos[0]['mensaje'], f'Nuevo mensaje de Ana Pérez sobre la solicitud #{id_solicitud}.')
        self.assertEqual(self.notificaciones(11), [])

        # Una vez leído, el próximo mensaje genera un aviso nuevo.
        self.client.put(f"/api/notificaciones/{avisos[0]['idNotificacion']}/leer", headers=self.headers(21))
        self.client.post(ruta, headers=self.headers(11), json={'contenido': 'Te espero'})
        self.assertEqual([aviso['leida'] for aviso in self.notificaciones(21)], [False, True])

        self.client.post(ruta, headers=self.headers(21), json={'contenido': 'Sí, llego'})
        [aviso_paciente] = self.notificaciones(11)
        self.assertIn('Laura Gómez', aviso_paciente['mensaje'])

    def test_marcar_leida_es_propia_e_idempotente(self):
        id_solicitud = self.solicitud()
        self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21))
        [aviso] = self.notificaciones(11)
        ruta = f"/api/notificaciones/{aviso['idNotificacion']}/leer"
        self.assertEqual(self.client.put(ruta, headers=self.headers(12)).status_code, 403)
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 403)
        for _ in range(2):
            respuesta = self.client.put(ruta, headers=self.headers(11))
            self.assertEqual(respuesta.status_code, 200)
            self.assertTrue(respuesta.json['notificacion']['leida'])
        self.assertEqual(self.client.put('/api/notificaciones/999/leer', headers=self.headers(11)).status_code, 404)

    def test_listado_privado_ordenado_y_autenticado(self):
        primera = self.solicitud()
        segunda = self.solicitud()
        self.client.put(f'/api/solicitudes/{primera}/aceptar', headers=self.headers(21))
        self.client.put(f'/api/solicitudes/{segunda}/rechazar', headers=self.headers(21))
        self.assertEqual([aviso['idSolicitud'] for aviso in self.notificaciones(11)], [segunda, primera])
        self.assertEqual(self.client.get('/api/notificaciones/11', headers=self.headers(12)).status_code, 403)
        self.assertEqual(self.client.get('/api/notificaciones/11').status_code, 401)
        self.assertEqual(self.client.get('/api/notificaciones/99', headers=self.headers(99)).status_code, 401)

    def test_esquema_de_la_tabla(self):
        columnas = {columna['name'] for columna in inspect(db.engine).get_columns('notificaciones')}
        self.assertTrue({'idNotificacion', 'idUsuario', 'idSolicitud', 'mensaje', 'leida', 'fechaHora'} <= columnas)


if __name__ == '__main__':
    unittest.main()
