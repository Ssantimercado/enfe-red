"""Administración: respaldo de matrículas, identidad, auditoría, permisos, moderación de reseñas y métricas."""
import unittest
from datetime import date, datetime, time
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect, text

from database import db
from extensions import bcrypt
from models.auditoria_models import AuditoriaAdmin
from models.calificacion_models import Calificacion
from models.notificacion_models import Notificacion
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario
from routes.admin_routes import admin_bp
from routes.resena_routes import resena_bp
from routes.usuario_routes import usuario_bp
from schema_sprint7 import inicializar_bd_sprint7
from seguridad import configurar_sesiones


class BaseModeracionTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', BCRYPT_LOG_ROUNDS=4,
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
        self.app.logger.disabled = True
        db.init_app(self.app)
        bcrypt.init_app(self.app)
        configurar_sesiones(JWTManager(self.app))
        for blueprint in (usuario_bp, admin_bp, resena_bp):
            self.app.register_blueprint(blueprint, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=1, email='admin@test.local', password_hash='x', rol='administrador', nivelPermiso='total'),
            Usuario(id=2, email='moderador@test.local', password_hash='x', rol='administrador',
                    nivelPermiso='moderador'),
            Usuario(id=11, email='ana@test.local', password_hash='x', rol='paciente'),
            Usuario(id=12, email='mario@test.local', password_hash='x', rol='paciente'),
            Usuario(id=21, email='laura@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=22, email='pedro@test.local', password_hash='x', rol='enfermero'),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', apellido='Pérez', historial_medico='Diabetes'),
            Paciente(id=102, usuario_id=12, nombre='Mario'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', apellido='Gómez', matricula='MAT-1',
                      verificado=True, disponible=True),
            Enfermero(id=202, usuario_id=22, nombre='Pedro', apellido='Ruiz', matricula='MAT-2'),
            Servicio(idServicio=301, tipoServicio='Curaciones'),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        self.correo = patch('services.turnos.enviar_aviso')
        self.enviar_aviso = self.correo.start()
        self.addCleanup(self.correo.stop)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def headers(self, usuario, **claims):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario), additional_claims=claims)}

    def admin(self, usuario=1, nivel='total'):
        return self.headers(usuario, rol='administrador', nivelPermiso=nivel)

    def guardar(self, estado='Pendiente', paciente=101, enfermero=201, fecha=date(2030, 1, 11), hora=time(14, 30)):
        solicitud = SolicitudServicio(idPaciente=paciente, idEnfermero=enfermero, idServicio=301, fecha=fecha,
                                      hora=hora, estado=estado, direccionAtencion='San Martín 123')
        db.session.add(solicitud)
        db.session.commit()
        return solicitud.idSolicitud

    def avisos(self, usuario, tipo):
        return Notificacion.query.filter_by(idUsuario=usuario, tipo=tipo).all()


