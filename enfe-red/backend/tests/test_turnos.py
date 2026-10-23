"""Turnos: duración, agenda del enfermero, vencimiento, cancelación, reprogramación, avisos y suspensión."""
import unittest
from datetime import date, datetime, time
from decimal import Decimal
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token
from sqlalchemy import inspect, text
from sqlalchemy.exc import SQLAlchemyError

from cli_admin import registrar_comandos
from database import db
from extensions import bcrypt
from models.mensaje_models import Mensaje
from models.notificacion_models import Notificacion
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Disponibilidad, Enfermero, Paciente, Usuario
from routes.admin_routes import admin_bp
from routes.comunicacion_routes import comunicacion_bp
from routes.notificacion_routes import notificacion_bp
from routes.solicitud_routes import solicitud_bp
from routes.usuario_routes import usuario_bp
from schema_mejoras import inicializar_bd_mejoras
from services.turnos import fecha_maxima


def crear_app():
    app = Flask(__name__)
    app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:', BCRYPT_LOG_ROUNDS=4,
                      JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
    app.logger.disabled = True
    db.init_app(app)
    bcrypt.init_app(app)
    JWTManager(app)
    for blueprint in (usuario_bp, solicitud_bp, notificacion_bp, comunicacion_bp, admin_bp):
        app.register_blueprint(blueprint, url_prefix='/api')
    registrar_comandos(app)
    return app


class BaseTurnosTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app()
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=1, email='admin@test.local', password_hash='x', rol='administrador', nivelPermiso='total'),
            Usuario(id=11, email='ana@test.local', password_hash='x', rol='paciente'),
            Usuario(id=12, email='otro@test.local', password_hash='x', rol='paciente'),
            Usuario(id=21, email='laura@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=22, email='pedro@test.local', password_hash='x', rol='enfermero'),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana', apellido='Pérez', historial_medico='Diabetes'),
            Paciente(id=102, usuario_id=12, nombre='Otro'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', apellido='Gómez', matricula='MAT-1',
                      verificado=True, disponible=True),
            Enfermero(id=202, usuario_id=22, nombre='Pedro', matricula='MAT-2', verificado=True, disponible=True),
            Servicio(idServicio=301, tipoServicio='Curaciones', precioEstimado=Decimal('8000')),
            Servicio(idServicio=302, tipoServicio='Acompañamiento', precioEstimado=Decimal('9000'),
                     duracionMinutos=90),
        ])
        db.session.commit()
        self.client = self.app.test_client()
        # Jueves 10/01/2030 a las 10:00; los turnos de prueba son el viernes 11/01.
        self.reloj = patch('routes.solicitud_routes._ahora_local', return_value=datetime(2030, 1, 10, 10, 0))
        self.ahora = self.reloj.start()
        self.addCleanup(self.reloj.stop)
        self.correo = patch('services.turnos.enviar_aviso')
        self.enviar_aviso = self.correo.start()
        self.addCleanup(self.correo.stop)

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def headers(self, usuario=11, **claims):
        return {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario), additional_claims=claims)}

    def crear(self, usuario=11, **cambios):
        datos = dict(idEnfermero=201, idServicio=301, fecha='2030-01-11', hora='14:30',
                     direccionAtencion='San Martín 123')
        datos.update(cambios)
        return self.client.post('/api/solicitudes', headers=self.headers(usuario), json=datos)

    def guardar(self, estado='Pendiente', paciente=101, enfermero=201, fecha=date(2030, 1, 11),
                hora=time(14, 30), servicio=301):
        solicitud = SolicitudServicio(idPaciente=paciente, idEnfermero=enfermero, idServicio=servicio,
                                      fecha=fecha, hora=hora, estado=estado, direccionAtencion='San Martín 123')
        db.session.add(solicitud)
        db.session.commit()
        return solicitud.idSolicitud

    def put(self, id_solicitud, accion, usuario, **datos):
        return self.client.put(f'/api/solicitudes/{id_solicitud}/{accion}', headers=self.headers(usuario),
                               json=datos or None)

    def avisos(self, usuario, tipo=None):
        consulta = Notificacion.query.filter_by(idUsuario=usuario)
        if tipo:
            consulta = consulta.filter_by(tipo=tipo)
        return consulta.order_by(Notificacion.idNotificacion).all()

    def horario(self, dia='Viernes', inicio=time(8), fin=time(12), estado='Disponible', enfermero=201):
        db.session.add(Disponibilidad(enfermero_id=enfermero, dia_semana=dia, hora_inicio=inicio,
                                      hora_fin=fin, estado=estado))
        db.session.commit()


