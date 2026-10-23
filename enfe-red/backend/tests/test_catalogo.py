"""SCRUM-14/53 (filtrar por tipo de servicio) y SCRUM-30/50 (el administrador gestiona el catálogo)."""
import unittest
from datetime import datetime
from decimal import Decimal
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect, text

from database import db
from extensions import bcrypt
from models.auditoria_models import AuditoriaAdmin
from models.servicio_models import Servicio
from models.usuario_models import Enfermero, Paciente, Usuario
from routes.admin_routes import admin_bp
from routes.solicitud_routes import solicitud_bp
from routes.usuario_routes import usuario_bp
from schema_catalogo import inicializar_bd_catalogo
from seguridad import configurar_sesiones


class BaseCatalogoTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', BCRYPT_LOG_ROUNDS=4,
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
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
            Usuario(id=11, email='ana@test.local', password_hash='x', rol='paciente'),
            Usuario(id=21, email='laura@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=22, email='pedro@test.local', password_hash='x', rol='enfermero'),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', telefono='2611111111'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', matricula='MAT-1', verificado=True, disponible=True),
            Enfermero(id=202, usuario_id=22, nombre='Pedro', matricula='MAT-2', verificado=True, disponible=True),
            Servicio(idServicio=301, tipoServicio='Curaciones', precioEstimado=Decimal('8500')),
            Servicio(idServicio=302, tipoServicio='Inyecciones', precioEstimado=Decimal('6000')),
            Servicio(idServicio=303, tipoServicio='Ventosas', activo=False),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        for objetivo, valor in (('routes.solicitud_routes._ahora_local', datetime(2030, 1, 10, 10, 0)),
                                ('services.turnos.enviar_aviso', None)):
            parche = patch(objetivo, return_value=valor)
            parche.start()
            self.addCleanup(parche.stop)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def headers(self, usuario, **claims):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario), additional_claims=claims)}

    def admin(self):
        return self.headers(1, rol='administrador', nivelPermiso='total')

    def ofrecer(self, enfermero_usuario, servicios):
        return self.client.put('/api/perfil/enfermero', headers=self.headers(enfermero_usuario),
                               json={'servicios': servicios})


class ServiciosDelEnfermeroTest(BaseCatalogoTest):
    def test_el_enfermero_elige_los_servicios_que_ofrece(self):
        respuesta = self.ofrecer(21, [302, 301, 302])
        self.assertEqual(respuesta.status_code, 200, respuesta.json)
        self.assertEqual([s['tipoServicio'] for s in respuesta.json['servicios']], ['Curaciones', 'Inyecciones'])
        perfil = self.client.get('/api/perfil/enfermero', headers=self.headers(21)).json
        self.assertEqual([s['idServicio'] for s in perfil['servicios']], [301, 302])
        self.assertEqual(self.ofrecer(21, []).json['servicios'], [])

    def test_rechaza_servicios_inexistentes_dados_de_baja_o_mal_formados(self):
        for servicios in ([999], [303], 'Curaciones', [True], [301, '302'], None):
            with self.subTest(servicios=servicios):
                respuesta = self.ofrecer(21, servicios)
                self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(db.session.get(Enfermero, 201).servicios, [])

    def test_la_cartilla_filtra_por_tipo_de_servicio(self):
        self.ofrecer(21, [301, 302])
        self.ofrecer(22, [302])
        nombres = lambda servicio: [e['nombre'] for e in self.client.get(
            f'/api/enfermeros/buscar?servicio={servicio}').json['enfermeros']]
        self.assertEqual(nombres(301), ['Laura'])
        self.assertEqual(sorted(nombres(302)), ['Laura', 'Pedro'])
        self.assertEqual(nombres(303), [])
        todos = self.client.get('/api/enfermeros/buscar').json['enfermeros']
        laura = next(e for e in todos if e['nombre'] == 'Laura')
        self.assertEqual([s['tipoServicio'] for s in laura['servicios']], ['Curaciones', 'Inyecciones'])
        for valor in ('abc', '0', '-3'):
            self.assertEqual(self.client.get(f'/api/enfermeros/buscar?servicio={valor}').status_code, 400)

    def test_un_servicio_dado_de_baja_deja_de_mostrarse_y_de_filtrar(self):
        self.ofrecer(21, [301, 302])
        db.session.get(Servicio, 301).activo = False
        db.session.commit()
        laura = self.client.get('/api/enfermeros/buscar').json['enfermeros'][0]
        self.assertEqual([s['idServicio'] for s in laura['servicios']], [302])
        self.assertEqual(self.client.get('/api/enfermeros/buscar?servicio=301').json['enfermeros'], [])
        # Al guardar el perfil se conserva el vínculo con el dado de baja, por si vuelve al catálogo.
        self.ofrecer(21, [302])
        db.session.get(Servicio, 301).activo = True
        db.session.commit()
        self.assertEqual([s.idServicio for s in db.session.get(Enfermero, 201).servicios], [301, 302])


class SolicitarServicioOfrecidoTest(BaseCatalogoTest):
    def crear(self, servicio, enfermero=201):
        return self.client.post('/api/solicitudes', headers=self.headers(11), json={
            'idEnfermero': enfermero, 'idServicio': servicio, 'fecha': '2030-01-11', 'hora': '14:30',
            'direccionAtencion': 'San Martín 123',
        })

    def test_solo_se_pide_un_servicio_que_el_enfermero_ofrece(self):
        self.ofrecer(21, [302])
        respuesta = self.crear(301)
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn('no ofrece ese servicio', respuesta.json['error'])
        self.assertEqual(self.crear(302).status_code, 201)

    def test_sin_servicios_declarados_acepta_cualquiera_del_catalogo(self):
        self.assertEqual(self.crear(301, enfermero=202).status_code, 201)

    def test_un_servicio_dado_de_baja_no_se_puede_pedir_ni_aparece_en_el_catalogo(self):
        respuesta = self.crear(303)
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn('ya no se ofrece', respuesta.json['error'])
        catalogo = self.client.get('/api/servicios', headers=self.headers(11)).json
        self.assertEqual([s['idServicio'] for s in catalogo], [301, 302])