class MatriculaTest(BaseModeracionTest):
    def revisar(self, enfermero, headers=None, **datos):
        with patch('routes.admin_routes.ahora_local', return_value=datetime(2030, 1, 10, 10, 0)):
            return self.client.put(f'/api/admin/enfermeros/{enfermero}/matricula',
                                   headers=headers or self.admin(), json=datos)

    def test_rechazar_exige_motivo(self):
        for datos in ({'verificado': False}, {'verificado': False, 'motivo': 'nop'},
                      {'verificado': False, 'motivo': 'x' * 301}, {'verificado': False, 'motivo': 12}):
            with self.subTest(datos=str(datos)[:40]):
                respuesta = self.revisar(202, **datos)
                self.assertEqual(respuesta.status_code, 400)
                self.assertIn('motivo', respuesta.json['error'])
        self.assertFalse(db.session.get(Enfermero, 202).matricula_rechazada)
        self.assertEqual(AuditoriaAdmin.query.count(), 0)

    def test_aprobar_guarda_quien_y_cuando_y_avisa(self):
        respuesta = self.revisar(202, verificado=True)
        self.assertEqual(respuesta.status_code, 200)
        datos = respuesta.json['enfermero']
        self.assertEqual((datos['verificado'], datos['estadoVerificacion'], datos['verificadoPor']),
                         (True, 'verificada', 1))
        self.assertTrue(datos['verificadoEn'].endswith('Z'))
        self.assertIsNone(datos['motivoRechazo'])
        [aviso] = self.avisos(22, 'matricula')
        self.assertIsNone(aviso.idSolicitud)
        self.assertIn('verificó tu matrícula', aviso.mensaje)
        self.assertEqual(self.enviar_aviso.call_args.args[0].id, 22)
        [registro] = AuditoriaAdmin.query.all()
        self.assertEqual((registro.idAdmin, registro.accion, registro.tipoObjetivo, registro.idObjetivo),
                         (1, 'aprobar_matricula', 'enfermero', 202))

    def test_rechazar_avisa_con_motivo_y_cancela_turnos_futuros(self):
        pendiente = self.guardar()
        aceptada = self.guardar('Aceptada', paciente=102, hora=time(16))
        pasada = self.guardar('Aceptada', fecha=date(2030, 1, 9))
        motivo = 'El número de matrícula no coincide con el registro provincial.'
        respuesta = self.revisar(201, verificado=False, motivo=f'  {motivo}  ')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['enfermero']['estadoVerificacion'], 'rechazada')
        self.assertEqual(respuesta.json['enfermero']['turnosCancelados'], 2)
        db.session.expire_all()
        enfermero = db.session.get(Enfermero, 201)
        self.assertEqual((enfermero.verificado, enfermero.matricula_rechazada, enfermero.motivoRechazo),
                         (False, True, motivo))
        for id_solicitud in (pendiente, aceptada):
            solicitud = db.session.get(SolicitudServicio, id_solicitud)
            self.assertEqual((solicitud.estado, solicitud.canceladaPor), ('Cancelada', 'administrador'))
        self.assertEqual(db.session.get(SolicitudServicio, pasada).estado, 'Aceptada')
        [aviso] = self.avisos(21, 'matricula')
        self.assertIn(motivo, aviso.mensaje)
        self.assertEqual(len(self.avisos(11, 'cancelada')) + len(self.avisos(12, 'cancelada')), 2)
        # El correo al enfermero no repite el motivo.
        correos = {llamada.args[0].id: llamada.args[2] for llamada in self.enviar_aviso.call_args_list}
        self.assertEqual(set(correos), {21, 11, 12})
        self.assertNotIn(motivo, correos[21])
        registro = AuditoriaAdmin.query.one()
        self.assertEqual(registro.accion, 'rechazar_matricula')
        self.assertIn('turnos cancelados: 2', registro.detalle)

    def test_repetir_la_misma_decision_no_vuelve_a_avisar_ni_auditar(self):
        self.assertEqual(self.revisar(202, verificado=True).status_code, 200)
        otra = self.revisar(202, verificado=True)
        self.assertEqual(otra.status_code, 200)
        self.assertEqual(otra.json['enfermero']['estadoVerificacion'], 'verificada')
        motivo = 'La matrícula no coincide con el registro provincial.'
        self.assertEqual(self.revisar(201, verificado=False, motivo=motivo).status_code, 200)
        self.assertEqual(self.revisar(201, verificado=False, motivo=f' {motivo} ').status_code, 200)
        self.assertEqual(len(self.avisos(22, 'matricula')), 1)
        self.assertEqual(len(self.avisos(21, 'matricula')), 1)
        self.assertEqual(AuditoriaAdmin.query.count(), 2)
        self.assertEqual(self.enviar_aviso.call_count, 2)
        # Otro motivo sí es un cambio: se avisa con el texto nuevo.
        self.assertEqual(self.revisar(201, verificado=False, motivo='Falta la foto de la credencial.').status_code, 200)
        self.assertEqual(len(self.avisos(21, 'matricula')), 2)

    def test_guardar_el_perfil_con_la_matricula_rechazada_pide_otra_revision(self):
        motivo = 'La especialidad declarada no coincide con la matrícula.'
        self.assertEqual(self.revisar(201, verificado=False, motivo=motivo).status_code, 200)
        self.assertNotIn(201, [e['idEnfermero'] for e in self.client.get(
            '/api/admin/enfermeros/pendientes', headers=self.admin()).json['enfermeros']])
        # Corrige solo la especialidad, como le pide el aviso.
        respuesta = self.client.put('/api/perfil/enfermero', headers=self.headers(21),
                                    json={'especialidad': 'Cuidados paliativos'})
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['estadoVerificacion'], 'pendiente')
        self.assertEqual(respuesta.json['motivoRechazo'], motivo)
        pendientes = self.client.get('/api/admin/enfermeros/pendientes', headers=self.admin()).json['enfermeros']
        self.assertIn(201, [e['idEnfermero'] for e in pendientes])

    def test_motivo_largo_se_recorta_en_el_aviso_pero_no_en_el_perfil(self):
        motivo = 'Falta la foto del dorso de la credencial. ' * 7
        self.assertEqual(self.revisar(202, verificado=False, motivo=motivo[:300]).status_code, 200)
        [aviso] = self.avisos(22, 'matricula')
        self.assertLessEqual(len(aviso.mensaje), 255)
        self.assertIn('…', aviso.mensaje)
        self.assertEqual(db.session.get(Enfermero, 202).motivoRechazo, motivo[:300].strip())

    def test_el_enfermero_y_el_admin_ven_la_revision_pero_la_cartilla_no(self):
        self.revisar(202, verificado=False, motivo='La matrícula está vencida.')
        propio = self.client.get('/api/perfil/enfermero', headers=self.headers(22)).json
        self.assertEqual((propio['estadoVerificacion'], propio['motivoRechazo'], propio['verificadoPor']),
                         ('rechazada', 'La matrícula está vencida.', 1))
        usuarios = self.client.get('/api/admin/usuarios?rol=enfermero', headers=self.admin()).json['usuarios']
        pedro = next(u for u in usuarios if u['id'] == 22)
        self.assertEqual((pedro['matricula'], pedro['estadoVerificacion'], pedro['motivoRechazo']),
                         ('MAT-2', 'rechazada', 'La matrícula está vencida.'))
        publico = self.client.get('/api/enfermeros').json
        self.assertTrue(publico)
        for campo in ('estadoVerificacion', 'motivoRechazo', 'verificadoEn', 'verificadoPor'):
            self.assertNotIn(campo, publico[0])
        visto_por_paciente = self.client.get('/api/usuarios/21', headers=self.headers(11)).json
        self.assertNotIn('verificadoPor', visto_por_paciente)

    def test_cuenta_eliminada_no_se_revisa(self):
        db.session.get(Usuario, 22).eliminado = True
        db.session.commit()
        self.assertEqual(self.revisar(202, verificado=True).status_code, 409)