class DuracionYAgendaTest(BaseTurnosTest):
    def test_la_duracion_del_servicio_detecta_superposiciones_reales(self):
        self.guardar('Aceptada', paciente=102, servicio=302)  # 14:30 a 16:00
        for hora in ('13:45', '15:30', '15:59'):
            with self.subTest(hora=hora):
                respuesta = self.crear(hora=hora)
                self.assertEqual(respuesta.status_code, 409)
                self.assertIn('ya tiene confirmado', respuesta.json['error'])
        for hora in ('13:30', '16:00'):
            with self.subTest(hora=hora):
                self.assertEqual(self.crear(hora=hora).status_code, 201)
        detalle = self.crear(hora='18:00', idServicio=302).json['solicitud']
        self.assertEqual((detalle['horaFin'], detalle['servicio']['duracionMinutos']), ('19:30', 90))

    def test_aceptar_rechaza_un_turno_que_se_pisa_con_otro_aceptado(self):
        primero = self.guardar(servicio=302)
        segundo = self.guardar(paciente=102, hora=time(15, 45))
        self.assertEqual(self.put(primero, 'aceptar', 21).status_code, 200)
        respuesta = self.put(segundo, 'aceptar', 21)
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn('11/01 a las 14:30', respuesta.json['error'])
        self.assertEqual(db.session.get(SolicitudServicio, segundo).estado, 'Pendiente')

    def test_el_mismo_paciente_no_duplica_un_pedido_pendiente(self):
        self.assertEqual(self.crear().status_code, 201)
        respuesta = self.crear(hora='15:00')
        self.assertEqual(respuesta.status_code, 409)
        self.assertIn('Ya tenés una solicitud', respuesta.json['error'])
        # Otro paciente sí puede pedir el mismo horario: el Pendiente no reserva.
        self.assertEqual(self.crear(usuario=12).status_code, 201)

    def test_sin_horarios_cargados_se_permite_cualquier_horario(self):
        self.assertEqual(self.crear(hora='23:00').status_code, 201)

    def test_el_turno_tiene_que_entrar_entero_en_una_franja_del_dia(self):
        self.horario(inicio=time(8), fin=time(12))
        self.horario(inicio=time(14), fin=time(18))
        self.horario(dia='Sábado', inicio=time(8), fin=time(20), estado='En Pausa / No disponible')
        self.assertEqual(self.crear(hora='08:00').status_code, 201)
        self.assertEqual(self.crear(hora='17:00').status_code, 201)
        afuera = self.crear(hora='11:30')
        self.assertEqual(afuera.status_code, 409)
        self.assertEqual(
            afuera.json['error'],
            'Ese horario está fuera de la agenda de Laura Gómez. Los viernes atiende de 08:00 a 12:00 y '
            'de 14:00 a 18:00. El turno dura 1 hora y tiene que terminar dentro de ese horario.',
        )
        sabado = self.crear(fecha='2030-01-12', hora='09:00')
        self.assertEqual(sabado.status_code, 409)
        self.assertIn('no atiende los sábados', sabado.json['error'])

    def test_franjas_pegadas_cuentan_como_una_sola(self):
        self.horario(inicio=time(8), fin=time(12))
        self.horario(inicio=time(12), fin=time(16))
        # De 11:30 a 12:30: cruza el borde entre las dos franjas, pero no hay ningún corte.
        self.assertEqual(self.crear(hora='11:30').status_code, 201)
        afuera = self.crear(hora='15:30')
        self.assertEqual(afuera.status_code, 409)
        self.assertIn('Los viernes atiende de 08:00 a 16:00.', afuera.json['error'])

    def test_franja_hasta_las_23_59_llega_hasta_la_medianoche(self):
        self.horario(inicio=time(20), fin=time(23, 59))
        self.assertEqual(self.crear(hora='23:00').status_code, 201)

    def test_con_todos_los_horarios_en_pausa_se_permite_cualquier_horario(self):
        # Igual que en el perfil y en "Solicitar servicio": sin franjas disponibles no hay agenda que cumplir.
        self.horario(inicio=time(8), fin=time(12), estado='En Pausa / No disponible')
        self.horario(dia='Martes', inicio=time(8), fin=time(12), estado='Ocupado / Reservado')
        self.assertEqual(self.crear(hora='19:00').status_code, 201)

    def test_dias_guardados_sin_tilde_o_en_minuscula_tambien_cuentan(self):
        self.horario(dia='sabado', inicio=time(8), fin=time(12))
        self.assertEqual(self.crear(fecha='2030-01-12', hora='09:00').status_code, 201)

    def test_fecha_maxima_seis_meses(self):
        self.assertEqual(fecha_maxima(date(2030, 1, 10)), date(2030, 7, 10))
        self.assertEqual(fecha_maxima(date(2030, 8, 31)), date(2031, 2, 28))
        self.assertEqual(self.crear(fecha='2030-07-10').status_code, 201)
        lejos = self.crear(fecha='2030-07-11')
        self.assertEqual(lejos.status_code, 400)
        self.assertIn('hasta el 10/07/2030', lejos.json['error'])

    def test_maximo_cinco_pendientes_por_paciente(self):
        for hora in ('08:00', '09:00', '10:00', '11:00', '12:00'):
            self.assertEqual(self.crear(hora=hora).status_code, 201)
        sexta = self.crear(hora='13:00')
        self.assertEqual(sexta.status_code, 409)
        self.assertIn('5 solicitudes esperando respuesta', sexta.json['error'])
        # Las de otros pacientes y las ya respondidas no cuentan.
        self.assertEqual(self.crear(usuario=12, hora='13:00').status_code, 201)
        primera = SolicitudServicio.query.filter_by(idPaciente=101).first().idSolicitud
        self.assertEqual(self.put(primera, 'aceptar', 21).status_code, 200)
        self.assertEqual(self.crear(hora='16:00').status_code, 201)


