"""Creación, consulta y gestión de solicitudes: SCRUM-56 a SCRUM-61."""

import math
import re
from datetime import date, datetime, time, timedelta

from flask import Blueprint, current_app, jsonify, request, url_for
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.notificacion_models import notificar
from models.servicio_models import Servicio
from models.solicitud_models import ESTADOS_ACTIVOS, MAX_MOTIVO_CANCELACION, SIN_UBICACION, SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario
from services.turnos import (
    MAX_PENDIENTES_POR_PACIENTE, MESES_MAXIMOS, ahora_local, enviar_correos, fecha_legible, fecha_maxima,
    fecha_para_correo, inicio_y_fin, nombre_completo, problema_de_horario, vencer_cargadas,
)


solicitud_bp = Blueprint('solicitud_bp', __name__)
CAMPOS_SOLICITUD = {
    'idPaciente', 'idEnfermero', 'idServicio', 'fecha', 'hora', 'direccionAtencion',
    'latitudAtencion', 'longitudAtencion',
}
NOTIFICACIONES_ESTADO = {'Aceptada': ('aceptada', 'aceptó'), 'Rechazada': ('rechazada', 'rechazó')}
MIN_MOTIVO_ENFERMERO = 5
MENSAJE_HORARIO_CAMBIADO = ('El paciente cambió el día o la hora de este turno. Revisá el horario nuevo '
                            'antes de aceptarlo.')


# Funciones auxiliares de este módulo.


def _usuario_actual():
    """El token identifica a Usuario, no al perfil de paciente o enfermero."""
    try:
        usuario_id = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None
    return db.session.get(Usuario, usuario_id)


def _id_valido(valor):
    # Excluir booleanos y respetar el rango de Integer en MySQL.
    return type(valor) is int and 0 < valor <= 2147483647


def _ahora_local():
    # Envoltorio propio: las pruebas fijan el reloj de este módulo.
    return ahora_local()


