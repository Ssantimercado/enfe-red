"""Alineación del código con el documento: HU3 (cercanía), HU9 (matrícula), HU10 (suspensión) y clases."""
import unittest
from datetime import datetime
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from database import db
from extensions import bcrypt
from models.servicio_models import Servicio
from models.usuario_models import Enfermero, Paciente, Usuario
from routes.admin_routes import admin_bp
from routes.solicitud_routes import solicitud_bp
from routes.usuario_routes import distancia_km, usuario_bp
from seguridad import configurar_sesiones

# Centro de Mendoza; Godoy Cruz queda a ~5 km y San Rafael a ~190 km.
MENDOZA = (-32.8895, -68.8458)


class AlineacionTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters', BCRYPT_LOG_ROUNDS=4)
        self.app.logger.disabled = True
        db.init_app(self.app)
        bcrypt.init_app(self.app)
        configurar_sesiones(JWTManager(self.app))
        for blueprint in (usuario_bp, solicitud_bp, admin_bp):
            self.app.register_blueprint(blueprint, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=1, email='admin@test.local', password_hash='x', rol='administrador', nivelPermiso='total'),
            Usuario(id=11, email='paciente@test.local', password_hash='x', rol='paciente'),
            Usuario(id=21, email='cerca@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=22, email='lejos@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=23, email='sinubicacion@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=24, email='suspendido@test.local', password_hash='x', rol='enfermero', suspendido=True),
            Usuario(id=25, email='nuevo@test.local', password_hash='x', rol='enfermero'),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana'),
            Enfermero(id=201, usuario_id=21, nombre='Cerca', matricula='MP-1', verificado=True,
                      disponible=True, latitud=-32.9253, longitud=-68.8444),
            Enfermero(id=202, usuario_id=22, nombre='Lejos', matricula='MP-2', verificado=True,
                      disponible=True, latitud=-34.6177, longitud=-68.3301),
            Enfermero(id=203, usuario_id=23, nombre='Sin ubicación', matricula='MP-3', verificado=True, disponible=True),
            Enfermero(id=204, usuario_id=24, nombre='Suspendido', matricula='MP-4', verificado=True,
                      disponible=True, latitud=-32.89, longitud=-68.84),
            Enfermero(id=205, usuario_id=25, nombre='Nuevo', matricula='PENDIENTE-25'),
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

    def buscar(self, consulta=''):
        return self.client.get(f'/api/enfermeros/buscar?per_page=100{consulta}')

    # ---------- HU3: enfermeros cercanos ----------
    def test_ordena_por_cercania_e_informa_la_distancia(self):
        respuesta = self.buscar(f'&lat={MENDOZA[0]}&lng={MENDOZA[1]}')
        self.assertEqual(respuesta.status_code, 200)
        enfermeros = respuesta.json['enfermeros']
        self.assertEqual([e['nombre'] for e in enfermeros], ['Cerca', 'Lejos', 'Sin ubicación'])
        self.assertAlmostEqual(enfermeros[0]['distancia_km'], 4.0, delta=0.5)
        self.assertGreater(enfermeros[1]['distancia_km'], 150)
        self.assertIsNone(enfermeros[2]['distancia_km'])

    def test_filtra_por_radio(self):
        respuesta = self.buscar(f'&lat={MENDOZA[0]}&lng={MENDOZA[1]}&radio_km=20')
        self.assertEqual([e['nombre'] for e in respuesta.json['enfermeros']], ['Cerca'])
        self.assertEqual(respuesta.json['total_resultados'], 1)

    def test_valida_la_ubicacion_y_el_radio(self):
        for consulta in ('&lat=abc&lng=1', '&lat=-32', '&lat=100&lng=0', '&radio_km=5',
                         f'&lat={MENDOZA[0]}&lng={MENDOZA[1]}&radio_km=0'):
            with self.subTest(consulta=consulta):
                self.assertEqual(self.buscar(consulta).status_code, 400)

    def test_paginacion_con_cercania(self):
        respuesta = self.client.get(f'/api/enfermeros/buscar?per_page=1&page=2&lat={MENDOZA[0]}&lng={MENDOZA[1]}')
        self.assertEqual([e['nombre'] for e in respuesta.json['enfermeros']], ['Lejos'])
        self.assertEqual(respuesta.json['total_paginas'], 3)

    def test_distancia_haversine(self):
        self.assertAlmostEqual(distancia_km(0, 0, 0, 1), 111.19, delta=0.1)

    # ---------- HU10: cuentas suspendidas ----------
    def test_suspendidos_no_aparecen_en_la_cartilla(self):
        for ruta in ('/api/enfermeros', '/api/enfermeros/buscar?per_page=100'):
            with self.subTest(ruta=ruta):
                datos = self.client.get(ruta).json
                lista = datos if isinstance(datos, list) else datos['enfermeros']
                self.assertNotIn('Suspendido', [e['nombre'] for e in lista])
                self.assertNotIn('Nuevo', [e['nombre'] for e in lista])

    def test_no_se_pueden_pedir_turnos_a_un_enfermero_suspendido(self):
        with patch('routes.solicitud_routes._ahora_local', return_value=datetime(2030, 1, 1, 9, 0)):
            respuesta = self.client.post('/api/solicitudes', headers=self.token(11), json={
                'idEnfermero': 204, 'idServicio': 301, 'fecha': '2030-01-10', 'hora': '10:00',
                'direccionAtencion': 'San Martín 123',
            })
        self.assertEqual(respuesta.status_code, 409)

    def test_la_suspension_corta_la_sesion_abierta(self):
        headers = self.token(11)
        self.assertEqual(self.client.get('/api/perfil/paciente', headers=headers).status_code, 200)
        db.session.get(Usuario, 11).suspendido = True
        db.session.commit()
        respuesta = self.client.get('/api/perfil/paciente', headers=headers)
        self.assertEqual(respuesta.status_code, 401)
        self.assertIn('no está activa', respuesta.json['error'])
        self.assertEqual(self.client.get('/api/perfil/paciente', headers=self.token(999)).status_code, 401)

    # ---------- HU9: verificación de matrículas ----------
    def test_no_se_verifica_una_matricula_sin_cargar(self):
        admin = self.token(1, rol='administrador', nivelPermiso='total')
        respuesta = self.client.put('/api/admin/enfermeros/205/matricula', headers=admin, json={'verificado': True})
        self.assertEqual(respuesta.status_code, 409)
        self.assertFalse(db.session.get(Enfermero, 205).verificado)
        pendientes = self.client.get('/api/admin/enfermeros/pendientes', headers=admin).json['enfermeros']
        self.assertNotIn(205, [e['idEnfermero'] for e in pendientes])

    # ---------- Diagrama de clases: Paciente.obraSocial ----------
    def test_paciente_guarda_obra_social_y_valida_los_campos(self):
        headers = self.token(11)
        respuesta = self.client.put('/api/perfil/paciente', headers=headers, json={'obraSocial': 'OSDE'})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['obraSocial'], 'OSDE')
        for datos in ({'telefono': '9' * 21}, {'nombre': ['x']}, {'obraSocial': 'x' * 101}):
            with self.subTest(datos=str(datos)[:30]):
                self.assertEqual(self.client.put('/api/perfil/paciente', headers=headers, json=datos).status_code, 400)


if __name__ == '__main__':
    unittest.main()