class AceptarYVencerTest(BaseTurnosTest):
    def test_aceptar_exige_matricula_verificada_cuenta_activa_y_turno_futuro(self):
        id_solicitud = self.guardar()
        enfermero = db.session.get(Enfermero, 201)
        enfermero.verificado = False
        db.session.commit()
        sin_matricula = self.put(id_solicitud, 'aceptar', 21)
        self.assertEqual(sin_matricula.status_code, 409)
        self.assertIn('matrícula', sin_matricula.json['error'])
        enfermero.verificado = True
        db.session.get(Usuario, 21).suspendido = True
        db.session.commit()
        self.assertEqual(self.put(id_solicitud, 'aceptar', 21).status_code, 403)
        db.session.get(Usuario, 21).suspendido = False
        db.session.commit()
        self.ahora.return_value = datetime(2030, 1, 11, 14, 30)
        self.assertEqual(self.put(id_solicitud, 'aceptar', 21).status_code, 409)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')

    def test_aceptar_confirma_el_horario_que_vio_el_enfermero(self):
        id_solicitud = self.guardar()
        # El paciente la reprogramó mientras el enfermero tenía abierta la bandeja con el horario viejo.
        self.assertEqual(self.put(id_solicitud, 'reprogramar', 11, fecha='2030-01-12', hora='18:00').status_code, 200)
        vieja = self.put(id_solicitud, 'aceptar', 21, fecha='2030-01-11', hora='14:30')
        self.assertEqual(vieja.status_code, 409)
        self.assertIn('cambió el día o la hora', vieja.json['error'])
        self.assertEqual((vieja.json['solicitud']['fecha'], vieja.json['solicitud']['hora']), ('2030-01-12', '18:00'))
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).estado, 'Pendiente')
        self.assertEqual(self.put(id_solicitud, 'aceptar', 21, fecha='2030-01-12', hora='18:00').status_code, 200)

    def test_aceptar_sin_horario_en_el_pedido_sigue_funcionando(self):
        self.assertEqual(self.put(self.guardar(), 'aceptar', 21).status_code, 200)

    def test_las_pendientes_vencidas_se_cierran_al_consultar_y_avisan_una_vez(self):
        pendiente = self.guardar()
        aceptada = self.guardar('Aceptada', hora=time(16))
        self.ahora.return_value = datetime(2030, 1, 12, 9, 0)
        activas = self.client.get('/api/solicitudes/paciente/101', headers=self.headers()).json
        self.assertEqual([s['idSolicitud'] for s in activas], [aceptada])
        todas = self.client.get('/api/solicitudes/paciente/101?todas=1', headers=self.headers()).json
        self.assertEqual({s['idSolicitud']: s['estado'] for s in todas}, {pendiente: 'Vencida', aceptada: 'Aceptada'})
        self.client.get('/api/solicitudes/enfermero/201', headers=self.headers(21))
        [aviso] = self.avisos(11, 'vencida')
        self.assertEqual(aviso.idSolicitud, pendiente)
        self.assertIn('Laura Gómez no llegó a responderla a tiempo', aviso.mensaje)

    def test_el_detalle_y_el_comando_tambien_vencen(self):
        detalle = self.guardar()
        por_comando = self.guardar(paciente=102)
        self.ahora.return_value = datetime(2030, 1, 11, 14, 30)
        self.assertEqual(self.client.get(f'/api/solicitudes/{detalle}', headers=self.headers()).json['estado'],
                         'Vencida')
        with patch('cli_admin.ahora_local', return_value=datetime(2030, 1, 11, 14, 30)):
            resultado = self.app.test_cli_runner().invoke(args=['vencer-solicitudes'])
        self.assertEqual(resultado.exit_code, 0, resultado.output)
        self.assertIn('Solicitudes vencidas: 1.', resultado.output)
        self.assertEqual(db.session.get(SolicitudServicio, por_comando).estado, 'Vencida')
        self.assertEqual(len(self.avisos(12, 'vencida')), 1)