class IdentidadTest(BaseModeracionTest):
    def editar(self, usuario=21, **datos):
        return self.client.put('/api/perfil/enfermero', headers=self.headers(usuario), json=datos)

    def test_cambiar_nombre_o_apellido_vuelve_a_pendiente(self):
        for datos in ({'nombre': 'Lorena'}, {'apellido': 'Fernández'}):
            with self.subTest(datos=datos):
                enfermero = db.session.get(Enfermero, 201)
                enfermero.verificado = True
                db.session.commit()
                respuesta = self.editar(**datos)
                self.assertEqual(respuesta.status_code, 200)
                self.assertEqual(respuesta.json['estadoVerificacion'], 'pendiente')
                self.assertFalse(db.session.get(Enfermero, 201).verificado)
        pendientes = self.client.get('/api/admin/enfermeros/pendientes', headers=self.admin()).json['enfermeros']
        self.assertIn(201, [e['idEnfermero'] for e in pendientes])

    def test_mayusculas_espacios_u_otros_campos_no_cambian_la_identidad(self):
        respuesta = self.editar(nombre='  LAURA ', apellido='gómez', matricula='MAT-1', ciudad='Godoy Cruz')
        self.assertEqual(respuesta.status_code, 200)
        self.assertTrue(db.session.get(Enfermero, 201).verificado)

    def test_un_rechazado_que_corrige_el_nombre_vuelve_a_revision(self):
        enfermero = db.session.get(Enfermero, 202)
        enfermero.matricula_rechazada = True
        db.session.commit()
        self.assertEqual(self.editar(usuario=22, nombre='Pedro José').json['estadoVerificacion'], 'pendiente')


