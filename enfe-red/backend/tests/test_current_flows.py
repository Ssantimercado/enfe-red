import unittest
from unittest.mock import patch
from datetime import datetime, timedelta, timezone
from datetime import date, time

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from database import db
from extensions import bcrypt
from models.usuario_models import Disponibilidad, Enfermero, Paciente, Usuario
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.acceso_models import CodigoRecuperacion, ahora_utc
from routes.auth_routes import auth_bp, hash_codigo
from routes.usuario_routes import usuario_bp
from seed_sprint3 import cargar_datos_demo


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
                                    nombre=f'Nurse {index}', tarifa_hora=precio, verificado=True))
        user = Usuario(email='patient@test.local', rol='paciente', password_hash='unused')
        db.session.add(user)
        db.session.flush()
        self.patient = Paciente(usuario_id=user.id, nombre='Ana', apellido='Paciente')
        db.session.add(self.patient)
        db.session.commit()
        self.headers = {'Authorization': 'Bearer ' + create_access_token(identity='1')}
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        self.context.pop()

    def codigo_guardado(self, email):
        usuario = Usuario.query.filter_by(email=email).one()
        return CodigoRecuperacion.query.filter_by(usuario_id=usuario.id).first()

    def pedir_codigo(self, email, numero=246810):
        with patch('routes.auth_routes.secrets.randbelow', return_value=numero):
            respuesta = self.client.post('/api/recuperar-password', json={'email': email})
        self.assertEqual(respuesta.status_code, 200)
        return f'{numero:06d}'

    def test_busqueda_solo_muestra_disponibles_y_verificados(self):
        ocultos = Enfermero.query.filter(Enfermero.matricula.in_(('MAT-0', 'MAT-1'))).all()
        ocultos[0].verificado = False
        ocultos[1].disponible = False
        db.session.commit()
        nombres = {e['nombre'] for e in self.client.get('/api/enfermeros/buscar?per_page=100').json['enfermeros']}
        self.assertEqual(len(nombres), 6)
        self.assertFalse({'Nurse 0', 'Nurse 1'} & nombres)

    def test_registro_exige_aceptar_terminos_y_guarda_la_constancia(self):
        base = {'nombre': 'Ana Nueva', 'email': 'consentimiento@test.local', 'password': 'clave-segura', 'rol': 'paciente'}
        for valor in (None, False, 'true', 1):
            with self.subTest(valor=valor):
                datos = base if valor is None else {**base, 'aceptaTerminos': valor}
                respuesta = self.client.post('/api/registro', json=datos)
                self.assertEqual(respuesta.status_code, 400)
                self.assertIn('Términos', respuesta.json['error'])
        self.assertIsNone(Usuario.query.filter_by(email='consentimiento@test.local').first())
        self.assertEqual(self.client.post('/api/registro', json={**base, 'aceptaTerminos': True}).status_code, 201)
        usuario = Usuario.query.filter_by(email='consentimiento@test.local').one()
        self.assertEqual(usuario.versionTerminos, '1.0')
        self.assertIsNotNone(usuario.aceptoTerminosEn)

    def test_login_y_registro_validan_datos_sin_errores_500(self):
        for cuerpo in ('no-json', '[]', 'null'):
            for ruta in ('/api/login', '/api/registro'):
                with self.subTest(ruta=ruta, cuerpo=cuerpo):
                    respuesta = self.client.post(ruta, data=cuerpo, content_type='application/json')
                    self.assertEqual(respuesta.status_code, 400)
        largo = self.client.post('/api/login', json={'email': 'nurse0@test.local', 'password': 'ñ' * 40})
        self.assertEqual(largo.status_code, 401)
        self.assertEqual(self.client.post('/api/login', json={'email': 1, 'password': 'x'}).status_code, 400)
        base = {'nombre': 'Ana Nueva', 'email': 'nueva@test.local', 'rol': 'paciente', 'aceptaTerminos': True}
        self.assertEqual(self.client.post('/api/registro', json={**base, 'password': 'corta'}).status_code, 400)
        self.assertEqual(self.client.post('/api/registro', json={**base, 'password': 'x' * 73}).status_code, 400)
        self.assertEqual(self.client.post('/api/registro', json={**base, 'password': 'clave-segura', 'rol': 'admin'}).status_code, 400)
        creado = self.client.post('/api/registro', json={**base, 'email': '  nueva@test.local ', 'password': 'clave-segura'})
        self.assertEqual(creado.status_code, 201)
        login = self.client.post('/api/login', json={'email': 'nueva@test.local', 'password': 'clave-segura'})
        self.assertEqual(login.status_code, 200)
        with patch('routes.usuario_routes.db.session.commit', side_effect=RuntimeError('detalle interno')):
            fallo = self.client.post('/api/registro', json={**base, 'email': 'otra@test.local', 'password': 'clave-segura'})
        self.assertEqual(fallo.status_code, 500)
        self.assertNotIn('detalle interno', fallo.get_data(as_text=True))

    def test_recuperacion_limita_codigos_por_ventana(self):
        email = 'nurse0@test.local'
        with patch('routes.auth_routes.secrets.randbelow', side_effect=[111111, 222222, 333333, 444444]):
            for _ in range(4):
                self.client.post('/api/recuperar-password', json={'email': email})
        # El cuarto pedido de la ventana no genera código nuevo: sigue vigente el tercero.
        registro = self.codigo_guardado(email)
        self.assertEqual(registro.codigo_hash, hash_codigo(registro.usuario_id, '333333'))
        # El código se guarda hasheado, nunca en claro.
        self.assertNotIn('333333', registro.codigo_hash)

    def test_pedir_otro_codigo_no_reinicia_los_intentos_fallidos(self):
        email = 'nurse0@test.local'
        incorrecto = dict(email=email, codigo='000000', nueva_password='nueva-clave')
        with patch('routes.auth_routes.secrets.randbelow', side_effect=[111111, 222222, 333333]):
            for _ in range(2):
                self.client.post('/api/recuperar-password', json={'email': email})
                for _ in range(5):
                    self.assertEqual(self.client.post('/api/reset-password', json=incorrecto).status_code, 400)
            self.client.post('/api/recuperar-password', json={'email': email})
        # Con 10 fallos en la ventana, ni el código correcto sirve hasta que pase el bloqueo.
        bloqueado = self.client.post('/api/reset-password', json={**incorrecto, 'codigo': '333333'})
        self.assertEqual(bloqueado.status_code, 429)
        self.assertEqual(self.client.post('/api/login', json=dict(email=email, password='original')).status_code, 200)

    def test_reset_valida_la_nueva_contrasena_sin_consumir_el_codigo(self):
        email = 'nurse0@test.local'
        codigo = self.pedir_codigo(email)
        corta = self.client.post('/api/reset-password', json=dict(email=email, codigo=codigo, nueva_password='corta'))
        self.assertEqual(corta.status_code, 400)
        valida = self.client.post('/api/reset-password', json=dict(email=email, codigo=codigo, nueva_password='nueva-clave'))
        self.assertEqual(valida.status_code, 200)

    def test_cambiar_matricula_quita_la_verificacion(self):
        enfermero = Enfermero.query.filter_by(matricula='MAT-0').one()
        headers = {'Authorization': 'Bearer ' + create_access_token(identity=str(enfermero.usuario_id))}
        mismo = self.client.put('/api/perfil/enfermero', headers=headers, json={'matricula': 'MAT-0', 'nombre': 'Nurse 0'})
        self.assertEqual(mismo.status_code, 200)
        self.assertTrue(db.session.get(Enfermero, enfermero.id).verificado)
        otra = self.client.put('/api/perfil/enfermero', headers=headers, json={'matricula': 'MAT-999', 'nombre': 'Nurse 0'})
        self.assertEqual(otra.status_code, 200)
        self.assertFalse(db.session.get(Enfermero, enfermero.id).verificado)

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

    def test_schedule_can_be_edited_without_conflicting_with_itself(self):
        created = self.horario(dia='Sábado', hora_inicio='08:00', hora_fin='16:00')
        schedule_id = created.json['disponibilidad']['id']
        response = self.client.put(
            f'/api/perfil/enfermero/horarios/{schedule_id}',
            headers=self.headers,
            json=dict(dia_semana='Sábado', hora_inicio='08:00', hora_fin='22:00',
                      estado='Disponible'),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['disponibilidad']['hora_fin'], '22:00')
        self.assertEqual(Disponibilidad.query.count(), 1)

    def test_schedule_edit_rejects_overlap_and_other_nurse_schedule(self):
        first = self.horario(dia='Sábado', hora_inicio='08:00', hora_fin='12:00')
        self.horario(dia='Sábado', hora_inicio='12:00', hora_fin='16:00')
        first_id = first.json['disponibilidad']['id']
        response = self.client.put(
            f'/api/perfil/enfermero/horarios/{first_id}',
            headers=self.headers,
            json=dict(dia='Sábado', hora_inicio='10:00', hora_fin='14:00'),
        )
        self.assertEqual(response.status_code, 409)
        saved_first = Disponibilidad.query.filter_by(id=first_id).first()
        self.assertEqual(saved_first.hora_fin.strftime('%H:%M'), '12:00')

        other_nurse_headers = {
            'Authorization': 'Bearer ' + create_access_token(identity='2')
        }
        other_nurse_schedule = self.client.post(
            '/api/perfil/enfermero/horarios',
            headers=other_nurse_headers,
            json=dict(dia='Sábado', hora_inicio='08:00', hora_fin='16:00'),
        ).json['disponibilidad']
        response = self.client.put(
            f"/api/perfil/enfermero/horarios/{other_nurse_schedule['id']}",
            headers=self.headers,
            json=dict(dia='Sábado', hora_inicio='08:00', hora_fin='22:00'),
        )
        self.assertEqual(response.status_code, 404)

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

    def test_search_filters_nurses_by_continuous_available_time_range(self):
        enfermeros = [
            Enfermero.query.filter_by(matricula=f'MAT-{index}').first()
            for index in range(4)
        ]
        db.session.add_all([
            Disponibilidad(
                enfermero_id=enfermeros[0].id,
                dia_semana='Lunes',
                hora_inicio=time(8),
                hora_fin=time(16),
                estado='Disponible',
            ),
            Disponibilidad(
                enfermero_id=enfermeros[1].id,
                dia_semana='Lunes',
                hora_inicio=time(8),
                hora_fin=time(16),
                estado='En Pausa / No disponible',
            ),
            Disponibilidad(
                enfermero_id=enfermeros[2].id,
                dia_semana='Lunes',
                hora_inicio=time(9),
                hora_fin=time(15),
                estado='Disponible',
            ),
            Disponibilidad(
                enfermero_id=enfermeros[3].id,
                dia_semana='Martes',
                hora_inicio=time(8),
                hora_fin=time(16),
                estado='Disponible',
            ),
        ])
        db.session.commit()

        response = self.client.get(
            '/api/enfermeros/buscar?hora_desde=08:00&hora_hasta=16:00'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [person['usuario_id'] for person in response.json['enfermeros']],
            [enfermeros[0].usuario_id, enfermeros[3].usuario_id],
        )

        response = self.client.get(
            '/api/enfermeros/buscar?dia_semana=Lunes&hora_desde=08:00&hora_hasta=16:00'
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [person['usuario_id'] for person in response.json['enfermeros']],
            [enfermeros[0].usuario_id],
        )

    def test_bad_search_parameters(self):
        for query in ('precio_min=500&precio_max=100', 'precio_min=no', 'precio_min=-1',
                      'precio_max=nan', 'page=0', 'per_page=0', 'per_page=1000',
                      'hora_desde=08:00', 'hora_desde=25:00&hora_hasta=16:00',
                      'hora_desde=16:00&hora_hasta=08:00'):
            with self.subTest(query=query):
                self.assertEqual(self.client.get('/api/enfermeros/buscar?' + query).status_code, 400)

    def test_nurse_directory_returns_patients_with_any_own_request(self):
        segundo_usuario = Usuario(
            email='otro-paciente@test.local',
            rol='paciente',
            password_hash='unused',
        )
        tercer_usuario = Usuario(
            email='tercer-paciente@test.local',
            rol='paciente',
            password_hash='unused',
        )
        db.session.add_all([segundo_usuario, tercer_usuario])
        db.session.flush()
        segundo_paciente = Paciente(
            usuario_id=segundo_usuario.id,
            nombre='Bruno',
            apellido='Paciente',
        )
        tercer_paciente = Paciente(
            usuario_id=tercer_usuario.id,
            nombre='Carla',
            apellido='Paciente',
            latitud=-32.90,
            longitud=-68.85,
            ubicacion_compartida=True,
        )
        servicio = Servicio(tipoServicio='Curaciones', precioEstimado=None)
        db.session.add_all([segundo_paciente, tercer_paciente, servicio])
        db.session.flush()
        self.patient.direccion = 'Dirección privada'
        self.patient.telefono = '2615550000'
        self.patient.historial_medico = 'Dato médico privado'
        self.patient.latitud = -32.89
        self.patient.longitud = -68.84
        self.patient.ubicacion_compartida = True
        db.session.add_all([
            SolicitudServicio(
                idPaciente=self.patient.id,
                idEnfermero=1,
                idServicio=servicio.idServicio,
                fecha=date(2030, 1, 10),
                hora=time(10),
                estado='Pendiente',
                direccionAtencion='Dirección del servicio',
            ),
            SolicitudServicio(
                idPaciente=segundo_paciente.id,
                idEnfermero=1,
                idServicio=servicio.idServicio,
                fecha=date(2030, 1, 11),
                hora=time(10),
                estado='Aceptada',
                direccionAtencion='Dirección del servicio',
            ),
            SolicitudServicio(
                idPaciente=self.patient.id,
                idEnfermero=2,
                idServicio=servicio.idServicio,
                fecha=date(2030, 1, 12),
                hora=time(10),
                estado='Aceptada',
                direccionAtencion='Otra dirección',
            ),
            SolicitudServicio(
                idPaciente=segundo_paciente.id,
                idEnfermero=3,
                idServicio=servicio.idServicio,
                fecha=date(2030, 1, 13),
                hora=time(10),
                estado='Rechazada',
                direccionAtencion='Otra dirección',
            ),
            SolicitudServicio(
                idPaciente=tercer_paciente.id,
                idEnfermero=1,
                idServicio=servicio.idServicio,
                fecha=date(2030, 1, 14),
                hora=time(10),
                estado='Rechazada',
                direccionAtencion='Otra dirección',
            ),
        ])
        db.session.commit()

        result = self.client.get('/api/pacientes/solicitudes-activas', headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['total_resultados'], 3)
        ana, bruno, carla = result.json['pacientes']
        self.assertEqual((ana['nombre'], ana['solicitudes'], ana['solicitudes_activas']), ('Ana', 1, 1))
        self.assertEqual((ana['latitud'], ana['longitud']), (-32.89, -68.84))
        self.assertEqual((bruno['nombre'], bruno['solicitudes']), ('Bruno', 1))
        self.assertEqual((carla['nombre'], carla['solicitudes'], carla['solicitudes_activas']), ('Carla', 1, 0))
        self.assertEqual((carla['latitud'], carla['longitud']), (None, None))
        response_text = result.get_data(as_text=True)
        for dato_privado in ('Dirección privada', '2615550000', 'Dato médico privado'):
            self.assertNotIn(dato_privado, response_text)
        nurse_two = self.client.get(
            '/api/pacientes/solicitudes-activas',
            headers={'Authorization': 'Bearer ' + create_access_token(identity='2')},
        )
        self.assertEqual([item['nombre'] for item in nurse_two.json['pacientes']], ['Ana'])
        patient_response = self.client.get(
            '/api/pacientes/solicitudes-activas',
            headers={'Authorization': 'Bearer ' + create_access_token(identity='9')},
        )
        self.assertEqual(patient_response.status_code, 403)
        self.assertEqual(self.client.get('/api/pacientes/solicitudes-activas').status_code, 401)
        nurse_three = self.client.get(
            '/api/pacientes/solicitudes-activas',
            headers={'Authorization': 'Bearer ' + create_access_token(identity='3')},
        )
        self.assertEqual(nurse_three.status_code, 200)
        self.assertEqual([item['nombre'] for item in nurse_three.json['pacientes']], ['Bruno'])
        self.assertEqual(nurse_three.json['pacientes'][0]['solicitudes_activas'], 0)

    def test_patient_can_save_and_revoke_optional_location_sharing(self):
        patient_headers = {
            'Authorization': 'Bearer ' + create_access_token(identity='9')
        }
        missing_location = self.client.put(
            '/api/perfil/paciente',
            headers=patient_headers,
            json={'ubicacion_compartida': True},
        )
        self.assertEqual(missing_location.status_code, 400)
        response = self.client.put(
            '/api/perfil/paciente',
            headers=patient_headers,
            json={
                'latitud': -32.89,
                'longitud': -68.84,
                'ubicacion_compartida': True,
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['ubicacion_compartida'])
        self.assertEqual((response.json['latitud'], response.json['longitud']), (-32.89, -68.84))

        revoke = self.client.put(
            '/api/perfil/paciente',
            headers=patient_headers,
            json={'ubicacion_compartida': False},
        )
        self.assertEqual(revoke.status_code, 200)
        self.assertFalse(revoke.json['ubicacion_compartida'])

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
                                   json={'direccion': 'Casa 123', 'ciudad': 'Mendoza', 'telefono': '261 555 1234'})
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
            'aceptaTerminos': True,
        })
        self.assertEqual(response.status_code, 201)
        user = Usuario.query.filter_by(email='ana@test.local').one()
        headers = {'Authorization': 'Bearer ' + create_access_token(identity=str(user.id))}
        response = self.client.put('/api/perfil/paciente', headers=headers,
                                   json={'nombre': 'Ana', 'apellido': '', 'telefono': '0261 15 555-1234'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['telefono'], '2615551234')
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
        code = self.pedir_codigo(email)
        payload = dict(email=email, codigo=code, nueva_password='nueva-clave')
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 200)
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        self.assertEqual(self.client.post('/api/login', json=dict(email=email, password='original')).status_code, 401)
        self.assertEqual(self.client.post('/api/login', json=dict(email=email, password='nueva-clave')).status_code, 200)

    def test_expired_and_wrong_recovery_codes_do_not_change_password(self):
        email = 'nurse0@test.local'
        usuario = Usuario.query.filter_by(email=email).one()
        db.session.add(CodigoRecuperacion(usuario_id=usuario.id, codigo_hash=hash_codigo(usuario.id, '123456'),
                                          vence=ahora_utc() - timedelta(seconds=1), intentos=0))
        db.session.commit()
        payload = dict(email=email, codigo='123456', nueva_password='nueva-clave')
        self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        self.assertIsNone(self.codigo_guardado(email))
        db.session.add(CodigoRecuperacion(usuario_id=usuario.id, codigo_hash=hash_codigo(usuario.id, '123456'),
                                          vence=ahora_utc() + timedelta(minutes=1), intentos=0))
        db.session.commit()
        payload['codigo'] = '000000'
        for _ in range(5):
            self.assertEqual(self.client.post('/api/reset-password', json=payload).status_code, 400)
        self.assertIsNone(self.codigo_guardado(email))
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
        self.assertEqual(CodigoRecuperacion.query.count(), 1)

    def test_invalid_json_inputs(self):
        for endpoint in ('/api/reset-password', '/api/recuperar-password', '/api/perfil/enfermero/horarios'):
            self.assertEqual(self.client.post(endpoint, json=[], headers=self.headers).status_code, 400)

    def test_seed_preserves_existing_password(self):
        self.assertEqual(cargar_datos_demo(), 4)
        user = Usuario.query.filter_by(email='laura.gomez@test.com').one()
        changed = bcrypt.generate_password_hash('conservar').decode()
        user.password_hash = changed
        db.session.commit()
        self.assertEqual(cargar_datos_demo(), 0)
        self.assertEqual(user.password_hash, changed)


if __name__ == '__main__':
    unittest.main()