class CancelarYReprogramarTest(BaseTurnosTest):
    def test_paciente_cancela_antes_del_turno_con_motivo_opcional(self):
        id_solicitud = self.guardar('Aceptada')
        self.assertEqual(self.put(id_solicitud, 'cancelar', 11, motivo='x' * 201).status_code, 400)
        respuesta = self.put(id_solicitud, 'cancelar', 11, motivo='  Me internaron  ')
        self.assertEqual(respuesta.status_code, 200)
        solicitud = respuesta.json['solicitud']
        self.assertEqual((solicitud['canceladaPor'], solicitud['motivoCancelacion']), ('paciente', 'Me internaron'))
        [aviso] = self.avisos(21, 'cancelada')
        self.assertTrue(aviso.mensaje.endswith('Motivo: Me internaron'))
        # El correo al enfermero no repite el motivo (podría ser un dato de salud).
        usuario, asunto, texto = self.enviar_aviso.call_args.args
        self.assertEqual(usuario.id, 21)
        self.assertNotIn('internaron', texto)
        self.assertNotIn('Curaciones', texto)

        tarde = self.guardar('Aceptada', hora=time(9))
        self.ahora.return_value = datetime(2030, 1, 11, 9, 0)
        respuesta = self.put(tarde, 'cancelar', 11)
        self.assertEqual(respuesta.status_code, 409)
        self.assertEqual(db.session.get(SolicitudServicio, tarde).estado, 'Aceptada')

    def test_enfermero_cancela_un_turno_aceptado_futuro_con_motivo(self):
        aceptada = self.guardar('Aceptada')
        for datos in ({}, {'motivo': '   '}, {'motivo': 'nop'}, {'motivo': 'x' * 201}, {'motivo': 12345}):
            with self.subTest(datos=datos):
                self.assertEqual(self.put(aceptada, 'cancelar-enfermero', 21, **datos).status_code, 400)
        self.assertEqual(self.put(aceptada, 'cancelar-enfermero', 11, motivo='Me enfermé').status_code, 403)
        self.assertEqual(self.put(aceptada, 'cancelar-enfermero', 22, motivo='Me enfermé').status_code, 403)
        pendiente = self.guardar(hora=time(18))
        self.assertEqual(self.put(pendiente, 'cancelar-enfermero', 21, motivo='Me enfermé').status_code, 400)

        respuesta = self.put(aceptada, 'cancelar-enfermero', 21, motivo='Tengo un problema familiar')
        self.assertEqual(respuesta.status_code, 200, respuesta.json)
        solicitud = respuesta.json['solicitud']
        self.assertEqual((solicitud['estado'], solicitud['canceladaPor'], solicitud['motivoCancelacion']),
                         ('Cancelada', 'enfermero', 'Tengo un problema familiar'))
        [aviso] = self.avisos(11, 'cancelada')
        self.assertEqual(aviso.idSolicitud, aceptada)
        self.assertIn('Laura Gómez canceló tu turno', aviso.mensaje)
        self.assertIn('Tengo un problema familiar', aviso.mensaje)
        self.assertEqual(self.enviar_aviso.call_args.args[0].id, 11)

        pasada = self.guardar('Aceptada', hora=time(9))
        self.ahora.return_value = datetime(2030, 1, 11, 10, 0)
        self.assertEqual(self.put(pasada, 'cancelar-enfermero', 21, motivo='Me enfermé').status_code, 409)

    def test_reprogramar_vuelve_a_pendiente_y_avisa_al_enfermero(self):
        id_solicitud = self.guardar('Aceptada')
        respuesta = self.put(id_solicitud, 'reprogramar', 11, fecha='2030-01-12', hora='10:00')
        self.assertEqual(respuesta.status_code, 200, respuesta.json)
        solicitud = respuesta.json['solicitud']
        self.assertEqual((solicitud['fecha'], solicitud['hora'], solicitud['estado'], solicitud['contacto']),
                         ('2030-01-12', '10:00', 'Pendiente', None))
        [aviso] = self.avisos(21, 'reprogramada')
        self.assertEqual(aviso.idSolicitud, id_solicitud)
        self.assertIn('al 12/01 a las 10:00 (antes: 11/01 a las 14:30)', aviso.mensaje)
        # Una Pendiente también se puede mover.
        self.assertEqual(self.put(id_solicitud, 'reprogramar', 11, fecha='2030-01-12', hora='11:00').status_code, 200)

    def test_reprogramar_valida_igual_que_al_crear(self):
        id_solicitud = self.guardar()
        self.guardar('Aceptada', paciente=102, fecha=date(2030, 1, 12), hora=time(10))
        self.horario(dia='Sábado', inicio=time(8), fin=time(12))
        casos = [
            (12, {'fecha': '2030-01-12', 'hora': '08:00'}, 403),
            (21, {'fecha': '2030-01-12', 'hora': '08:00'}, 403),
            (11, {'fecha': '2030-01-11', 'hora': '14:30'}, 400),
            (11, {'fecha': '2030-01-09', 'hora': '08:00'}, 400),
            (11, {'fecha': '2030-12-01', 'hora': '08:00'}, 400),
            (11, {'fecha': '2030-01-12'}, 400),
            (11, {'fecha': '2030-01-12', 'hora': '08:00', 'estado': 'Aceptada'}, 400),
            (11, {'fecha': '2030-01-12', 'hora': '10:30'}, 409),  # Se pisa con un turno aceptado.
            (11, {'fecha': '2030-01-12', 'hora': '11:30'}, 409),  # Termina fuera de la franja.
        ]
        for usuario, datos, esperado in casos:
            with self.subTest(datos=datos, usuario=usuario):
                self.assertEqual(self.put(id_solicitud, 'reprogramar', usuario, **datos).status_code, esperado)
        self.assertEqual(db.session.get(SolicitudServicio, id_solicitud).fecha, date(2030, 1, 11))
        rechazada = self.guardar('Rechazada', hora=time(18))
        self.assertEqual(self.put(rechazada, 'reprogramar', 11, fecha='2030-01-12', hora='08:00').status_code, 400)
        self.ahora.return_value = datetime(2030, 1, 11, 15, 0)
        self.assertEqual(self.put(id_solicitud, 'reprogramar', 11, fecha='2030-01-12', hora='08:00').status_code, 409)