class AuditoriaYPermisosTest(BaseModeracionTest):
    def suspender(self, usuario, suspendido=True, headers=None):
        with patch('routes.admin_routes.ahora_local', return_value=datetime(2030, 1, 10, 10, 0)):
            return self.client.put(f'/api/admin/usuarios/{usuario}/suspension', headers=headers or self.admin(),
                                   json={'suspendido': suspendido})

    def test_registra_suspender_y_reactivar_y_lista_lo_mas_reciente_primero(self):
        self.guardar()
        self.assertEqual(self.suspender(21).status_code, 200)
        self.assertEqual(self.suspender(21, False).status_code, 200)
        self.assertEqual(self.suspender(21, False).status_code, 200)  # Sin cambio: no se registra.
        with patch('routes.admin_routes.ahora_local', return_value=datetime(2030, 1, 10, 10, 0)):
            self.client.put('/api/admin/usuarios/11/estado', headers=self.admin(), json={'estado': 'Suspendido'})
        respuesta = self.client.get('/api/admin/auditoria?per_page=2', headers=self.admin())
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual((respuesta.json['total_resultados'], respuesta.json['total_paginas']), (3, 2))
        registros = respuesta.json['registros']
        self.assertEqual([r['accion'] for r in registros], ['suspender_usuario', 'reactivar_usuario'])
        self.assertEqual((registros[0]['idObjetivo'], registros[0]['adminEmail']), (11, 'admin@test.local'))
        segunda = self.client.get('/api/admin/auditoria?per_page=2&page=2', headers=self.admin()).json
        self.assertEqual(segunda['registros'][0]['detalle'], 'Cuenta de enfermero; turnos cancelados: 1')
        self.assertTrue(segunda['registros'][0]['fecha'].endswith('Z'))
        filtrada = self.client.get('/api/admin/auditoria?accion=reactivar_usuario', headers=self.admin()).json
        self.assertEqual(filtrada['total_resultados'], 1)
        self.assertNotIn('Diabetes', respuesta.get_data(as_text=True))

    def test_auditoria_valida_y_es_solo_para_administradores(self):
        self.assertEqual(self.client.get('/api/admin/auditoria?accion=otra', headers=self.admin()).status_code, 400)
        self.assertEqual(self.client.get('/api/admin/auditoria?page=x', headers=self.admin()).status_code, 400)
        self.assertEqual(self.client.get('/api/admin/auditoria', headers=self.headers(11)).status_code, 403)

    def test_solo_permiso_total_suspende_a_otro_administrador(self):
        moderador = self.admin(2, 'moderador')
        respuesta = self.suspender(1, headers=moderador)
        self.assertEqual(respuesta.status_code, 403)
        self.assertIn('permiso total', respuesta.json['error'])
        self.assertFalse(db.session.get(Usuario, 1).suspendido)
        self.assertEqual(self.suspender(11, headers=moderador).status_code, 200)
        self.assertEqual(self.suspender(2).status_code, 200)
        self.assertTrue(db.session.get(Usuario, 2).suspendido)
        self.assertEqual([r.idAdmin for r in AuditoriaAdmin.query.order_by(AuditoriaAdmin.idAuditoria)], [2, 1])