def _validar_fecha_hora(fecha_texto, hora_texto):
    """Fecha y hora futuras y dentro de los próximos meses, o ValueError con el mensaje."""
    if not isinstance(fecha_texto, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fecha_texto):
        raise ValueError('La fecha debe tener formato AAAA-MM-DD')
    if not isinstance(hora_texto, str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', hora_texto):
        raise ValueError('La hora debe tener formato HH:MM y estar entre 00:00 y 23:59')

    try:
        fecha = date.fromisoformat(fecha_texto)
        hora = time.fromisoformat(hora_texto)
    except ValueError as error:
        raise ValueError('La fecha o la hora no son válidas') from error
    ahora = _ahora_local()
    if datetime.combine(fecha, hora) <= ahora:
        raise ValueError('La fecha y hora deben ser futuras (hora de Argentina, UTC-3)')
    limite = fecha_maxima(ahora.date())
    if fecha > limite:
        raise ValueError(f'Podés pedir turnos hasta {MESES_MAXIMOS} meses adelante '
                         f'(hasta el {limite:%d/%m/%Y}). Elegí una fecha más cercana.')
    return fecha, hora


def _coordenada(valor, limite):
    """Número finito dentro del rango, o None (True/False no cuentan como número)."""
    if isinstance(valor, bool) or not isinstance(valor, (int, float)):
        return None
    try:
        numero = float(valor)
    except OverflowError:
        # Un entero gigante en el JSON no entra en un float.
        return None
    return numero if math.isfinite(numero) and abs(numero) <= limite else None


def _validar_datos_solicitud(datos):
    """Normalizar el JSON o lanzar ValueError con el mensaje para el paciente."""
    if not isinstance(datos, dict):
        raise ValueError('Enviá un objeto JSON con los datos de la solicitud')
    if set(datos) - CAMPOS_SOLICITUD:
        raise ValueError('La solicitud contiene campos no admitidos')

    for campo in ('idEnfermero', 'idServicio'):
        if not _id_valido(datos.get(campo)):
            raise ValueError(f'{campo} debe ser un entero positivo')
    if 'idPaciente' in datos and not _id_valido(datos['idPaciente']):
        raise ValueError('idPaciente debe ser un entero positivo')

    direccion = datos.get('direccionAtencion')
    if not isinstance(direccion, str) or not 1 <= len(direccion.strip()) <= 200:
        raise ValueError('La dirección de atención es obligatoria (máximo 200 caracteres)')

    # El enfermero necesita el punto exacto para llegar: es obligatorio en cada pedido nuevo.
    latitud = _coordenada(datos.get('latitudAtencion'), 90)
    longitud = _coordenada(datos.get('longitudAtencion'), 180)
    if latitud is None or longitud is None:
        raise ValueError('Marcá en el mapa dónde vas a recibir la atención')

    fecha, hora = _validar_fecha_hora(datos.get('fecha'), datos.get('hora'))
    return {
        **datos,
        'fecha': fecha,
        'hora': hora,
        'direccionAtencion': direccion.strip(),
        'latitudAtencion': latitud,
        'longitudAtencion': longitud,
    }


def _consulta_con_resumen():
    """Cargar paciente, enfermero y servicio en la misma consulta SQL."""
    return SolicitudServicio.query.options(
        joinedload(SolicitudServicio.paciente),
        # El usuario del enfermero da el email de 'contacto' en las solicitudes aceptadas.
        joinedload(SolicitudServicio.enfermero).joinedload(Enfermero.usuario),
        joinedload(SolicitudServicio.servicio),
    )


def _bloquear_agenda(id_enfermero):
    """Serializar escrituras de turnos del mismo profesional en MySQL/InnoDB."""
    return Enfermero.query.filter_by(id=id_enfermero).populate_existing().with_for_update().first()


def _turno_superpuesto(id_enfermero, inicio, fin, id_paciente=None, excluir=None):
    """Primer turno que se pisa con [inicio, fin): Aceptado de cualquiera o activo del mismo paciente.

    Sin id_paciente solo cuentan los Aceptados (los Pendientes no reservan el horario).
    """
    consulta = SolicitudServicio.query.filter(
        SolicitudServicio.idEnfermero == id_enfermero,
        # Un turno de hasta 24 h que empezó el día anterior también puede pisarse.
        SolicitudServicio.fecha.between(inicio.date() - timedelta(days=1), fin.date()),
        SolicitudServicio.estado.in_(ESTADOS_ACTIVOS if id_paciente else ('Aceptada',)),
    )
    if excluir is not None:
        consulta = consulta.filter(SolicitudServicio.idSolicitud != excluir)
    # La lectura bloqueante ve el estado actual después de esperar la agenda.
    for otra in consulta.order_by(SolicitudServicio.fecha, SolicitudServicio.hora).with_for_update().all():
        if otra.estado != 'Aceptada' and otra.idPaciente != id_paciente:
            continue
        otro_inicio, otro_fin = inicio_y_fin(otra.fecha, otra.hora, otra.servicio)
        if otro_inicio < fin and inicio < otro_fin:
            return otra
    return None


def _problema_de_agenda(enfermero, servicio, fecha, hora, id_paciente, excluir=None):
    """Mensaje para el paciente si el turno no entra en la agenda; se llama con la agenda bloqueada."""
    inicio, fin = inicio_y_fin(fecha, hora, servicio)
    problema = problema_de_horario(enfermero, inicio, fin)
    if problema:
        return problema
    otra = _turno_superpuesto(enfermero.id, inicio, fin, id_paciente=id_paciente, excluir=excluir)
    if otra is None:
        return None
    if otra.idPaciente == id_paciente:
        return 'Ya tenés una solicitud con este profesional en ese horario. Revisala en Mis solicitudes.'
    return (f'Ese horario se superpone con otro turno que {nombre_completo(enfermero, "el profesional")} '
            'ya tiene confirmado. Elegí otro horario.')


def _problema_enfermero(enfermero):
    # HU10: una cuenta suspendida tampoco recibe pedidos nuevos ni turnos reprogramados.
    if (not enfermero.verificado or not enfermero.disponible
            or enfermero.usuario is None or enfermero.usuario.suspendido):
        return 'El enfermero no está habilitado para recibir solicitudes'
    return None


def _pendientes_del_paciente(id_paciente, excluir=None):
    """Pendientes vigentes del paciente; antes vence las que ya pasaron para no contarlas."""
    consulta = _consulta_con_resumen().filter(
        SolicitudServicio.idPaciente == id_paciente, SolicitudServicio.estado == 'Pendiente',
    )
    if excluir is not None:
        consulta = consulta.filter(SolicitudServicio.idSolicitud != excluir)
    pendientes = consulta.all()
    vencer_cargadas(pendientes, _ahora_local())
    return sum(1 for solicitud in pendientes if solicitud.estado == 'Pendiente')


MENSAJE_LIMITE_PENDIENTES = (
    f'Ya tenés {MAX_PENDIENTES_POR_PACIENTE} solicitudes esperando respuesta. Esperá a que te '
    'respondan o cancelá alguna antes de pedir otra.'
)


def _texto_turno(solicitud):
    servicio = solicitud.servicio.tipoServicio if solicitud.servicio else 'servicio'
    return f'{servicio} del {fecha_legible(solicitud.fecha)} a las {solicitud.hora:%H:%M}'


def _notificar_cambio_estado(solicitud, destino, rol, motivo):
    """SCRUM-64.2: avisar a la otra parte. Devuelve los correos para mandar después del commit."""
    paciente_usuario = solicitud.paciente.usuario
    enfermero_usuario = solicitud.enfermero.usuario
    enfermero = nombre_completo(solicitud.enfermero, 'El profesional')
    if destino in NOTIFICACIONES_ESTADO:
        tipo, verbo = NOTIFICACIONES_ESTADO[destino]
        notificar(
            solicitud.paciente.usuario_id,
            tipo,
            f'{enfermero} {verbo} tu solicitud de {_texto_turno(solicitud)}.',
            solicitud.idSolicitud,
        )
        if destino == 'Aceptada':
            return [(paciente_usuario, 'Aceptaron tu turno en Enfered',
                     f'{enfermero} aceptó tu turno para {fecha_para_correo(solicitud)}. '
                     'Entrá a Enfered para ver sus datos de contacto.')]
        return []
    if destino == 'Realizada':
        notificar(
            solicitud.paciente.usuario_id, 'realizada',
            f'{enfermero} confirmó que le llegó el pago y cerró la atención de {_texto_turno(solicitud)}. '
            'Contanos cómo te fue: tocá para calificar la atención.',
            solicitud.idSolicitud,
        )
        return []
    if destino == 'Cancelada':
        detalle = f' Motivo: {motivo}' if motivo else ''
        if rol == 'paciente':
            paciente = nombre_completo(solicitud.paciente, 'Tu paciente')
            notificar(solicitud.enfermero.usuario_id, 'cancelada',
                      f'{paciente} canceló el turno de {_texto_turno(solicitud)}.{detalle}',
                      solicitud.idSolicitud)
            destino_correo = enfermero_usuario
        else:
            notificar(solicitud.paciente.usuario_id, 'cancelada',
                      f'{enfermero} canceló tu turno de {_texto_turno(solicitud)}.{detalle}',
                      solicitud.idSolicitud)
            destino_correo = paciente_usuario
        # El motivo queda fuera del correo: es texto libre y podría tener datos de salud.
        return [(destino_correo, 'Se canceló un turno en Enfered',
                 f'Se canceló el turno de {fecha_para_correo(solicitud)}. '
                 'Entrá a Enfered para ver el detalle.')]
    return []


def _validar_motivo(datos, obligatorio):
    """Motivo de la cancelación sin espacios de más, None si no hay, o ValueError."""
    motivo = datos.get('motivo') if isinstance(datos, dict) else None
    if motivo is None and not obligatorio:
        return None
    if not isinstance(motivo, str):
        motivo = ''
    motivo = motivo.strip()
    if not motivo and not obligatorio:
        return None
    minimo = MIN_MOTIVO_ENFERMERO if obligatorio else 1
    if not minimo <= len(motivo) <= MAX_MOTIVO_CANCELACION:
        if obligatorio:
            raise ValueError('Contale al paciente por qué cancelás el turno '
                             f'(entre {MIN_MOTIVO_ENFERMERO} y {MAX_MOTIVO_CANCELACION} caracteres).')
        raise ValueError(f'El motivo puede tener hasta {MAX_MOTIVO_CANCELACION} caracteres.')
    return motivo


def _cambiar_estado_solicitud(id_solicitud, *, rol, origen, destino, accion, mensaje,
                              requiere_turno_pasado=False, requiere_turno_futuro=None,
                              motivo_obligatorio=None):
    """Validar titularidad y guardar una transición de estado de forma atómica.

    motivo_obligatorio: None no lee motivo; False lo acepta opcional; True lo exige.
    """
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    if usuario.rol != rol:
        return jsonify({'error': f'Solo un {rol} puede {accion} una solicitud'}), 403

    solicitud = _consulta_con_resumen().filter_by(idSolicitud=id_solicitud).first()
    if not solicitud:
        return jsonify({'error': 'Solicitud no encontrada'}), 404
    titular = solicitud.enfermero if rol == 'enfermero' else solicitud.paciente
    if titular.usuario_id != usuario.id:
        return jsonify({'error': f'Solo podés {accion} tus propias solicitudes'}), 403
    if solicitud.estado not in origen:
        return jsonify({'error': f'Solo se pueden {accion} solicitudes en estado {" o ".join(origen)}'}), 400
    inicio = datetime.combine(solicitud.fecha, solicitud.hora)
    if requiere_turno_pasado and inicio > _ahora_local():
        return jsonify({'error': 'Vas a poder confirmar el pago y cerrar la atención cuando llegue la fecha y hora del turno'}), 409
    if requiere_turno_futuro and inicio <= _ahora_local():
        return jsonify({'error': requiere_turno_futuro}), 409
    if destino == 'Aceptada':
        if usuario.suspendido:
            return jsonify({'error': 'Tu cuenta está suspendida y no puede aceptar solicitudes.'}), 403
        if not solicitud.enfermero.verificado:
            return jsonify({'error': 'Tu matrícula todavía no está verificada. Vas a poder aceptar '
                                     'solicitudes cuando el equipo de Enfered la revise.'}), 409
        # El enfermero acepta el horario que vio en pantalla: si el paciente lo reprogramó mientras
        # tanto, se le muestra el nuevo para que decida (fecha y hora son opcionales en el pedido).
        vistos = request.get_json(silent=True)
        if isinstance(vistos, dict) and (vistos.get('fecha') is not None or vistos.get('hora') is not None):
            if (vistos.get('fecha'), vistos.get('hora')) != (solicitud.fecha.isoformat(), f'{solicitud.hora:%H:%M}'):
                return jsonify({'error': MENSAJE_HORARIO_CAMBIADO, 'solicitud': solicitud.to_dict()}), 409
    motivo = None
    if motivo_obligatorio is not None:
        try:
            motivo = _validar_motivo(request.get_json(silent=True), motivo_obligatorio)
        except ValueError as error:
            return jsonify({'error': str(error)}), 400

    cambios = {'estado': destino}
    if destino == 'Cancelada':
        cambios.update(canceladaPor=rol, motivoCancelacion=motivo)
    if destino not in ESTADOS_ACTIVOS:
        # Cerrado el turno, el lugar de atención ya no hace falta: se borra.
        cambios.update(SIN_UBICACION)
    if destino == 'Realizada':
        cambios['pagoConfirmadoEn'] = _ahora_local()
    try:
        if not _bloquear_agenda(solicitud.idEnfermero):
            db.session.rollback()
            return jsonify({'error': 'Enfermero no encontrado'}), 404
        # Permitir gestionar pedidos anteriores a la validación de reservas,
        # pero nunca aceptar dos atenciones que se superpongan.
        if destino == 'Aceptada':
            fin = solicitud.hora_fin()
            otra = _turno_superpuesto(solicitud.idEnfermero, inicio, fin, excluir=id_solicitud)
            if otra is not None:
                db.session.rollback()
                return jsonify({'error': f'Ya aceptaste otro turno que se superpone con este horario '
                                         f'({otra.fecha:%d/%m} a las {otra.hora:%H:%M}). Rechazá esta '
                                         'solicitud o pedile al paciente que la reprograme.'}), 409
        actualizadas = SolicitudServicio.query.filter(
            SolicitudServicio.idSolicitud == id_solicitud,
            SolicitudServicio.idEnfermero == solicitud.idEnfermero,
            SolicitudServicio.idPaciente == solicitud.idPaciente,
            SolicitudServicio.estado.in_(origen),
            # Si el paciente la reprogramó entre la consulta y el cambio, no se acepta el horario nuevo a ciegas.
            SolicitudServicio.fecha == solicitud.fecha,
            SolicitudServicio.hora == solicitud.hora,
        ).update(cambios, synchronize_session=False)
        if actualizadas != 1:
            db.session.rollback()
            return jsonify({'error': 'La solicitud cambió. Volvé a consultarla.'}), 400
        # La alerta se guarda en la misma transacción que el cambio de estado.
        correos = _notificar_cambio_estado(solicitud, destino, rol, motivo)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo %s la solicitud de servicio', accion)
        return jsonify({'error': f'No se pudo {accion} la solicitud. Intentá nuevamente.'}), 500

    enviar_correos(correos)
    return jsonify({'mensaje': mensaje, 'solicitud': solicitud.to_dict()}), 200


@solicitud_bp.route('/servicios', methods=['GET'])
@jwt_required()
def listarServicios():
    """Catálogo vigente: lo usan crearSolicitud, el filtro de la cartilla y el perfil del enfermero.

    Lo que ofrece cada enfermero viene en su perfil (campo servicios). El administrador ve también
    los dados de baja en /api/admin/servicios.
    """
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    servicios = Servicio.query.filter(Servicio.activo.is_(True)).order_by(
        Servicio.tipoServicio, Servicio.idServicio).all()
    return jsonify([servicio.to_dict() for servicio in servicios]), 200


# SCRUM-56: creación de una solicitud.
@solicitud_bp.route('/solicitudes', methods=['POST'])
@jwt_required()
def crearSolicitud():
    """Crear un pedido Pendiente para el paciente de la sesión."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    if usuario.rol != 'paciente':
        return jsonify({'error': 'Solo un paciente puede crear una solicitud'}), 403
    paciente = Paciente.query.filter_by(usuario_id=usuario.id).first()
    if not paciente:
        return jsonify({'error': 'Perfil de paciente no encontrado'}), 404

    try:
        datos = _validar_datos_solicitud(request.get_json(silent=True))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    if 'idPaciente' in datos and datos['idPaciente'] != paciente.id:
        return jsonify({'error': 'No podés crear solicitudes para otro paciente'}), 403

    enfermero = db.session.get(Enfermero, datos['idEnfermero'])
    if not enfermero:
        return jsonify({'error': 'Enfermero no encontrado'}), 404
    if not enfermero.verificado:
        return jsonify({'error': 'El enfermero todavía no está verificado'}), 409
    if not enfermero.disponible:
        return jsonify({'error': 'El enfermero no está disponible para recibir solicitudes'}), 409
    if enfermero.usuario is None or enfermero.usuario.suspendido:
        # HU10: una cuenta suspendida no recibe nuevos pedidos.
        return jsonify({'error': 'El enfermero no está habilitado para recibir solicitudes'}), 409
    servicio = db.session.get(Servicio, datos['idServicio'])
    if not servicio:
        return jsonify({'error': 'Servicio no encontrado'}), 404
    if servicio.activo is False:
        return jsonify({'error': 'Ese servicio ya no se ofrece. Elegí otro del listado.'}), 409
    if not enfermero.ofrece_servicio(servicio):
        return jsonify({'error': 'Este profesional no ofrece ese servicio. Elegí uno de los que ofrece.'}), 409
    if _pendientes_del_paciente(paciente.id) >= MAX_PENDIENTES_POR_PACIENTE:
        return jsonify({'error': MENSAJE_LIMITE_PENDIENTES}), 409

    try:
        # Integración SCRUM-60/61: únicamente los pedidos activos ocupan el turno.
        enfermero = _bloquear_agenda(enfermero.id)
        if not enfermero:
            db.session.rollback()
            return jsonify({'error': 'Enfermero no encontrado'}), 404
        if _problema_enfermero(enfermero):
            db.session.rollback()
            return jsonify({'error': 'El enfermero no está habilitado para recibir solicitudes'}), 409
        problema = _problema_de_agenda(enfermero, servicio, datos['fecha'], datos['hora'], paciente.id)
        if problema:
            db.session.rollback()
            return jsonify({'error': problema}), 409
        solicitud = SolicitudServicio(
            paciente=paciente,
            enfermero=enfermero,
            servicio=servicio,
            fecha=datos['fecha'],
            hora=datos['hora'],
            direccionAtencion=datos['direccionAtencion'],
            latitudAtencion=datos['latitudAtencion'],
            longitudAtencion=datos['longitudAtencion'],
        )
        db.session.add(solicitud)
        db.session.flush()
        notificar(
            enfermero.usuario_id, 'nueva',
            f'{nombre_completo(paciente, "Un paciente")} te pidió un turno de {_texto_turno(solicitud)}. '
            'Tocá para aceptarlo o rechazarlo.',
            solicitud.idSolicitud,
        )
        correos = [(enfermero.usuario, 'Tenés una solicitud nueva en Enfered',
                    f'Recibiste una solicitud de turno para {fecha_para_correo(solicitud)}. '
                    'Entrá a Enfered para aceptarla o rechazarla.')]
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo crear la solicitud de servicio')
        return jsonify({'error': 'No se pudo guardar la solicitud. Intentá nuevamente.'}), 500
    enviar_correos(correos)
    return jsonify({'mensaje': 'Solicitud creada', 'solicitud': solicitud.to_dict()}), 201, {
        'Location': url_for('solicitud_bp.confirmarSolicitud', idSolicitud=solicitud.idSolicitud),
    }


# SCRUM-57: comprobante de la solicitud creada.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>', methods=['GET'])
@jwt_required()
def confirmarSolicitud(idSolicitud):
    """Consultar el comprobante; no acepta ni cambia el estado del pedido (salvo vencerlo)."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    solicitud = _consulta_con_resumen().filter_by(idSolicitud=idSolicitud).first()
    if not solicitud:
        return jsonify({'error': 'Solicitud no encontrada'}), 404
    es_paciente = usuario.rol == 'paciente' and solicitud.paciente.usuario_id == usuario.id
    es_enfermero = usuario.rol == 'enfermero' and solicitud.enfermero.usuario_id == usuario.id
    if not (es_paciente or es_enfermero):
        return jsonify({'error': 'No tenés acceso a esta solicitud'}), 403
    vencer_cargadas([solicitud], _ahora_local())
    return jsonify(solicitud.to_dict()), 200


# SCRUM-58: bandejas de paciente y enfermero.
@solicitud_bp.route('/solicitudes/paciente/<int:idPaciente>', methods=['GET'])
@jwt_required()
def consultarSolicitudesPaciente(idPaciente):
    """Listar los pedidos Pendiente o Aceptada del paciente autenticado.

    Con ?todas=1 incluye todos los estados, para la vista de estados (SCRUM-58.3).
    """
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    paciente = Paciente.query.filter_by(usuario_id=usuario.id).first()
    if usuario.rol != 'paciente' or not paciente or paciente.id != idPaciente:
        return jsonify({'error': 'Solo podés consultar tus propias solicitudes de paciente'}), 403
    consulta = _consulta_con_resumen().filter(SolicitudServicio.idPaciente == idPaciente)
    todas = request.args.get('todas') == '1'
    if not todas:
        consulta = consulta.filter(SolicitudServicio.estado.in_(ESTADOS_ACTIVOS))
    solicitudes = consulta.order_by(
        SolicitudServicio.fecha, SolicitudServicio.hora, SolicitudServicio.idSolicitud,
    ).all()
    # Vencimiento perezoso: las Pendientes cuyo turno ya pasó se cierran al consultarlas.
    vencer_cargadas(solicitudes, _ahora_local())
    if not todas:
        solicitudes = [solicitud for solicitud in solicitudes if solicitud.estado in ESTADOS_ACTIVOS]
    return jsonify([solicitud.to_dict() for solicitud in solicitudes]), 200


@solicitud_bp.route('/solicitudes/enfermero/<int:idEnfermero>', methods=['GET'])
@jwt_required()
def consultarSolicitudesEnfermero(idEnfermero):
    """Listar los pedidos recibidos por el enfermero autenticado, en todos sus estados."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    enfermero = Enfermero.query.filter_by(usuario_id=usuario.id).first()
    if usuario.rol != 'enfermero' or not enfermero or enfermero.id != idEnfermero:
        return jsonify({'error': 'Solo podés consultar tus propias solicitudes de enfermero'}), 403
    solicitudes = (
        _consulta_con_resumen()
        .filter_by(idEnfermero=idEnfermero)
        .order_by(SolicitudServicio.fecha, SolicitudServicio.hora, SolicitudServicio.idSolicitud)
        .all()
    )
    vencer_cargadas(solicitudes, _ahora_local())
    return jsonify([solicitud.to_dict() for solicitud in solicitudes]), 200


# SCRUM-59.1 (Pablo): aceptación por el enfermero asignado.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/aceptar', methods=['PUT'])
@jwt_required()
def aceptarSolicitud(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Pendiente',), destino='Aceptada',
        accion='aceptar', mensaje='Solicitud aceptada',
        requiere_turno_futuro='La fecha y hora de este turno ya pasaron, así que no se puede aceptar.',
    )


# SCRUM-59.2 (Pablo / HU8): finalizar la atención aceptada.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/finalizar', methods=['PUT'])
@jwt_required()
def marcarComoRealizado(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Aceptada',), destino='Realizada',
        # marcarComoRealizado() del diagrama: el enfermero lo hace al confirmar que le llegó el pago.
        accion='finalizar', mensaje='Pago confirmado: la atención quedó cerrada',
        # Una atención futura no puede estar realizada (y no se podría reseñar).
        requiere_turno_pasado=True,
    )


# SCRUM-60 (Pablo): rechazar libera la reserva de fecha y hora.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/rechazar', methods=['PUT'])
@jwt_required()
def rechazarSolicitud(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Pendiente',), destino='Rechazada',
        accion='rechazar', mensaje='Solicitud rechazada',
    )


# SCRUM-61 (Pablo): cancelar solamente los pedidos activos del propio paciente, antes del turno.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/cancelar', methods=['PUT'])
@jwt_required()
def cancelarSolicitud(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='paciente', origen=ESTADOS_ACTIVOS, destino='Cancelada',
        accion='cancelar', mensaje='Solicitud cancelada',
        requiere_turno_futuro='El turno ya empezó o ya pasó, así que no se puede cancelar.',
        motivo_obligatorio=False,
    )


@solicitud_bp.route('/solicitudes/<int:idSolicitud>/cancelar-enfermero', methods=['PUT'])
@jwt_required()
def cancelarSolicitudEnfermero(idSolicitud):
    """El enfermero cancela un turno ya aceptado y futuro, explicando el motivo al paciente."""
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Aceptada',), destino='Cancelada',
        accion='cancelar', mensaje='Turno cancelado',
        requiere_turno_futuro='El turno ya empezó o ya pasó, así que no se puede cancelar.',
        motivo_obligatorio=True,
    )


@solicitud_bp.route('/solicitudes/<int:idSolicitud>/pago-informado', methods=['PUT'])
@jwt_required()
def informarPago(idSolicitud):
    """El paciente avisa que ya pagó la atención (en mano o por transferencia: Enfered no cobra).

    No cierra la atención: la cierra el enfermero cuando confirma que le llegó el pago.
    """
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    if usuario.rol != 'paciente':
        return jsonify({'error': 'Solo el paciente puede avisar que pagó'}), 403
    solicitud = _consulta_con_resumen().filter_by(idSolicitud=idSolicitud).first()
    if not solicitud:
        return jsonify({'error': 'Solicitud no encontrada'}), 404
    if solicitud.paciente.usuario_id != usuario.id:
        return jsonify({'error': 'Solo podés avisar el pago de tus propias solicitudes'}), 403
    if solicitud.estado != 'Aceptada':
        return jsonify({'error': 'Solo se puede avisar el pago de un turno aceptado que todavía no se cerró'}), 409
    if datetime.combine(solicitud.fecha, solicitud.hora) > _ahora_local():
        return jsonify({'error': 'Vas a poder avisar que pagaste cuando llegue la fecha y hora del turno'}), 409
    if solicitud.pagoInformadoEn:
        # Ya estaba avisado: no se repite el aviso al enfermero.
        return jsonify({'mensaje': 'El pago ya estaba informado', 'solicitud': solicitud.to_dict()}), 200
    try:
        actualizadas = SolicitudServicio.query.filter(
            SolicitudServicio.idSolicitud == idSolicitud,
            SolicitudServicio.estado == 'Aceptada',
            SolicitudServicio.pagoInformadoEn.is_(None),
        ).update({'pagoInformadoEn': _ahora_local()}, synchronize_session=False)
        if actualizadas != 1:
            db.session.rollback()
            return jsonify({'error': 'La solicitud cambió de estado. Volvé a consultarla.'}), 409
        notificar(
            solicitud.enfermero.usuario_id, 'pago',
            f'{nombre_completo(solicitud.paciente, "Tu paciente")} avisó que ya te pagó el turno de '
            f'{_texto_turno(solicitud)}. Cuando te llegue, confirmalo para cerrar la atención.',
            idSolicitud,
        )
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo informar el pago')
        return jsonify({'error': 'No se pudo avisar el pago. Intentá nuevamente.'}), 500
    db.session.expire(solicitud)
    return jsonify({'mensaje': 'Pago informado', 'solicitud': solicitud.to_dict()}), 200


@solicitud_bp.route('/solicitudes/<int:idSolicitud>/ubicacion', methods=['PUT'])
@jwt_required()
def actualizarUbicacionAtencion(idSolicitud):
    """HU16: el paciente marca o cambia en el mapa el lugar de atención de un turno en curso.

    Sirve para los pedidos anteriores a la ubicación obligatoria y para corregir el punto.
    """
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    if usuario.rol != 'paciente':
        return jsonify({'error': 'Solo el paciente puede marcar el lugar de atención'}), 403
    solicitud = _consulta_con_resumen().filter_by(idSolicitud=idSolicitud).first()
    if not solicitud:
        return jsonify({'error': 'Solicitud no encontrada'}), 404
    if solicitud.paciente.usuario_id != usuario.id:
        return jsonify({'error': 'Solo podés marcar el lugar de tus propias solicitudes'}), 403
    if solicitud.estado not in ESTADOS_ACTIVOS:
        return jsonify({'error': 'Este turno ya se cerró, así que no hace falta marcar el lugar.'}), 409
    datos = request.get_json(silent=True)
    if not isinstance(datos, dict) or set(datos) != {'latitudAtencion', 'longitudAtencion'}:
        return jsonify({'error': 'Enviá latitudAtencion y longitudAtencion'}), 400
    latitud = _coordenada(datos['latitudAtencion'], 90)
    longitud = _coordenada(datos['longitudAtencion'], 180)
    if latitud is None or longitud is None:
        return jsonify({'error': 'Marcá en el mapa dónde vas a recibir la atención'}), 400

    tenia_lugar = solicitud.ubicacion_atencion() is not None
    try:
        # Condicional: si el turno se cerró entre la consulta y el guardado, no se guarda el punto.
        actualizadas = SolicitudServicio.query.filter(
            SolicitudServicio.idSolicitud == idSolicitud,
            SolicitudServicio.estado.in_(ESTADOS_ACTIVOS),
        ).update({'latitudAtencion': latitud, 'longitudAtencion': longitud}, synchronize_session=False)
        if actualizadas != 1:
            db.session.rollback()
            return jsonify({'error': 'Este turno ya se cerró, así que no hace falta marcar el lugar.'}), 409
        notificar(
            solicitud.enfermero.usuario_id, 'ubicacion',
            f'{nombre_completo(solicitud.paciente, "Tu paciente")} {"cambió" if tenia_lugar else "marcó"} en el mapa '
            f'el lugar de atención del turno de {_texto_turno(solicitud)}. Tocá para ver cómo llegar.',
            idSolicitud,
        )
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo guardar el lugar de atención')
        return jsonify({'error': 'No se pudo guardar el lugar. Intentá nuevamente.'}), 500
    db.session.expire(solicitud)
    return jsonify({'mensaje': 'Lugar de atención guardado', 'solicitud': solicitud.to_dict()}), 200


@solicitud_bp.route('/solicitudes/<int:idSolicitud>/reprogramar', methods=['PUT'])
@jwt_required()
def reprogramarSolicitud(idSolicitud):
    """El paciente cambia la fecha y hora de un turno activo; vuelve a Pendiente para que el enfermero responda."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    if usuario.rol != 'paciente':
        return jsonify({'error': 'Solo un paciente puede reprogramar una solicitud'}), 403
    solicitud = _consulta_con_resumen().filter_by(idSolicitud=idSolicitud).first()
    if not solicitud:
        return jsonify({'error': 'Solicitud no encontrada'}), 404
    if solicitud.paciente.usuario_id != usuario.id:
        return jsonify({'error': 'Solo podés reprogramar tus propias solicitudes'}), 403
    if solicitud.estado not in ESTADOS_ACTIVOS:
        return jsonify({'error': 'Solo se pueden reprogramar solicitudes en estado Pendiente o Aceptada'}), 400
    if datetime.combine(solicitud.fecha, solicitud.hora) <= _ahora_local():
        return jsonify({'error': 'El turno ya empezó o ya pasó, así que no se puede reprogramar.'}), 409

    datos = request.get_json(silent=True)
    if not isinstance(datos, dict) or set(datos) - {'fecha', 'hora'}:
        return jsonify({'error': 'Enviá la nueva fecha y hora del turno'}), 400
    try:
        fecha, hora = _validar_fecha_hora(datos.get('fecha'), datos.get('hora'))
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    if (fecha, hora) == (solicitud.fecha, solicitud.hora):
        return jsonify({'error': 'Elegí una fecha u hora distinta a la del turno actual.'}), 400
    problema = _problema_enfermero(solicitud.enfermero)
    if problema:
        return jsonify({'error': problema}), 409
    estado_anterior = solicitud.estado
    if (estado_anterior == 'Aceptada'
            and _pendientes_del_paciente(solicitud.idPaciente, excluir=idSolicitud) >= MAX_PENDIENTES_POR_PACIENTE):
        return jsonify({'error': MENSAJE_LIMITE_PENDIENTES}), 409

    turno_anterior = f'{solicitud.fecha:%d/%m} a las {solicitud.hora:%H:%M}'
    try:
        enfermero = _bloquear_agenda(solicitud.idEnfermero)
        if not enfermero:
            db.session.rollback()
            return jsonify({'error': 'Enfermero no encontrado'}), 404
        problema = _problema_de_agenda(enfermero, solicitud.servicio, fecha, hora,
                                       solicitud.idPaciente, excluir=idSolicitud)
        if problema:
            db.session.rollback()
            return jsonify({'error': problema}), 409
        actualizadas = SolicitudServicio.query.filter(
            SolicitudServicio.idSolicitud == idSolicitud,
            SolicitudServicio.estado == estado_anterior,
        ).update({'fecha': fecha, 'hora': hora, 'estado': 'Pendiente'}, synchronize_session=False)
        if actualizadas != 1:
            db.session.rollback()
            return jsonify({'error': 'La solicitud cambió de estado. Volvé a consultarla.'}), 400
        servicio = solicitud.servicio.tipoServicio if solicitud.servicio else 'servicio'
        notificar(
            enfermero.usuario_id, 'reprogramada',
            f'{nombre_completo(solicitud.paciente, "Tu paciente")} cambió el turno de {servicio} al '
            f'{fecha:%d/%m} a las {hora:%H:%M} (antes: {turno_anterior}). Tocá para aceptarlo o rechazarlo.',
            idSolicitud,
        )
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo reprogramar la solicitud de servicio')
        return jsonify({'error': 'No se pudo reprogramar la solicitud. Intentá nuevamente.'}), 500
    return jsonify({'mensaje': 'Solicitud reprogramada', 'solicitud': solicitud.to_dict()}), 200