class NotificacionesTurnosTest(BaseTurnosTest):
    def test_crear_avisa_al_enfermero_por_la_campana_y_por_correo_sin_datos_de_salud(self):
        respuesta = self.crear()
        id_solicitud = respuesta.json['solicitud']['idSolicitud']
        [aviso] = self.avisos(21, 'nueva')
        self.assertEqual(aviso.idSolicitud, id_solicitud)
        self.assertEqual(aviso.mensaje, 'Ana Pérez te pidió un turno de Curaciones del 11/01 a las 14:30. '
                                        'Tocá para aceptarlo o rechazarlo.')
        usuario, asunto, texto = self.enviar_aviso.call_args.args
        self.assertEqual(usuario.id, 21)
        self.assertIn('el 11/01/2030 a las 14:30', texto)
        for privado in ('Curaciones', 'Diabetes', 'San Martín', 'Ana'):
            self.assertNotIn(privado, asunto + texto)

    def test_aceptar_manda_correo_y_finalizar_invita_a_calificar(self):
        id_solicitud = self.guardar()
        self.assertEqual(self.put(id_solicitud, 'aceptar', 21).status_code, 200)
        self.assertEqual(self.enviar_aviso.call_args.args[0].id, 11)
        self.ahora.return_value = datetime(2030, 1, 12, 9, 0)
        self.assertEqual(self.put(id_solicitud, 'finalizar', 21).status_code, 200)
        [aviso] = self.avisos(11, 'realizada')
        self.assertEqual(aviso.idSolicitud, id_solicitud)
        self.assertIn('calificar', aviso.mensaje)

    def test_un_correo_que_falla_no_revierte_el_cambio(self):
        self.enviar_aviso.side_effect = RuntimeError('sin red')
        self.assertEqual(self.crear().status_code, 201)
        self.assertEqual(SolicitudServicio.query.count(), 1)

    def test_leer_todas_marca_solo_las_propias(self):
        self.crear()
        self.crear(usuario=12, hora='16:00')
        id_ajena = self.guardar(paciente=102, hora=time(18))
        self.put(id_ajena, 'aceptar', 21)
        ruta = '/api/notificaciones/leer-todas'
        self.assertEqual(self.client.put(ruta).status_code, 401)
        respuesta = self.client.put(ruta, headers=self.headers(21))
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['actualizadas'], 2)
        self.assertTrue(all(aviso.leida for aviso in self.avisos(21)))
        self.assertFalse(any(aviso.leida for aviso in self.avisos(12)))
        self.assertEqual(self.client.put(ruta, headers=self.headers(21)).json['actualizadas'], 0)


