import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from database import db
from extensions import bcrypt
from models.usuario_models import Disponibilidad, Enfermero, Paciente, Usuario
from routes.auth_routes import auth_bp, codigos_recuperacion
from routes.usuario_routes import usuario_bp
from seed_sprint3 import inicializar_bd_sprint3


class CurrentFlowsTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
            JWT_SECRET_KEY='testing-key-with-at-least-32-characters', BCRYPT_LOG_ROUNDS=4,
        )
        self.app.logger.disabled = True
        db.init_app(self.app)
        bcrypt.init_app(self.app)
        JWTManager(self.app)
        self.app.register_blueprint(usuario_bp, url_prefix='/api')
        self.app.register_blueprint(auth_bp, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        for index, precio in enumerate((100, 200, 300, 400, 500, 600, 700, 800)):
            user = Usuario(email=f'nurse{index}@test.local', rol='enfermero',
                           password_hash=bcrypt.generate_password_hash('original').decode())
            db.session.add(user)
            db.session.flush()
            db.session.add(Enfermero(usuario_id=user.id, matricula=f'MAT-{index}',
                                    nombre=f'Nurse {index}', tarifa_hora=precio))
        user = Usuario(email='patient@test.local', rol='paciente', password_hash='unused')
        db.session.add(user)
        db.session.flush()
        db.session.add(Paciente(usuario_id=user.id))
        db.session.commit()
        self.headers = {'Authorization': 'Bearer ' + create_access_token(identity='1')}
        self.client = self.app.test_client()
        codigos_recuperacion.clear()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()
        codigos_recuperacion.clear()

    def horario(self, **changes):
        data = dict(dia='Lunes', estado='Disponible', hora_inicio='08:00', hora_fin='12:00')
        data.update(changes)
        return self.client.post('/api/perfil/enfermero/horarios', headers=self.headers, json=data)

    def test_valid_schedule_and_read(self):
        self.assertEqual(self.horario().status_code, 201)
        response = self.client.get('/api/usuarios/1/horarios', headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json[0]['hora_inicio'], '08:00')
        self.assertEqual(response.json[0]['estado'], 'Disponible')

    def test_invalid_schedule_rejected_without_saving(self):
        for changes in ({'hora_inicio': '18:00'}, {'hora_fin': '08:00'},
                        {'dia': 'Inventado'}, {'estado': 'Inventado'},
                        {'hora_inicio': 'no-hora'}, {'hora_fin': ''}):
            with self.subTest(changes=changes):
                self.assertEqual(self.horario(**changes).status_code, 400)
        self.assertEqual(Disponibilidad.query.count(), 0)

    def test_overlap_and_duplicate_rejected_but_adjacent_allowed(self):
        self.assertEqual(self.horario().status_code, 201)
        self.assertEqual(self.horario().status_code, 409)
        self.assertEqual(self.horario(hora_inicio='10:00', hora_fin='14:00').status_code, 409)
        self.assertEqual(self.horario(hora_inicio='12:00', hora_fin='14:00').status_code, 201)

    def test_schedule_requires_nurse_session(self):
        self.assertEqual(self.client.get('/api/perfil/enfermero/horarios').status_code, 401)
        headers = {'Authorization': 'Bearer ' + create_access_token(identity='9')}
        response = self.client.post('/api/perfil/enfermero/horarios', headers=headers,
                                    json=dict(dia='Lunes', hora_inicio='08:00', hora_fin='12:00'))
        self.assertIn(response.status_code, (403, 404))

    def test_min_price_applies_before_pagination(self):
        response = self.client.get('/api/enfermeros/buscar?precio_min=650&per_page=1&page=1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['total_resultados'], 2)
        self.assertEqual(response.json['total_paginas'], 2)
        self.assertGreaterEqual(response.json['enfermeros'][0]['tarifa_hora'], 650)
        second = self.client.get('/api/enfermeros/buscar?precio_min=650&per_page=1&page=2')
        self.assertEqual(len(second.json['enfermeros']), 1)

    def test_bad_search_parameters(self):
        for query in ('precio_min=500&precio_max=100', 'precio_min=no', 'precio_min=-1',
                      'precio_max=nan', 'page=0', 'per_page=0', 'per_page=1000'):
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/enfermeros/buscar?' + query).status_code, 400)

    def test_full_profile_round_trip_accepts_nullable_fields(self):
        profile = self.client.get('/api/perfil/enfermero', headers=self.headers).json
        profile['nombre'] = 'Actualizado'
        response = self.client.put('/api/perfil/enfermero', headers=self.headers, json=profile)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['nombre'], 'Actualizado')

    def test_address_change_clears_old_map_point(self):
        nurse = db.session.get(Enfermero, 1)
        nurse.direccion, nurse.ciudad = 'Vieja 123', 'Mendoza'
        nurse.latitud, nurse.longitud = -32.89, -68.84
        db.session.commit()
        response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                   json={'direccion': 'Nueva 456', 'ciudad': 'Córdoba'})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json['latitud'])
        self.assertIsNone(response.json['longitud'])

    def test_new_map_point_is_saved_with_address(self):
        response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                   json={'direccion': 'Nueva 456', 'ciudad': 'Córdoba',
                                         'latitud': -31.42, 'longitud': -64.18})
        self.assertEqual(response.status_code, 200)
        nurse = db.session.get(Enfermero, 1)
        self.assertEqual((nurse.latitud, nurse.longitud), (-31.42, -64.18))
        listed = self.client.get('/api/enfermeros/buscar?q=Nurse%200').json['enfermeros'][0]
        self.assertEqual((listed['latitud'], listed['longitud']), (-31.42, -64.18))

    def test_unchanged_address_preserves_map_point(self):
        nurse = db.session.get(Enfermero, 1)
        nurse.direccion, nurse.ciudad = 'Casa 123', 'Mendoza'
        nurse.latitud, nurse.longitud = -32.89, -68.84
        db.session.commit()
        response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                   json={'direccion': 'Casa 123', 'ciudad': 'Mendoza', 'telefono': '123'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual((response.json['latitud'], response.json['longitud']), (-32.89, -68.84))

    def test_map_point_requires_complete_pair(self):
        for values in ({'latitud': -32}, {'longitud': -68}, {'latitud': None, 'longitud': -68},
                       {'latitud': 91, 'longitud': -68}, {'latitud': -32, 'longitud': 181}):
            with self.subTest(values=values):
                response = self.client.put('/api/perfil/enfermero', headers=self.headers, json=values)
                self.assertEqual(response.status_code, 400)
        response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                   json={'latitud': None, 'longitud': None})
        self.assertEqual(response.status_code, 200)

    def test_single_name_registration_and_profile_update(self):
        response = self.client.post('/api/registro', json={
            'nombre': 'Ana', 'email': 'ana@test.local', 'password': 'test-password', 'rol': 'paciente',
        })
        self.assertEqual(response.status_code, 201)
        user = Usuario.query.filter_by(email='ana@test.local').one()
        headers = {'Authorization': 'Bearer ' + create_access_token(identity=str(user.id))}
        response = self.client.put('/api/perfil/paciente', headers=headers,
                                   json={'nombre': 'Ana', 'apellido': '', 'telefono': '123'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['apellido'], '')

    def test_invalid_matricula_is_400(self):
        for value in (None, '', ' ' * 2, 123, 'x' * 51):
            with self.subTest(value=value):
                response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                           json={'matricula': value})
                self.assertEqual(response.status_code, 400)

    def test_duplicate_matricula_rolls_back_and_can_retry(self):
        response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                   json={'matricula': 'MAT-1', 'nombre': 'No guardar'})
        self.assertEqual(response.status_code, 409)
        response = self.client.put('/api/perfil/enfermero', headers=self.headers,
                                   json={'matricula': 'NUEVA', 'nombre': 'Guardado'})
        self.assertEqual(response.status_code, 200)

    def test_recovery_changes_password_and_consumes_code(self):
        email = 'nurse0@test.local'
        self.assertEqual(self.client.post('/api/recuperar-password', json={'email': email}).status_code, 200)
        code = codigos_recuperacion[email]['codigo']
        payload = dict(email=email, codigo=code, nueva_password='nueva-clave')
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 200)
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        self.assertEqual(self.client.post('/api/login', json=dict(email=email, password='original')).status_code, 401)
        self.assertEqual(self.client.post('/api/login', json=dict(email=email, password='nueva-clave')).status_code, 200)

    def test_expired_and_wrong_recovery_codes_do_not_change_password(self):
        email = 'nurse0@test.local'
        codigos_recuperacion[email] = dict(codigo='123456', vence=datetime.now(timezone.utc) - timedelta(seconds=1), intentos=0)
        payload = dict(email=email, codigo='123456', nueva_password='nueva')
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        codigos_recuperacion[email] = dict(codigo='123456', vence=datetime.now(timezone.utc) + timedelta(minutes=1), intentos=0)
        payload['codigo'] = '000000'
        for _ in range(5):
            self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        self.assertNotIn(email, codigos_recuperacion)
        self.assertEqual(self.client.post('/api/login', json=dict(email=email, password='original')).status_code, 200)

    def test_requesting_new_code_invalidates_previous_code(self):
        email = 'nurse0@test.local'
        with patch('routes.auth_routes.secrets.randbelow', side_effect=[123456, 654321]):
            self.client.post('/api/recuperar-password', json={'email': email})
            self.client.post('/api/recuperar-password', json={'email': email})
        payload = dict(email=email, codigo='123456', nueva_password='nueva-clave')
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        payload['codigo'] = '654321'
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 200)

    def test_unknown_recovery_email_has_same_public_response(self):
        known = self.client.post('/api/recuperar-password', json={'email': 'nurse0@test.local'})
        unknown = self.client.post('/api/recuperar-password', json={'email': 'unknown@test.local'})
        self.assertEqual(known.json, unknown.json)
        self.assertNotIn('unknown@test.local', codigos_recuperacion)

    def test_invalid_json_inputs(self):
        for endpoint in ('/api/reset-password', '/api/recuperar-password', '/api/perfil/enfermero/horarios'):
            self.assertEqual(self.client.post(endpoint, json=[], headers=self.headers).status_code, 400)

    def test_seed_preserves_existing_password(self):
        inicializar_bd_sprint3()
        user = Usuario.query.filter_by(email='laura.gomez@test.com').one()
        changed = bcrypt.generate_password_hash('conservar').decode()
        user.password_hash = changed
        db.session.commit()
        inicializar_bd_sprint3()
        self.assertEqual(user.password_hash, changed)


if __name__ == '__main__':
    unittest.main()
