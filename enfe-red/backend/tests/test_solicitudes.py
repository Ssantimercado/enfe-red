import unittest
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import event, inspect, text
from sqlalchemy.exc import SQLAlchemyError

from database import db
from extensions import bcrypt
from models.servicio_models import Servicio
from models.solicitud_models import ESTADOS_SOLICITUD, SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario
from routes.solicitud_routes import solicitud_bp
from routes.usuario_routes import usuario_bp
from schema_sprint4 import inicializar_bd_sprint4, inicializar_catalogo_servicios
from seed_sprint3 import inicializar_bd_sprint3


def crear_app_pruebas():
    app = Flask(__name__)
    app.config.update(
        TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
        JWT_SECRET_KEY='testing-key-with-at-least-32-characters', BCRYPT_LOG_ROUNDS=4,
    )
    app.logger.disabled = True
    db.init_app(app)
    bcrypt.init_app(app)
    JWTManager(app)
    app.register_blueprint(usuario_bp, url_prefix='/api')
    app.register_blueprint(solicitud_bp, url_prefix='/api')
    return app


class SolicitudesTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app_pruebas()
        self.context = self.app.app_context()
        self.context.push()
        # SQLite debe comprobar las mismas relaciones que MySQL.
        with db.engine.connect() as connection:
            connection.exec_driver_sql('PRAGMA foreign_keys=ON')
        inicializar_bd_sprint4()
        db.session.add_all([
            Usuario(id=11, email='paciente@test.local', rol='paciente', password_hash='privado'),
            Usuario(id=12, email='otro-paciente@test.local', rol='paciente', password_hash='privado'),
            Usuario(id=21, email='enfermero@test.local', rol='enfermero', password_hash='privado'),
            Usuario(id=22, email='otro-enfermero@test.local', rol='enfermero', password_hash='privado'),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', apellido='Prueba',
                     telefono='2611111111', historial_medico='No debe aparecer en el comprobante'),
            Paciente(id=102, usuario_id=12, nombre='Otro paciente'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', apellido='Prueba', matricula='MAT-201',
                      especialidad='General', telefono='2612222222', tarifa_hora=999,
                      verificado=True, disponible=True),
            Enfermero(id=202, usuario_id=22, matricula='MAT-202', verificado=True, disponible=True),
            Servicio(idServicio=301, tipoServicio='Curaciones', precioEstimado=Decimal('8500.50')),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        self.reloj = patch('routes.solicitud_routes._ahora_local', return_value=datetime(2030, 1, 10, 10, 0))
        self.reloj.start()
        self.addCleanup(self.reloj.stop)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def headers(self, usuario_id=11, **kwargs):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario_id), **kwargs)}

    def payload(self, **changes):
        data = dict(idEnfermero=201, idServicio=301, fecha='2030-01-11', hora='14:30',
                    direccionAtencion='  San Martín 123, Mendoza  ')
        data.update(changes)
        return data

    def crear(self, usuario_id=11, **changes):
        return self.client.post('/api/solicitudes', headers=self.headers(usuario_id), json=self.payload(**changes))

    def guardar_solicitud(self, estado='Pendiente', paciente=101, enfermero=201, hora=14):
        solicitud = SolicitudServicio(
            idPaciente=paciente, idEnfermero=enfermero, idServicio=301,
            fecha=date(2030, 1, 11), hora=time(hora, 30), estado=estado,
            direccionAtencion='Dirección de atención',
        )
        db.session.add(solicitud)
        db.session.commit()
        return solicitud.idSolicitud

    def test_catalogo_real_con_precio_y_autenticacion(self):
        response = self.client.get('/api/servicios', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, [{'idServicio': 301, 'tipoServicio': 'Curaciones', 'precioEstimado': '8500.50'}])
        self.assertEqual(self.client.get('/api/servicios').status_code, 401)
        self.assertEqual(self.client.get('/api/servicios', headers=self.headers(999)).status_code, 401)
        creado = self.crear(idServicio=response.json[0]['idServicio'])
        self.assertEqual(creado.status_code, 201)
        id_solicitud = creado.json['solicitud']['idSolicitud']
        detalle = self.client.get(f'/api/solicitudes/{id_solicitud}', headers=self.headers())
        self.assertEqual(detalle.json['servicio'], response.json[0])

    def test_catalogo_vacio(self):
        Servicio.query.delete()
        db.session.commit()
        self.assertEqual(self.client.get('/api/servicios', headers=self.headers()).json, [])

    def test_catalogo_inicial_sin_tarifas_es_idempotente_y_se_puede_solicitar(self):
        inicializar_catalogo_servicios()
        inicializar_catalogo_servicios()
        servicios = self.client.get('/api/servicios', headers=self.headers()).json
        self.assertEqual(
            [servicio['tipoServicio'] for servicio in servicios],
            [
                'Acompañamiento de adultos mayores',
                'Control de signos vitales',
                'Cuidados Intensivos',
                'Curaciones',
                'Higiene y confort',
                'Inyecciones',
            ],
        )
        curaciones = next(
            servicio for servicio in servicios
            if servicio['tipoServicio'] == 'Curaciones'
        )
        inyecciones = next(
            servicio for servicio in servicios
            if servicio['tipoServicio'] == 'Inyecciones'
        )
        self.assertEqual(curaciones['precioEstimado'], '8500.50')
        self.assertIsNone(inyecciones['precioEstimado'])
        solicitud = self.crear(idServicio=inyecciones['idServicio'])
        self.assertEqual(solicitud.status_code, 201)
        self.assertIsNone(solicitud.json['solicitud']['servicio']['precioEstimado'])
        self.assertEqual(Servicio.query.count(), 6)

    def test_crear_y_consultar_comprobante_sin_cambiar_estado(self):
        response = self.crear()
        self.assertEqual(response.status_code, 201, response.json)
        resumen = response.json['solicitud']
        self.assertEqual(resumen['idPaciente'], 101)  # No confundir perfil con usuario/JWT 11.
        self.assertEqual(resumen['idEnfermero'], 201)
        self.assertEqual(resumen['idServicio'], 301)
        self.assertEqual(resumen['estado'], 'Pendiente')
        self.assertEqual(resumen['fecha'], '2030-01-11')
        self.assertEqual(resumen['hora'], '14:30')
        self.assertEqual(resumen['direccionAtencion'], 'San Martín 123, Mendoza')
        self.assertEqual(resumen['servicio']['precioEstimado'], '8500.50')
        self.assertEqual(resumen['enfermero']['matricula'], 'MAT-201')
        self.assertEqual(resumen['paciente']['nombre'], 'Ana')
        self.assertEqual(SolicitudServicio.query.count(), 1)
        for usuario_id in (11, 21):
            with self.subTest(usuario_id=usuario_id):
                detalle = self.client.get(response.headers['Location'], headers=self.headers(usuario_id))
                self.assertEqual(detalle.status_code, 200)
                self.assertEqual(detalle.json, resumen)
                self.assertNotIn('historial_medico', detalle.get_data(as_text=True))
                self.assertNotIn('password', detalle.get_data(as_text=True))
        self.assertEqual(db.session.get(SolicitudServicio, resumen['idSolicitud']).estado, 'Pendiente')
        self.assertTrue(db.session.get(Enfermero, 201).disponible)

    def test_permite_id_paciente_propio_pero_rechaza_suplantacion(self):
        self.assertEqual(self.crear(idPaciente=102).status_code, 403)
        self.assertEqual(self.crear(idPaciente=11).status_code, 403)
        self.assertEqual(SolicitudServicio.query.count(), 0)
        self.assertEqual(self.crear(idPaciente=101).status_code, 201)

    def test_solo_paciente_puede_crear_aunque_jwt_diga_otro_rol(self):
        response = self.client.post('/api/solicitudes', json=self.payload(),
                                    headers=self.headers(21, additional_claims={'rol': 'paciente'}))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_todos_los_endpoints_exigen_sesion_vigente_y_usuario_existente(self):
        rutas = [('POST', '/api/solicitudes'), ('GET', '/api/solicitudes/1'),
                 ('GET', '/api/solicitudes/paciente/101'), ('GET', '/api/solicitudes/enfermero/201')]
        for metodo, ruta in rutas:
            for headers in ({}, self.headers(999), self.headers(expires_delta=timedelta(seconds=-1))):
                with self.subTest(metodo=metodo, ruta=ruta, headers=bool(headers)):
                    response = self.client.open(ruta, method=metodo, headers=headers, json=self.payload())
                    self.assertEqual(response.status_code, 401)

    def test_sin_perfil_paciente_no_crea(self):
        db.session.delete(db.session.get(Paciente, 101))
        db.session.commit()
        self.assertEqual(self.crear().status_code, 404)

    def test_datos_invalidos_no_se_guardan(self):
        casos = [
            {'idEnfermero': None}, {'idEnfermero': True}, {'idEnfermero': '201'},
            {'idEnfermero': -1}, {'idEnfermero': 2**40}, {'idServicio': 1.5}, {'idServicio': 0},
            {'idPaciente': False}, {'idPaciente': '101'},
            {'fecha': None}, {'fecha': '2030-02-30'}, {'fecha': '2030-1-11'}, {'fecha': []},
            {'hora': '24:00'}, {'hora': '24:01'}, {'hora': '25:00'}, {'hora': '23:60'},
            {'hora': '-1:00'}, {'hora': '9:00'}, {'hora': '14:30:30'}, {'hora': 10},
            {'direccionAtencion': '   '}, {'direccionAtencion': None},
            {'direccionAtencion': 'a' * 201}, {'direccionAtencion': {}},
            {'estado': 'Aceptada'}, {'precioEstimado': '1.00'}, {'idSolicitud': 1},
        ]
        for datos in casos:
            with self.subTest(datos=datos):
                self.assertEqual(self.crear(**datos).status_code, 400)
        for campo in self.payload():
            data = self.payload()
            del data[campo]
            with self.subTest(faltante=campo):
                self.assertEqual(self.client.post('/api/solicitudes', json=data, headers=self.headers()).status_code, 400)
        for raw in ('null', '[]', '"texto"', '{}', '{malformado'):
            response = self.client.post('/api/solicitudes', data=raw, content_type='application/json', headers=self.headers())
            self.assertEqual(response.status_code, 400)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_horas_limite_validas_se_guardan_sin_normalizar(self):
        for hora in ('00:00', '23:59'):
            with self.subTest(hora=hora):
                response = self.crear(hora=hora)
                self.assertEqual(response.status_code, 201, response.json)
                self.assertEqual(response.json['solicitud']['hora'], hora)

    def test_fecha_hora_pasadas_y_actual_rechazadas_mismo_dia_futuro_permitido(self):
        for fecha, hora in (('2030-01-09', '23:59'), ('2030-01-10', '09:59'), ('2030-01-10', '10:00')):
            self.assertEqual(self.crear(fecha=fecha, hora=hora).status_code, 400)
        self.assertEqual(self.crear(fecha='2030-01-10', hora='10:01').status_code, 201)

    def test_enfermero_debe_estar_verificado_y_disponible(self):
        enfermero = db.session.get(Enfermero, 201)
        for verificado, disponible in ((False, True), (True, False), (False, False)):
            enfermero.verificado, enfermero.disponible = verificado, disponible
            db.session.commit()
            self.assertEqual(self.crear().status_code, 409)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_servicio_y_enfermero_deben_existir(self):
        self.assertEqual(self.crear(idServicio=999).status_code, 404)
        self.assertEqual(self.crear(idEnfermero=999).status_code, 404)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_solicitudes_ajenas_y_perfiles_de_otro_rol_denegados(self):
        id_solicitud = self.guardar_solicitud()
        for usuario_id in (12, 22):
            self.assertEqual(self.client.get(f'/api/solicitudes/{id_solicitud}', headers=self.headers(usuario_id)).status_code, 403)
        for ruta, usuario_id in (('/paciente/102', 11), ('/enfermero/202', 21),
                                 ('/enfermero/201', 11), ('/paciente/101', 21)):
            self.assertEqual(self.client.get('/api/solicitudes' + ruta, headers=self.headers(usuario_id)).status_code, 403)
        self.assertEqual(self.client.get('/api/solicitudes/999', headers=self.headers()).status_code, 404)

    def test_paciente_solo_ve_propias_activas_ordenadas(self):
        for estado in ESTADOS_SOLICITUD:
            self.guardar_solicitud(estado=estado)
        self.guardar_solicitud(paciente=102)
        primero = self.guardar_solicitud(hora=9)
        response = self.client.get('/api/solicitudes/paciente/101', headers=self.headers())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json), 3)
        self.assertEqual(response.json[0]['idSolicitud'], primero)
        self.assertTrue(all(item['idPaciente'] == 101 and item['estado'] in ('Pendiente', 'Aceptada') for item in response.json))

    def test_enfermero_ve_recibidas_con_paciente_direccion_y_estado(self):
        for estado in ESTADOS_SOLICITUD:
            self.guardar_solicitud(estado=estado)
        self.guardar_solicitud(enfermero=202)
        response = self.client.get('/api/solicitudes/enfermero/201', headers=self.headers(21))
        self.assertEqual(response.status_code, 200)
        self.assertEqual({item['estado'] for item in response.json}, set(ESTADOS_SOLICITUD))
        self.assertEqual(len(response.json), 5)
        for item in response.json:
            self.assertEqual(item['idEnfermero'], 201)
            self.assertEqual(item['paciente']['telefono'], '2611111111')
            self.assertEqual(item['direccionAtencion'], 'Dirección de atención')

    def test_listas_vacias_devuelven_array(self):
        for ruta, usuario_id in (('/paciente/101', 11), ('/enfermero/201', 21)):
            response = self.client.get('/api/solicitudes' + ruta, headers=self.headers(usuario_id))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json, [])

    def test_error_de_bd_hace_rollback_y_permite_reintentar(self):
        with patch.object(db.session(), 'commit', side_effect=SQLAlchemyError('detalle privado')):
            response = self.crear()
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('detalle privado', response.get_data(as_text=True))
        self.assertEqual(SolicitudServicio.query.count(), 0)
        self.assertEqual(self.crear().status_code, 201)

    def test_perfiles_exponen_id_correcto_y_enfermero_no_puede_autoverificarse(self):
        self.assertEqual(self.client.get('/api/perfil/paciente', headers=self.headers()).json['idPaciente'], 101)
        enfermero = db.session.get(Enfermero, 201)
        enfermero.verificado = False
        db.session.commit()
        response = self.client.put('/api/perfil/enfermero', headers=self.headers(21), json={'verificado': True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json['idEnfermero'], 201)
        self.assertFalse(response.json['verificado'])
        self.assertEqual(self.crear().status_code, 409)

    def test_consultas_no_generan_una_query_por_solicitud(self):
        for _ in range(6):
            self.guardar_solicitud()
        db.session.remove()
        queries = []

        def registrar_query(_conn, _cursor, statement, _parameters, _context, _executemany):
            if statement.lstrip().upper().startswith('SELECT'):
                queries.append(statement)

        event.listen(db.engine, 'before_cursor_execute', registrar_query)
        try:
            response = self.client.get('/api/solicitudes/enfermero/201', headers=self.headers(21))
        finally:
            event.remove(db.engine, 'before_cursor_execute', registrar_query)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json), 6)
        self.assertLessEqual(len(queries), 3)


    # SCRUM-59.1 (Pablo): permisos y transición de aceptación.
    def test_aceptar_solo_actualiza_estado_y_se_refleja_en_consultas(self):
        id_solicitud = self.guardar_solicitud()
        antes = db.session.get(SolicitudServicio, id_solicitud).to_dict()
        response = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21))
        self.assertEqual(response.status_code, 200, response.json)
        esperado = {**antes, 'estado': 'Aceptada'}
        self.assertEqual(response.json['solicitud'], esperado)
        self.assertTrue(db.session.get(Enfermero, 201).disponible)
        detalle = self.client.get(f'/api/solicitudes/{id_solicitud}', headers=self.headers())
        self.assertEqual(detalle.json, esperado)
        paciente = self.client.get('/api/solicitudes/paciente/101', headers=self.headers())
        enfermero = self.client.get('/api/solicitudes/enfermero/201', headers=self.headers(21))
        self.assertEqual(paciente.json[0]['estado'], 'Aceptada')
        self.assertEqual(enfermero.json[0]['estado'], 'Aceptada')

    def test_aceptar_cualquier_estado_distinto_de_pendiente_devuelve_400(self):
        for estado in ('Aceptada', 'Realizada', 'Rechazada', 'Cancelada'):
            with self.subTest(estado=estado):
                id_solicitud = self.guardar_solicitud(estado=estado)
                response = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21))
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, estado)

    def test_aceptar_dos_veces_devuelve_400_la_segunda_vez(self):
        id_solicitud = self.guardar_solicitud()
        ruta = f'/api/solicitudes/{id_solicitud}/aceptar'
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 200)
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 400)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Aceptada')

    def test_aceptar_rechaza_pacientes_y_otro_enfermero_sin_modificar_solicitud(self):
        id_solicitud = self.guardar_solicitud()
        for usuario_id in (11, 12, 22):
            with self.subTest(usuario_id=usuario_id):
                response = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(usuario_id))
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('solicitud', response.json)
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')

    def test_aceptar_exige_jwt_vigente_y_usuario_valido(self):
        id_solicitud = self.guardar_solicitud()
        for headers in ({}, self.headers(21, expires_delta=timedelta(seconds=-1)),
                        self.headers(999), self.headers(201), self.headers('invalido')):
            with self.subTest(headers=bool(headers)):
                response = self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')

    def test_aceptar_solicitud_inexistente_devuelve_404(self):
        response = self.client.put('/api/solicitudes/999/aceptar', headers=self.headers(21))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_aceptar_no_confia_en_rol_ni_asignacion_del_token(self):
        id_solicitud = self.guardar_solicitud()
        for headers in (self.headers(11, additional_claims={'rol': 'enfermero'}),
                        self.headers(22, additional_claims={'idEnfermero': 201})):
            self.assertEqual(self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=headers).status_code, 403)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')

    def test_aceptar_hace_rollback_si_falla_y_permite_reintentar(self):
        id_solicitud = self.guardar_solicitud()
        ruta = f'/api/solicitudes/{id_solicitud}/aceptar'
        with patch.object(db.session(), 'commit', side_effect=SQLAlchemyError('detalle privado')):
            response = self.client.put(ruta, headers=self.headers(21))
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('detalle privado', response.get_data(as_text=True))
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 200)


    # SCRUM-59.2 (Pablo / HU8): finalizar la atención aceptada.
    def test_crear_aceptar_finalizar_actualiza_detalle_y_bandejas(self):
        creada = self.crear()
        id_solicitud = creada.json['solicitud']['idSolicitud']
        ruta = f'/api/solicitudes/{id_solicitud}'
        self.assertEqual(self.client.put(ruta + '/aceptar', headers=self.headers(21)).status_code, 200)
        response = self.client.put(ruta + '/finalizar', headers=self.headers(21))
        self.assertEqual(response.status_code, 200, response.json)
        esperado = {**creada.json['solicitud'], 'estado': 'Realizada'}
        self.assertEqual(response.json['solicitud'], esperado)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Realizada')
        self.assertEqual(self.client.get(ruta, headers=self.headers()).json, esperado)
        self.assertEqual(self.client.get('/api/solicitudes/paciente/101', headers=self.headers()).json, [])
        recibidas = self.client.get('/api/solicitudes/enfermero/201', headers=self.headers(21))
        self.assertEqual(recibidas.json, [esperado])
        self.assertTrue(db.session.get(Enfermero, 201).disponible)

    def test_finalizar_cualquier_estado_distinto_de_aceptada_devuelve_400(self):
        for estado in ('Pendiente', 'Realizada', 'Rechazada', 'Cancelada'):
            with self.subTest(estado=estado):
                id_solicitud = self.guardar_solicitud(estado=estado)
                response = self.client.put(f'/api/solicitudes/{id_solicitud}/finalizar', headers=self.headers(21))
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', response.json)
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, estado)

    def test_finalizar_dos_veces_devuelve_400_la_segunda_vez(self):
        id_solicitud = self.guardar_solicitud(estado='Aceptada')
        ruta = f'/api/solicitudes/{id_solicitud}/finalizar'
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 200)
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 400)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Realizada')

    def test_finalizar_rechaza_pacientes_y_otro_enfermero_sin_modificar_solicitud(self):
        id_solicitud = self.guardar_solicitud(estado='Aceptada')
        for usuario_id in (11, 12, 22):
            with self.subTest(usuario_id=usuario_id):
                response = self.client.put(f'/api/solicitudes/{id_solicitud}/finalizar', headers=self.headers(usuario_id))
                self.assertEqual(response.status_code, 403)
                self.assertNotIn('solicitud', response.json)
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Aceptada')

    def test_finalizar_exige_jwt_vigente_y_usuario_valido(self):
        id_solicitud = self.guardar_solicitud(estado='Aceptada')
        for headers in ({}, self.headers(21, expires_delta=timedelta(seconds=-1)),
                        self.headers(999), self.headers(201), self.headers('invalido')):
            with self.subTest(headers=bool(headers)):
                response = self.client.put(f'/api/solicitudes/{id_solicitud}/finalizar', headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Aceptada')

    def test_finalizar_solicitud_inexistente_devuelve_404(self):
        response = self.client.put('/api/solicitudes/999/finalizar', headers=self.headers(21))
        self.assertEqual(response.status_code, 404)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_finalizar_no_confia_en_rol_ni_asignacion_del_token(self):
        id_solicitud = self.guardar_solicitud(estado='Aceptada')
        for headers in (self.headers(11, additional_claims={'rol': 'enfermero'}),
                        self.headers(22, additional_claims={'idEnfermero': 201})):
            response = self.client.put(f'/api/solicitudes/{id_solicitud}/finalizar', headers=headers)
            self.assertEqual(response.status_code, 403)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Aceptada')

    def test_finalizar_hace_rollback_si_falla_y_permite_reintentar(self):
        id_solicitud = self.guardar_solicitud(estado='Aceptada')
        ruta = f'/api/solicitudes/{id_solicitud}/finalizar'
        with patch.object(db.session(), 'commit', side_effect=SQLAlchemyError('detalle privado')):
            response = self.client.put(ruta, headers=self.headers(21))
        self.assertEqual(response.status_code, 500)
        self.assertNotIn('detalle privado', response.get_data(as_text=True))
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Aceptada')
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).status_code, 200)


    def test_rechazar_y_cancelar_liberan_turno_y_actualizan_bandejas(self):
        for accion, usuario, origen, destino in (
            ('rechazar', 21, 'Pendiente', 'Rechazada'),
            ('cancelar', 11, 'Pendiente', 'Cancelada'),
            ('cancelar', 11, 'Aceptada', 'Cancelada'),
        ):
            with self.subTest(accion=accion, origen=origen):
                id_solicitud = self.guardar_solicitud(estado=origen)
                antes = db.session.get(SolicitudServicio, id_solicitud).to_dict()
                self.assertEqual(self.crear().status_code, 409)
                ruta = f'/api/solicitudes/{id_solicitud}/{accion}'
                response = self.client.put(ruta, headers=self.headers(usuario))
                self.assertEqual(response.status_code, 200, response.json)
                self.assertEqual(response.json['solicitud'], {**antes, 'estado': destino})
                self.assertEqual(self.client.put(ruta, headers=self.headers(usuario)).status_code, 400)
                self.assertEqual(self.client.get('/api/solicitudes/paciente/101', headers=self.headers()).json, [])
                recibidas = self.client.get('/api/solicitudes/enfermero/201', headers=self.headers(21)).json
                self.assertEqual(next(s for s in recibidas if s['idSolicitud'] == id_solicitud)['estado'], destino)
                nueva = self.crear()
                self.assertEqual(nueva.status_code, 201, nueva.json)
                # Dejar libre el mismo horario para el siguiente caso.
                nueva_id = nueva.json['solicitud']['idSolicitud']
                self.assertEqual(self.client.put(f'/api/solicitudes/{nueva_id}/cancelar', headers=self.headers()).status_code, 200)
                self.assertTrue(db.session.get(Enfermero, 201).disponible)

    def test_rechazar_y_cancelar_no_permiten_estados_invalidos(self):
        for accion, usuario, estados in (
            ('rechazar', 21, ('Aceptada', 'Realizada', 'Rechazada', 'Cancelada')),
            ('cancelar', 11, ('Realizada', 'Rechazada', 'Cancelada')),
        ):
            for estado in estados:
                with self.subTest(accion=accion, estado=estado):
                    id_solicitud = self.guardar_solicitud(estado=estado)
                    response = self.client.put(f'/api/solicitudes/{id_solicitud}/{accion}', headers=self.headers(usuario))
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, estado)

    def test_rechazar_y_cancelar_exigen_rol_y_titularidad_de_la_base(self):
        id_solicitud = self.guardar_solicitud()
        for accion, usuarios in (('rechazar', (11, 12, 22)), ('cancelar', (12, 21, 22))):
            for usuario in usuarios:
                with self.subTest(accion=accion, usuario=usuario):
                    response = self.client.put(
                        f'/api/solicitudes/{id_solicitud}/{accion}',
                        headers=self.headers(usuario, additional_claims={'rol': 'paciente', 'idPaciente': 101, 'idEnfermero': 201}),
                        json={'idPaciente': 101, 'idEnfermero': 201, 'estado': 'Cancelada'},
                    )
                    self.assertEqual(response.status_code, 403)
                    self.assertNotIn('solicitud', response.json)
                    self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')
        self.assertEqual(self.crear().status_code, 409)

    def test_rechazar_y_cancelar_exigen_jwt_y_usuario_existente(self):
        id_solicitud = self.guardar_solicitud()
        for accion, usuario in (('rechazar', 21), ('cancelar', 11)):
            for headers in ({}, self.headers(usuario, expires_delta=timedelta(seconds=-1)),
                            self.headers(999), self.headers(101), self.headers('invalido')):
                with self.subTest(accion=accion, headers=bool(headers)):
                    response = self.client.put(f'/api/solicitudes/{id_solicitud}/{accion}', headers=headers)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')

    def test_rechazar_y_cancelar_solicitud_inexistente(self):
        for accion, usuario in (('rechazar', 21), ('cancelar', 11)):
            response = self.client.put(f'/api/solicitudes/999/{accion}', headers=self.headers(usuario))
            self.assertEqual(response.status_code, 404)
        self.assertEqual(SolicitudServicio.query.count(), 0)

    def test_rechazar_y_cancelar_rollback_conserva_reserva_y_permite_reintentar(self):
        for accion, usuario in (('rechazar', 21), ('cancelar', 11)):
            with self.subTest(accion=accion):
                id_solicitud = self.guardar_solicitud()
                ruta = f'/api/solicitudes/{id_solicitud}/{accion}'
                with patch.object(db.session(), 'commit', side_effect=SQLAlchemyError('detalle privado')):
                    response = self.client.put(ruta, headers=self.headers(usuario))
                self.assertEqual(response.status_code, 500)
                self.assertNotIn('detalle privado', response.get_data(as_text=True))
                self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')
                self.assertEqual(self.crear().status_code, 409)
                self.assertEqual(self.client.put(ruta, headers=self.headers(usuario)).status_code, 200)

    def test_reserva_solo_bloquea_mismo_enfermero_fecha_y_hora_activos(self):
        id_solicitud = self.guardar_solicitud()
        self.assertEqual(self.crear(usuario_id=12).status_code, 409)
        self.assertEqual(self.client.put(f'/api/solicitudes/{id_solicitud}/aceptar', headers=self.headers(21)).status_code, 200)
        self.assertEqual(self.crear().status_code, 409)
        for cambios in ({'fecha': '2030-01-12'}, {'hora': '15:30'}, {'idEnfermero': 202}):
            with self.subTest(cambios=cambios):
                self.assertEqual(self.crear(**cambios).status_code, 201)

    def test_duplicados_anteriores_no_pueden_aceptarse_simultaneamente(self):
        primero = self.guardar_solicitud()
        segundo = self.guardar_solicitud(paciente=102)
        self.assertEqual(self.client.put(f'/api/solicitudes/{primero}/aceptar', headers=self.headers(21)).status_code, 200)
        self.assertEqual(self.client.put(f'/api/solicitudes/{segundo}/aceptar', headers=self.headers(21)).status_code, 409)
        self.assertEqual(self.client.put(f'/api/solicitudes/{primero}/cancelar', headers=self.headers()).status_code, 200)
        # El segundo pedido pendiente conserva su reserva aunque se cancele el primero.
        self.assertEqual(self.crear().status_code, 409)
        self.assertEqual(self.client.put(f'/api/solicitudes/{segundo}/aceptar', headers=self.headers(21)).status_code, 200)

    def test_liberar_turno_no_reactiva_enfermero_no_disponible(self):
        id_solicitud = self.guardar_solicitud()
        db.session.get(Enfermero, 201).disponible = False
        db.session.commit()
        response = self.client.put(f'/api/solicitudes/{id_solicitud}/rechazar', headers=self.headers(21))
        self.assertEqual(response.status_code, 200)
        self.assertFalse(db.session.get(Enfermero, 201).disponible)
        self.assertEqual(self.crear().status_code, 409)