class SuspensionTest(BaseTurnosTest):
    def admin(self):
        return self.headers(1, rol='administrador', nivelPermiso='total')

    def suspender(self, usuario, ruta='suspension', datos=None):
        with patch('routes.admin_routes.ahora_local', return_value=datetime(2030, 1, 10, 10, 0)):
            return self.client.put(f'/api/admin/usuarios/{usuario}/{ruta}', headers=self.admin(),
                                   json=datos or {'suspendido': True})

    def test_suspender_enfermero_cancela_sus_turnos_y_avisa_a_los_pacientes(self):
        pendiente = self.guardar()
        aceptada = self.guardar('Aceptada', paciente=102, hora=time(16))
        pasada = self.guardar('Aceptada', fecha=date(2030, 1, 9))
        otro = self.guardar(enfermero=202, hora=time(18))
        self.assertEqual(self.suspender(21).status_code, 200)
        db.session.expire_all()
        for id_solicitud in (pendiente, aceptada):
            solicitud = db.session.get(SolicitudServicio, id_solicitud)
            self.assertEqual((solicitud.estado, solicitud.canceladaPor, solicitud.motivoCancelacion),
                             ('Cancelada', 'administrador', 'El profesional no está disponible'))
        self.assertEqual(db.session.get(SolicitudServicio, pasada).estado, 'Aceptada')
        self.assertEqual(db.session.get(SolicitudServicio, otro).estado, 'Pendiente')
        self.assertEqual([a.idSolicitud for a in self.avisos(11, 'cancelada')], [pendiente])
        self.assertEqual([a.idSolicitud for a in self.avisos(12, 'cancelada')], [aceptada])
        self.assertEqual({llamada.args[0].id for llamada in self.enviar_aviso.call_args_list}, {11, 12})

    def test_suspender_paciente_por_estado_avisa_a_los_enfermeros(self):
        pendiente = self.guardar()
        self.assertEqual(self.suspender(11, 'estado', {'estado': 'Suspendido'}).status_code, 200)
        db.session.expire_all()
        self.assertEqual(db.session.get(SolicitudServicio, pendiente).motivoCancelacion,
                         'El paciente no está disponible')
        [aviso] = self.avisos(21, 'cancelada')
        self.assertIn('con Ana Pérez porque el paciente no está disponible', aviso.mensaje)

    def test_reactivar_no_toca_turnos_y_un_error_no_deja_nada_a_medias(self):
        pendiente = self.guardar()
        self.assertEqual(self.suspender(21, datos={'suspendido': False}).status_code, 200)
        self.assertEqual(db.session.get(SolicitudServicio, pendiente).estado, 'Pendiente')
        with patch.object(db.session(), 'commit', side_effect=SQLAlchemyError('falla')):
            self.assertEqual(self.suspender(21).status_code, 500)
        db.session.expire_all()
        self.assertFalse(db.session.get(Usuario, 21).suspendido)
        self.assertEqual(db.session.get(SolicitudServicio, pendiente).estado, 'Pendiente')
        self.assertEqual(Notificacion.query.count(), 0)


