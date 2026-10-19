"""Creación, consulta y gestión de solicitudes: SCRUM-56 a SCRUM-61."""

import re
from datetime import date, datetime, time, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request, url_for
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.notificacion_models import notificar
from models.servicio_models import Servicio
from models.solicitud_models import ESTADOS_ACTIVOS, SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario


solicitud_bp = Blueprint('solicitud_bp', __name__)
ZONA_HORARIA_ARGENTINA = timezone(timedelta(hours=-3))
CAMPOS_SOLICITUD = {
    'idPaciente', 'idEnfermero', 'idServicio', 'fecha', 'hora', 'direccionAtencion',
}
NOTIFICACIONES_ESTADO = {'Aceptada': ('aceptada', 'aceptó'), 'Rechazada': ('rechazada', 'rechazó')}


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
    # fecha y hora se guardan como valores locales, sin zona horaria.
    return datetime.now(ZONA_HORARIA_ARGENTINA).replace(tzinfo=None)


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

    fecha_texto = datos.get('fecha')
    hora_texto = datos.get('hora')
    if not isinstance(fecha_texto, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', fecha_texto):
        raise ValueError('La fecha debe tener formato AAAA-MM-DD')
    if not isinstance(hora_texto, str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', hora_texto):
        raise ValueError('La hora debe tener formato HH:MM y estar entre 00:00 y 23:59')

    try:
        fecha = date.fromisoformat(fecha_texto)
        hora = time.fromisoformat(hora_texto)
    except ValueError as error:
        raise ValueError('La fecha o la hora no son válidas') from error
    if datetime.combine(fecha, hora) <= _ahora_local():
        raise ValueError('La fecha y hora deben ser futuras (hora de Argentina, UTC-3)')

    return {
        **datos,
        'fecha': fecha,
        'hora': hora,
        'direccionAtencion': direccion.strip(),
    }


def _consulta_con_resumen():
    """Cargar paciente, enfermero y servicio en la misma consulta SQL."""
    return SolicitudServicio.query.options(
        joinedload(SolicitudServicio.paciente),
        joinedload(SolicitudServicio.enfermero),
        joinedload(SolicitudServicio.servicio),
    )


def _bloquear_agenda(id_enfermero):
    """Serializar escrituras de turnos del mismo profesional en MySQL/InnoDB."""
    return Enfermero.query.filter_by(id=id_enfermero).populate_existing().with_for_update().first()


def _turno_ocupado(id_enfermero, fecha, hora, estados=ESTADOS_ACTIVOS, excluir=None):
    """La reserva pertenece a una fecha/hora concreta, no a una franja semanal."""
    consulta = SolicitudServicio.query.filter(
        SolicitudServicio.idEnfermero == id_enfermero,
        SolicitudServicio.fecha == fecha,
        SolicitudServicio.hora == hora,
        SolicitudServicio.estado.in_(estados),
    )
    if excluir is not None:
        consulta = consulta.filter(SolicitudServicio.idSolicitud != excluir)
    # La lectura bloqueante ve el estado actual después de esperar la agenda.
    return consulta.with_for_update().first() is not None


def _nombre_completo(perfil, alternativo):
    return ' '.join(filter(None, [perfil.nombre, perfil.apellido])) or alternativo


def _notificar_cambio_estado(solicitud, destino):
    """SCRUM-64.2: avisar al paciente cuando el enfermero acepta o rechaza su turno."""
    if destino not in NOTIFICACIONES_ESTADO:
        return
    tipo, verbo = NOTIFICACIONES_ESTADO[destino]
    enfermero = _nombre_completo(solicitud.enfermero, 'El profesional')
    servicio = solicitud.servicio.tipoServicio if solicitud.servicio else 'servicio'
    notificar(
        solicitud.paciente.usuario_id,
        tipo,
        f'{enfermero} {verbo} tu solicitud de {servicio} del '
        f'{solicitud.fecha:%d/%m} a las {solicitud.hora:%H:%M}.',
        solicitud.idSolicitud,
    )


def _cambiar_estado_solicitud(id_solicitud, *, rol, origen, destino, accion, mensaje):
    """Validar titularidad y guardar una transición de estado de forma atómica."""
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

    try:
        if not _bloquear_agenda(solicitud.idEnfermero):
            db.session.rollback()
            return jsonify({'error': 'Enfermero no encontrado'}), 404
        # Permitir gestionar pedidos anteriores a la validación de reservas,
        # pero nunca aceptar dos atenciones para el mismo inicio.
        if destino == 'Aceptada' and _turno_ocupado(
            solicitud.idEnfermero, solicitud.fecha, solicitud.hora,
            estados=('Aceptada',), excluir=id_solicitud,
        ):
            db.session.rollback()
            return jsonify({'error': 'Ya hay otra solicitud aceptada para esa fecha y hora'}), 409
        actualizadas = SolicitudServicio.query.filter(
            SolicitudServicio.idSolicitud == id_solicitud,
            SolicitudServicio.idEnfermero == solicitud.idEnfermero,
            SolicitudServicio.idPaciente == solicitud.idPaciente,
            SolicitudServicio.estado.in_(origen),
        ).update({'estado': destino}, synchronize_session=False)
        if actualizadas != 1:
            db.session.rollback()
            return jsonify({'error': 'La solicitud cambió de estado. Volvé a consultarla.'}), 400
        # La alerta se guarda en la misma transacción que el cambio de estado.
        _notificar_cambio_estado(solicitud, destino)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo %s la solicitud de servicio', accion)
        return jsonify({'error': f'No se pudo {accion} la solicitud. Intentá nuevamente.'}), 500

    return jsonify({'mensaje': mensaje, 'solicitud': solicitud.to_dict()}), 200


@solicitud_bp.route('/servicios', methods=['GET'])
@jwt_required()
def listarServicios():
    """Catálogo global que utiliza crearSolicitud; no es una oferta por enfermero."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    servicios = Servicio.query.order_by(Servicio.tipoServicio, Servicio.idServicio).all()
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
    servicio = db.session.get(Servicio, datos['idServicio'])
    if not servicio:
        return jsonify({'error': 'Servicio no encontrado'}), 404

    try:
        # Integración SCRUM-60/61: únicamente los pedidos activos ocupan el turno.
        enfermero = _bloquear_agenda(enfermero.id)
        if not enfermero:
            db.session.rollback()
            return jsonify({'error': 'Enfermero no encontrado'}), 404
        if not enfermero.verificado or not enfermero.disponible:
            db.session.rollback()
            return jsonify({'error': 'El enfermero no está habilitado para recibir solicitudes'}), 409
        if _turno_ocupado(enfermero.id, datos['fecha'], datos['hora']):
            db.session.rollback()
            return jsonify({'error': 'Ese horario ya tiene una solicitud activa. Elegí otro.'}), 409
        solicitud = SolicitudServicio(
            paciente=paciente,
            enfermero=enfermero,
            servicio=servicio,
            fecha=datos['fecha'],
            hora=datos['hora'],
            direccionAtencion=datos['direccionAtencion'],
        )
        db.session.add(solicitud)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo crear la solicitud de servicio')
        return jsonify({'error': 'No se pudo guardar la solicitud. Intentá nuevamente.'}), 500
    return jsonify({'mensaje': 'Solicitud creada', 'solicitud': solicitud.to_dict()}), 201, {
        'Location': url_for('solicitud_bp.confirmarSolicitud', idSolicitud=solicitud.idSolicitud),
    }


# SCRUM-57: comprobante de la solicitud creada.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>', methods=['GET'])
@jwt_required()
def confirmarSolicitud(idSolicitud):
    """Consultar el comprobante; no acepta ni cambia el estado del pedido."""
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
    return jsonify(solicitud.to_dict()), 200


# SCRUM-58: bandejas de paciente y enfermero.
@solicitud_bp.route('/solicitudes/paciente/<int:idPaciente>', methods=['GET'])
@jwt_required()
def consultarSolicitudesPaciente(idPaciente):
    """Listar los pedidos Pendiente o Aceptada del paciente autenticado."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify({'error': 'La sesión no corresponde a un usuario existente'}), 401
    paciente = Paciente.query.filter_by(usuario_id=usuario.id).first()
    if usuario.rol != 'paciente' or not paciente or paciente.id != idPaciente:
        return jsonify({'error': 'Solo podés consultar tus propias solicitudes de paciente'}), 403
    solicitudes = (
        _consulta_con_resumen()
        .filter(
            SolicitudServicio.idPaciente == idPaciente,
            SolicitudServicio.estado.in_(ESTADOS_ACTIVOS),
        )
        .order_by(SolicitudServicio.fecha, SolicitudServicio.hora, SolicitudServicio.idSolicitud)
        .all()
    )
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
    return jsonify([solicitud.to_dict() for solicitud in solicitudes]), 200


# SCRUM-59.1 (Pablo): aceptación por el enfermero asignado.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/aceptar', methods=['PUT'])
@jwt_required()
def aceptarSolicitud(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Pendiente',), destino='Aceptada',
        accion='aceptar', mensaje='Solicitud aceptada',
    )


# SCRUM-59.2 (Pablo / HU8): finalizar la atención aceptada.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/finalizar', methods=['PUT'])
@jwt_required()
def marcarComoRealizado(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Aceptada',), destino='Realizada',
        accion='finalizar', mensaje='Servicio marcado como realizado',
    )


# SCRUM-60 (Pablo): rechazar libera la reserva de fecha y hora.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/rechazar', methods=['PUT'])
@jwt_required()
def rechazarSolicitud(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='enfermero', origen=('Pendiente',), destino='Rechazada',
        accion='rechazar', mensaje='Solicitud rechazada',
    )


# SCRUM-61 (Pablo): cancelar solamente los pedidos activos del propio paciente.
@solicitud_bp.route('/solicitudes/<int:idSolicitud>/cancelar', methods=['PUT'])
@jwt_required()
def cancelarSolicitud(idSolicitud):
    return _cambiar_estado_solicitud(
        idSolicitud, rol='paciente', origen=ESTADOS_ACTIVOS, destino='Cancelada',
        accion='cancelar', mensaje='Solicitud cancelada',
    )