class MigracionSprint4Test(unittest.TestCase):
    def setUp(self):
        self.app = crear_app_pruebas()
        self.context = self.app.app_context()
        self.context.push()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_base_nueva_crea_relaciones_y_columnas_del_diagrama(self):
        inicializar_bd_sprint4()
        inspector = inspect(db.engine)
        self.assertEqual({c['name'] for c in inspector.get_columns('solicitudes_servicio')}, {
            'idSolicitud', 'idPaciente', 'idEnfermero', 'idServicio', 'fecha', 'hora', 'estado', 'direccionAtencion',
        })
        self.assertEqual({fk['referred_table'] for fk in inspector.get_foreign_keys('solicitudes_servicio')},
                         {'pacientes', 'enfermeros', 'servicios'})
        precio = next(column for column in inspector.get_columns('servicios')
                       if column['name'] == 'precioEstimado')
        self.assertTrue(precio['nullable'])

    def test_base_existente_preserva_datos_y_verificacion_al_repetir(self):
        Usuario.__table__.create(db.engine)
        with db.engine.begin() as connection:
            connection.execute(text("INSERT INTO usuarios (id, email, rol, password_hash) VALUES (1, 'previo@test.local', 'enfermero', 'conservar')"))
            connection.execute(text('''CREATE TABLE enfermeros (
                id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL, nombre VARCHAR(100),
                apellido VARCHAR(100), matricula VARCHAR(50) NOT NULL, especialidad VARCHAR(100)
            )'''))
            connection.execute(text("INSERT INTO enfermeros (id, usuario_id, nombre, matricula) VALUES (1, 1, 'Previo', 'MAT-PREVIA')"))
            connection.execute(text('''CREATE TABLE pacientes (
                id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL UNIQUE,
                nombre VARCHAR(100), apellido VARCHAR(100), direccion VARCHAR(200),
                telefono VARCHAR(20), historial_medico TEXT
            )'''))
            connection.execute(text(
                "INSERT INTO pacientes (id, usuario_id, nombre) VALUES (1, 2, 'Paciente previo')"
            ))
        inicializar_bd_sprint4()
        inicializar_bd_sprint3()
        enfermero = db.session.get(Enfermero, 1)
        self.assertFalse(enfermero.verificado)
        self.assertEqual(enfermero.nombre, 'Previo')
        self.assertEqual(enfermero.usuario.password_hash, 'conservar')
        enfermero.verificado = True
        db.session.commit()
        inicializar_bd_sprint4()
        db.session.expire_all()
        self.assertTrue(db.session.get(Enfermero, 1).verificado)
        self.assertEqual(Servicio.query.count(), 0)  # No inventa catálogo ni precios.
        columnas_paciente = {
            columna['name'] for columna in inspect(db.engine).get_columns('pacientes')
        }
        self.assertTrue({'latitud', 'longitud', 'ubicacion_compartida'} <= columnas_paciente)
        self.assertEqual(db.session.get(Paciente, 1).nombre, 'Paciente previo')


if __name__ == '__main__':
    unittest.main()