class HorariosYChatTest(BaseTurnosTest):
    def test_eliminar_horario_propio(self):
        self.horario()
        self.horario(enfermero=202)
        propio, ajeno = (h.id for h in Disponibilidad.query.order_by(Disponibilidad.id))
        ruta = '/api/perfil/enfermero/horarios/'
        self.assertEqual(self.client.delete(ruta + str(ajeno), headers=self.headers(21)).status_code, 404)
        self.assertEqual(self.client.delete(ruta + str(propio), headers=self.headers(11)).status_code, 404)
        self.assertEqual(self.client.delete(ruta + str(propio), headers=self.headers(21)).status_code, 200)
        self.assertEqual([h.id for h in Disponibilidad.query.all()], [ajeno])
        self.assertEqual(self.client.delete(ruta + str(propio), headers=self.headers(21)).status_code, 404)

    def test_error_de_horario_no_devuelve_lo_recibido(self):
        respuesta = self.client.post('/api/perfil/enfermero/horarios', headers=self.headers(21),
                                     json={'dia': 'Lunes', 'hora_inicio': '08:00', 'secreto': 'x'})
        self.assertEqual(respuesta.status_code, 400)
        self.assertEqual(respuesta.json, {'error': 'Completá el día, la hora de inicio y la hora de fin'})

    def test_chat_desde_trae_solo_los_mensajes_nuevos(self):
        id_solicitud = self.guardar('Aceptada')
        mensajes = [Mensaje(idSolicitud=id_solicitud, idEmisor=11, contenido=f'Hola {i}') for i in range(3)]
        db.session.add_all(mensajes)
        db.session.commit()
        ruta = f'/api/solicitudes/{id_solicitud}/mensajes'
        self.assertEqual(len(self.client.get(ruta, headers=self.headers()).json), 3)
        nuevos = self.client.get(f'{ruta}?desde={mensajes[0].idMensaje}', headers=self.headers(21)).json
        self.assertEqual([m['contenido'] for m in nuevos], ['Hola 1', 'Hola 2'])
        self.assertEqual(self.client.get(f'{ruta}?desde={mensajes[2].idMensaje}', headers=self.headers()).json, [])
        for valor in ('abc', '-1', '1.5', ''):
            with self.subTest(valor=valor):
                self.assertEqual(self.client.get(f'{ruta}?desde={valor}', headers=self.headers()).status_code, 400)