class CatalogoAdminTest(BaseCatalogoTest):
    def test_lista_todo_el_catalogo_con_uso_y_solo_para_administradores(self):
        self.ofrecer(21, [301])
        respuesta = self.client.get('/api/admin/servicios', headers=self.admin())
        self.assertEqual(respuesta.status_code, 200)
        servicios = respuesta.json['servicios']
        self.assertEqual([(s['tipoServicio'], s['activo']) for s in servicios],
                         [('Curaciones', True), ('Inyecciones', True), ('Ventosas', False)])
        self.assertEqual((servicios[0]['enfermerosQueLoOfrecen'], servicios[0]['solicitudes']), (1, 0))
        for headers in (self.headers(11), self.headers(21), {}):
            self.assertIn(self.client.get('/api/admin/servicios', headers=headers).status_code, (401, 403))

    def test_crear_servicio_valida_y_queda_en_la_auditoria(self):
        invalidos = (
            {}, {'tipoServicio': 'ab'}, {'tipoServicio': 'curaciones'}, {'tipoServicio': 'x' * 101},
            {'tipoServicio': 'Nebulizaciones', 'precioEstimado': -1},
            {'tipoServicio': 'Nebulizaciones', 'precioEstimado': 'gratis'},
            {'tipoServicio': 'Nebulizaciones', 'duracionMinutos': 10},
            {'tipoServicio': 'Nebulizaciones', 'duracionMinutos': 45.5},
            {'tipoServicio': 'Nebulizaciones', 'descripcion': 'x' * 256},
        )
        for datos in invalidos:
            with self.subTest(datos=str(datos)[:50]):
                self.assertEqual(self.client.post('/api/admin/servicios', headers=self.admin(), json=datos).status_code, 400)
        respuesta = self.client.post('/api/admin/servicios', headers=self.admin(), json={
            'tipoServicio': '  Nebulizaciones  ', 'descripcion': 'Con equipo del paciente',
            'precioEstimado': '4500.5', 'duracionMinutos': 30,
        })
        self.assertEqual(respuesta.status_code, 201, respuesta.json)
        servicio = respuesta.json['servicio']
        self.assertEqual((servicio['tipoServicio'], servicio['precioEstimado'], servicio['duracionMinutos'],
                          servicio['activo']), ('Nebulizaciones', '4500.50', 30, True))
        [registro] = AuditoriaAdmin.query.all()
        self.assertEqual((registro.accion, registro.tipoObjetivo, registro.idObjetivo),
                         ('crear_servicio', 'servicio', servicio['idServicio']))

    def test_editar_precio_descripcion_y_dar_de_baja_o_de_alta(self):
        editar = lambda datos: self.client.put('/api/admin/servicios/301', headers=self.admin(), json=datos)
        respuesta = editar({'precioEstimado': 9000, 'descripcion': 'Curaciones planas y de heridas'})
        self.assertEqual(respuesta.status_code, 200, respuesta.json)
        self.assertEqual((respuesta.json['servicio']['precioEstimado'], respuesta.json['servicio']['descripcion']),
                         ('9000.00', 'Curaciones planas y de heridas'))
        self.assertEqual(editar({'precioEstimado': None}).json['servicio']['precioEstimado'], None)
        self.assertEqual(editar({'tipoServicio': 'Inyecciones'}).status_code, 400)  # Nombre repetido.
        self.assertEqual(editar({}).status_code, 400)
        self.assertEqual(editar({'activo': False}).json['mensaje'], 'Servicio dado de baja')
        self.assertEqual(editar({'activo': True}).json['mensaje'], 'Servicio disponible de nuevo')
        self.assertEqual(self.client.put('/api/admin/servicios/999', headers=self.admin(),
                                         json={'activo': False}).status_code, 404)
        acciones = [r.accion for r in AuditoriaAdmin.query.order_by(AuditoriaAdmin.idAuditoria)]
        self.assertEqual(acciones, ['editar_servicio', 'editar_servicio', 'baja_servicio', 'alta_servicio'])

    def test_metodos_del_diagrama_de_clases(self):
        servicio = db.session.get(Servicio, 302)
        servicio.actualizarPrecio(Decimal('6500'))
        servicio.modificarDescripcion('Intramusculares y subcutáneas')
        self.assertEqual((servicio.precioEstimado, servicio.descripcion),
                         (Decimal('6500'), 'Intramusculares y subcutáneas'))


class MigracionCatalogoTest(BaseCatalogoTest):
    def test_agrega_columna_activo_y_tabla_en_una_base_existente(self):
        db.session.remove()
        with db.engine.begin() as connection:
            connection.execute(text('DROP TABLE enfermero_servicios'))
            connection.execute(text('ALTER TABLE servicios DROP COLUMN activo'))
        inicializar_bd_catalogo()
        inicializar_bd_catalogo()  # Idempotente.
        inspector = inspect(db.engine)
        self.assertIn('activo', {c['name'] for c in inspector.get_columns('servicios')})
        self.assertIn('enfermero_servicios', inspector.get_table_names())
        self.assertTrue(all(servicio.activo for servicio in Servicio.query.all()))


if __name__ == '__main__':
    unittest.main()
