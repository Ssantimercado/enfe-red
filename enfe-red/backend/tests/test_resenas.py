"""Sprint de reputación de Santiago: SCRUM-65 (promedio), SCRUM-66 (publicar) y SCRUM-67 (consultar)."""
import unittest
from datetime import date, time
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from database import db
from models.calificacion_models import Calificacion
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario
from routes.comunicacion_routes import comunicacion_bp
from routes.resena_routes import resena_bp
from schema_sprint4 import inicializar_bd_sprint4


class ResenasTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
        self.app.logger.disabled = True
        db.init_app(self.app)
        JWTManager(self.app)
        for blueprint in (resena_bp, comunicacion_bp):
            self.app.register_blueprint(blueprint, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=i, email=f'{i}@test.local', password_hash='privado', rol=rol)
            for i, rol in [(11, 'paciente'), (12, 'paciente'), (21, 'enfermero'), (22, 'enfermero')]
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', apellido='Pérez', historial_medico='PRIVADO'),
            Paciente(id=102, usuario_id=12, nombre='Mario'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', matricula='MAT-1'),
            Enfermero(id=202, usuario_id=22, nombre='Otro', matricula='MAT-2'),
            Servicio(idServicio=301, tipoServicio='Curaciones'),
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

    def solicitud(self, estado='Realizada', paciente=101, enfermero=201, fecha=date(2026, 1, 10)):
        item = SolicitudServicio(idPaciente=paciente, idEnfermero=enfermero, idServicio=301, fecha=fecha,
                                 hora=time(10), estado=estado, direccionAtencion='San Martín 123')
        db.session.add(item)
        db.session.commit()
        return item.idSolicitud

    def publicar(self, id_solicitud, puntuacion=5, comentario='Muy buena atención', usuario=11):
        return self.client.post('/api/resenas', headers=self.headers(usuario), json={
            'idSolicitud': id_solicitud, 'puntuacion': puntuacion, 'comentario': comentario,
        })

    def test_publicar_actualiza_el_promedio_y_se_consulta(self):
        respuesta = self.publicar(self.solicitud(), puntuacion=5)
        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(respuesta.json['calificacionPromedio'], 5.0)
        self.assertEqual(respuesta.json['resena']['paciente'], 'Ana P.')
        self.assertEqual(self.publicar(self.solicitud(paciente=102), puntuacion=2, usuario=12).status_code, 201)

        enfermero = db.session.get(Enfermero, 201)
        self.assertEqual((enfermero.calificacionPromedio, enfermero.cantidadResenas), (3.5, 2))
        self.assertEqual(enfermero.to_dict()['puntuacion'], 3.5)

        consulta = self.client.get('/api/enfermeros/201/resenas', headers=self.headers(12))
        self.assertEqual(consulta.status_code, 200)
        self.assertEqual(consulta.json['calificacionPromedio'], 3.5)
        self.assertEqual(consulta.json['cantidadResenas'], 2)
        self.assertEqual([r['puntuacion'] for r in consulta.json['resenas']], [2, 5])
        self.assertTrue(consulta.json['resenas'][0]['fecha'].endswith('Z'))
        self.assertNotIn('PRIVADO', consulta.get_data(as_text=True))
        self.assertNotIn('@test.local', consulta.get_data(as_text=True))

    def test_solo_despues_de_finalizada_la_atencion(self):
        for estado in ('Pendiente', 'Aceptada', 'Rechazada', 'Cancelada'):
            with self.subTest(estado=estado):
                respuesta = self.publicar(self.solicitud(estado=estado))
                self.assertEqual(respuesta.status_code, 409)
        self.assertEqual(Calificacion.query.count(), 0)

    def test_una_resena_por_solicitud_y_solo_del_paciente_duenio(self):
        id_solicitud = self.solicitud()
        self.assertEqual(self.publicar(id_solicitud, usuario=12).status_code, 403)
        self.assertEqual(self.publicar(id_solicitud, usuario=21).status_code, 403)
        self.assertEqual(self.publicar(id_solicitud).status_code, 201)
        self.assertEqual(self.publicar(id_solicitud, puntuacion=1).status_code, 409)
        self.assertEqual(self.publicar(9999).status_code, 404)
        self.assertEqual(db.session.get(Enfermero, 201).cantidadResenas, 1)

    def test_validacion_de_datos(self):
        id_solicitud = self.solicitud()
        casos = [
            {'idSolicitud': id_solicitud, 'puntuacion': 6, 'comentario': 'x'},
            {'idSolicitud': id_solicitud, 'puntuacion': True, 'comentario': 'x'},
            {'idSolicitud': id_solicitud, 'puntuacion': 4, 'comentario': '   '},
            {'idSolicitud': id_solicitud, 'puntuacion': 4, 'comentario': 'a' * 2001},
            {'idSolicitud': id_solicitud, 'puntuacion': 4},
            {'idSolicitud': id_solicitud, 'puntuacion': 4, 'comentario': 'x', 'idUsuarioAutor': 12},
        ]
        for datos in casos:
            with self.subTest(datos=str(datos)[:60]):
                respuesta = self.client.post('/api/resenas', headers=self.headers(11), json=datos)
                self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(self.client.post('/api/resenas', headers=self.headers(11), data='no json').status_code, 400)
        self.assertEqual(self.client.post('/api/resenas', json=casos[0]).status_code, 401)

    def test_error_de_base_revierte_resena_y_promedio(self):
        id_solicitud = self.solicitud()
        with patch('routes.resena_routes.recalcular_promedio', side_effect=SQLAlchemyError('falla')):
            self.assertEqual(self.publicar(id_solicitud).status_code, 500)
        self.assertEqual(Calificacion.query.count(), 0)
        self.assertIsNone(db.session.get(Enfermero, 201).calificacionPromedio)

    def test_calificar_desde_el_historial_tambien_actualiza_el_promedio(self):
        id_solicitud = self.solicitud(estado='Aceptada', fecha=date(2020, 1, 10))
        ruta = f'/api/solicitudes/{id_solicitud}/calificaciones'
        respuesta = self.client.post(ruta, headers=self.headers(11), json={'estrellas': 4, 'comentario': 'Bien'})
        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(db.session.get(Enfermero, 201).calificacionPromedio, 4.0)
        # La calificación del enfermero al paciente no cuenta para su propio promedio.
        self.client.post(ruta, headers=self.headers(21), json={'estrellas': 1, 'comentario': 'Ok'})
        enfermero = db.session.get(Enfermero, 201)
        self.assertEqual((enfermero.calificacionPromedio, enfermero.cantidadResenas), (4.0, 1))

    def test_consulta_de_enfermero_sin_resenas_o_inexistente(self):
        sin_resenas = self.client.get('/api/enfermeros/202/resenas', headers=self.headers(11))
        self.assertEqual(sin_resenas.json, {
            'idEnfermero': 202, 'calificacionPromedio': None, 'cantidadResenas': 0, 'resenas': [],
        })
        self.assertEqual(self.client.get('/api/enfermeros/999/resenas', headers=self.headers(11)).status_code, 404)
        self.assertEqual(self.client.get('/api/enfermeros/201/resenas').status_code, 401)

    def test_migracion_agrega_columnas_y_completa_el_promedio(self):
        db.session.remove()
        db.drop_all()
        with db.engine.begin() as conexion:
            conexion.execute(text('CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email VARCHAR(120), '
                                  'password_hash VARCHAR(255), rol VARCHAR(50))'))
            conexion.execute(text('CREATE TABLE pacientes (id INTEGER PRIMARY KEY, usuario_id INTEGER)'))
            conexion.execute(text('CREATE TABLE enfermeros (id INTEGER PRIMARY KEY, usuario_id INTEGER, '
                                  'nombre VARCHAR(100), matricula VARCHAR(50))'))
            conexion.execute(text('CREATE TABLE calificaciones_servicio (idCalificacion INTEGER PRIMARY KEY, '
                                  'idSolicitud INTEGER, idUsuarioAutor INTEGER, idUsuarioCalificado INTEGER, '
                                  'estrellas INTEGER, comentario TEXT)'))
            conexion.execute(text("INSERT INTO enfermeros VALUES (201, 21, 'Laura', 'MAT-1')"))
            conexion.execute(text("INSERT INTO calificaciones_servicio VALUES (1, 1, 11, 21, 4, 'a'), "
                                  "(2, 2, 12, 21, 5, 'b')"))
        inicializar_bd_sprint4()
        inicializar_bd_sprint4()  # Idempotente.
        columnas = {c['name'] for c in inspect(db.engine).get_columns('enfermeros')}
        self.assertTrue({'calificacionPromedio', 'cantidadResenas'} <= columnas)
        self.assertIn('fecha', {c['name'] for c in inspect(db.engine).get_columns('calificaciones_servicio')})
        # La tabla vieja no tiene todas las columnas del modelo: se lee con SQL.
        with db.engine.connect() as conexion:
            fila = conexion.execute(text(
                'SELECT calificacionPromedio, cantidadResenas FROM enfermeros WHERE id = 201'
            )).one()
        self.assertEqual(tuple(fila), (4.5, 2))


if __name__ == '__main__':
    unittest.main()