class MigracionTurnosTest(unittest.TestCase):
    def setUp(self):
        self.app = crear_app()
        self.context = self.app.app_context()
        self.context.push()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_agrega_duracion_y_datos_de_cancelacion_sin_tocar_datos(self):
        with db.engine.begin() as connection:
            connection.execute(text(
                'CREATE TABLE usuarios (id INTEGER PRIMARY KEY, email VARCHAR(120) NOT NULL UNIQUE, '
                'password_hash VARCHAR(255) NOT NULL, rol VARCHAR(50) NOT NULL, '
                'suspendido BOOLEAN NOT NULL DEFAULT 0, nivelPermiso VARCHAR(30), '
                'versionTerminos VARCHAR(10), aceptoTerminosEn DATETIME)'
            ))
            connection.execute(text(
                'CREATE TABLE servicios (idServicio INTEGER PRIMARY KEY, tipoServicio VARCHAR(100) NOT NULL, '
                'descripcion VARCHAR(255), precioEstimado NUMERIC(10, 2))'
            ))
            connection.execute(text(
                'CREATE TABLE solicitudes_servicio (idSolicitud INTEGER PRIMARY KEY, idPaciente INTEGER NOT NULL, '
                'idEnfermero INTEGER NOT NULL, idServicio INTEGER NOT NULL, fecha DATE NOT NULL, '
                "hora TIME NOT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente', "
                'direccionAtencion VARCHAR(200) NOT NULL)'
            ))
            connection.execute(text("INSERT INTO servicios (idServicio, tipoServicio) VALUES (1, 'Curaciones')"))
            connection.execute(text(
                'INSERT INTO solicitudes_servicio (idSolicitud, idPaciente, idEnfermero, idServicio, fecha, hora, '
                "estado, direccionAtencion) VALUES (1, 1, 1, 1, '2030-01-11', '14:30:00.000000', 'Cancelada', 'Calle 1')"
            ))
        inicializar_bd_mejoras()
        inicializar_bd_mejoras()  # Idempotente.
        inspector = inspect(db.engine)
        self.assertIn('duracionMinutos', {c['name'] for c in inspector.get_columns('servicios')})
        self.assertTrue({'canceladaPor', 'motivoCancelacion'} <= {
            c['name'] for c in inspector.get_columns('solicitudes_servicio')})
        with db.engine.connect() as connection:
            self.assertEqual(connection.execute(text('SELECT duracionMinutos FROM servicios')).scalar(), 60)
            fila = connection.execute(text(
                'SELECT estado, direccionAtencion, canceladaPor FROM solicitudes_servicio')).one()
        self.assertEqual(tuple(fila), ('Cancelada', 'Calle 1', None))


if __name__ == '__main__':
    unittest.main()