class ModeracionResenasTest(BaseModeracionTest):
    def setUp(self):
        super().setUp()
        self.resenas = []
        for paciente, autor, estrellas in ((101, 11, 5), (102, 12, 1)):
            solicitud = self.guardar('Realizada', paciente=paciente, fecha=date(2026, 1, 10))
            calificacion = Calificacion(idSolicitud=solicitud, idUsuarioAutor=autor, idUsuarioCalificado=21,
                                        estrellas=estrellas, comentario=f'Comentario {estrellas}')
            db.session.add(calificacion)
            db.session.commit()
            self.resenas.append(calificacion.idCalificacion)
        enfermero = db.session.get(Enfermero, 201)
        enfermero.calificacionPromedio, enfermero.cantidadResenas = 3.0, 2
        db.session.commit()

    def denunciar(self, resena, usuario=21, motivo='Este paciente nunca fue atendido por mí.'):
        return self.client.post(f'/api/resenas/{resena}/denunciar', headers=self.headers(usuario),
                                json={'motivo': motivo})

    def visibilidad(self, resena, **datos):
        return self.client.put(f'/api/admin/resenas/{resena}/visibilidad', headers=self.admin(), json=datos)

    def test_solo_el_enfermero_calificado_denuncia_con_motivo(self):
        mala = self.resenas[1]
        self.assertEqual(self.denunciar(mala, usuario=11).status_code, 403)
        self.assertEqual(self.denunciar(mala, usuario=22).status_code, 403)
        self.assertEqual(self.denunciar(mala, motivo='mal').status_code, 400)
        self.assertEqual(self.denunciar(9999).status_code, 404)
        respuesta = self.denunciar(mala)
        self.assertEqual(respuesta.status_code, 200)
        self.assertTrue(respuesta.json['denunciada'])
        self.assertEqual(self.denunciar(mala).status_code, 409)
        propias = self.client.get('/api/enfermeros/201/resenas', headers=self.headers(21)).json['resenas']
        self.assertEqual({r['idResena']: r['denunciada'] for r in propias}, {mala: True, self.resenas[0]: False})
        ajenas = self.client.get('/api/enfermeros/201/resenas', headers=self.headers(11)).json['resenas']
        self.assertNotIn('denunciada', ajenas[0])

    def test_listado_admin_filtra_y_pone_primero_las_denunciadas(self):
        self.denunciar(self.resenas[0], motivo='Es una reseña de otra persona.')
        todas = self.client.get('/api/admin/resenas', headers=self.admin()).json
        self.assertEqual([r['idResena'] for r in todas['resenas']], self.resenas)
        self.assertEqual((todas['total_resultados'], todas['denunciadas_pendientes']), (2, 1))
        primera = todas['resenas'][0]
        self.assertEqual((primera['denunciaPendiente'], primera['motivoDenuncia'], primera['enfermero']['idEnfermero']),
                         (True, 'Es una reseña de otra persona.', 201))
        self.assertEqual(primera['paciente'], 'Ana P.')
        self.assertNotIn('ana@test.local', self.client.get('/api/admin/resenas', headers=self.admin()).get_data(as_text=True))
        denunciadas = self.client.get('/api/admin/resenas?filtro=denunciadas', headers=self.admin()).json
        self.assertEqual(denunciadas['total_resultados'], 1)
        self.assertEqual(self.client.get('/api/admin/resenas?filtro=ocultas', headers=self.admin()).json['resenas'], [])
        self.assertEqual(self.client.get('/api/admin/resenas?filtro=otras', headers=self.admin()).status_code, 400)
        self.assertEqual(self.client.get('/api/admin/resenas', headers=self.headers(21)).status_code, 403)

    def test_ocultar_saca_la_resena_del_perfil_y_del_promedio(self):
        mala = self.resenas[1]
        self.denunciar(mala)
        self.assertEqual(self.visibilidad(mala, oculta=True).status_code, 400)
        self.assertEqual(self.visibilidad(mala, oculta='si', motivo='Insulta al profesional').status_code, 400)
        respuesta = self.visibilidad(mala, oculta=True, motivo='Insulta al profesional')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual((respuesta.json['calificacionPromedio'], respuesta.json['cantidadResenas']), (5.0, 1))
        self.assertTrue(respuesta.json['resena']['oculta'])
        self.assertFalse(respuesta.json['resena']['denunciaPendiente'])
        publico = self.client.get('/api/enfermeros/201/resenas', headers=self.headers(12)).json
        self.assertEqual([r['idResena'] for r in publico['resenas']], [self.resenas[0]])
        self.assertEqual(publico['cantidadResenas'], 1)
        self.assertEqual(self.denunciar(mala).status_code, 404)
        ocultas = self.client.get('/api/admin/resenas?filtro=ocultas', headers=self.admin()).json['resenas']
        self.assertEqual(ocultas[0]['motivoOcultamiento'], 'Insulta al profesional')

        mostrar = self.visibilidad(mala, oculta=False)
        self.assertEqual(mostrar.status_code, 200)
        self.assertEqual(mostrar.json['calificacionPromedio'], 3.0)
        self.assertIsNone(mostrar.json['resena']['motivoOcultamiento'])
        acciones = [r.accion for r in AuditoriaAdmin.query.order_by(AuditoriaAdmin.idAuditoria)]
        self.assertEqual(acciones, ['ocultar_resena', 'mostrar_resena'])
        self.assertNotIn('Comentario', AuditoriaAdmin.query.first().detalle)
        self.assertEqual(self.visibilidad(9999, oculta=False).status_code, 404)

    def test_metricas_suman_estados_y_denuncias_sin_perder_campos(self):
        self.guardar('Pendiente', hora=time(9))
        self.denunciar(self.resenas[1])
        metricas = self.client.get('/api/admin/metricas', headers=self.admin()).json
        self.assertEqual(metricas['solicitudes_por_estado']['Realizada'], 2)
        self.assertEqual(metricas['solicitudes_por_estado']['Pendiente'], 1)
        self.assertEqual(metricas['solicitudes_por_estado']['Vencida'], 0)
        self.assertEqual((metricas['resenas_denunciadas'], metricas['resenasDenunciadas']), (1, 1))
        for campo in ('total_usuarios', 'usuarios_activos', 'matriculas_pendientes', 'total_solicitudes',
                      'servicios_realizados', 'servicios_catalogo'):
            self.assertIn(campo, metricas)
        self.visibilidad(self.resenas[1], oculta=False)
        self.assertEqual(self.client.get('/api/admin/resumen', headers=self.admin()).json['resenas_denunciadas'], 0)


class MigracionModeracionTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
        self.app.logger.disabled = True
        db.init_app(self.app)
        self.context = self.app.app_context()
        self.context.push()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_agrega_columnas_de_revision_y_moderacion_sin_tocar_datos(self):
        with db.engine.begin() as connection:
            connection.execute(text(
                'CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, '
                'password_hash VARCHAR(255) NOT NULL, rol VARCHAR(50) NOT NULL, '
                'suspendido BOOLEAN NOT NULL DEFAULT 0, nivelPermiso VARCHAR(30), '
                'versionTerminos VARCHAR(10), aceptoTerminosEn DATETIME)'
            ))
            connection.execute(text(
                'CREATE TABLE enfermeros (id INTEGER PRIMARY KEY, usuario_id INTEGER NOT NULL UNIQUE, '
                'nombre VARCHAR(100), matricula VARCHAR(50) NOT NULL, verificado BOOLEAN NOT NULL DEFAULT 1, '
                'matricula_rechazada BOOLEAN NOT NULL DEFAULT 0)'
            ))
            connection.execute(text(
                'CREATE TABLE calificaciones_servicio (idCalificacion INTEGER PRIMARY KEY, idSolicitud INTEGER, '
                'idUsuarioAutor INTEGER, idUsuarioCalificado INTEGER, estrellas INTEGER, comentario TEXT)'
            ))
            connection.execute(text("INSERT INTO enfermeros (id, usuario_id, nombre, matricula) "
                                    "VALUES (1, 21, 'Laura', 'MAT-1')"))
            connection.execute(text("INSERT INTO calificaciones_servicio VALUES (1, 1, 11, 21, 4, 'Muy bien')"))
        inicializar_bd_sprint7()
        inicializar_bd_sprint7()  # Idempotente.
        inspector = inspect(db.engine)
        self.assertTrue({'verificadoPor', 'verificadoEn', 'motivoRechazo'} <= {
            c['name'] for c in inspector.get_columns('enfermeros')})
        self.assertTrue({'oculta', 'motivoOcultamiento', 'denunciada', 'motivoDenuncia', 'denunciaRevisada'} <= {
            c['name'] for c in inspector.get_columns('calificaciones_servicio')})
        self.assertTrue(inspector.has_table('auditoria_admin'))
        with db.engine.connect() as connection:
            fila = connection.execute(text(
                'SELECT c.oculta, c.denunciada, c.comentario, e.verificado, e.motivoRechazo '
                'FROM calificaciones_servicio c JOIN enfermeros e ON e.usuario_id = c.idUsuarioCalificado'
            )).one()
        self.assertEqual((bool(fila[0]), bool(fila[1]), fila[2], bool(fila[3]), fila[4]),
                         (False, False, 'Muy bien', True, None))


if __name__ == '__main__':
    unittest.main()
