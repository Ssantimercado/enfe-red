"""Creación y consulta de solicitudes: SCRUM-56, SCRUM-57 y SCRUM-58."""

import re
from datetime import date, datetime, time, timedelta, timezone

from flask import Blueprint, current_app, jsonify, request, url_for
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.servicio_models import Servicio
from models.solicitud_models import ESTADOS_ACTIVOS, SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario


solicitud_bp = Blueprint('solicitud_bp', __name__)
ZONA_HORARIA_ARGENTINA = timezone(timedelta(hours=-3))
CAMPOS_SOLICITUD = {
    'idPaciente', 'idEnfermero', 'idServicio', 'fecha', 'hora', 'direccionAtencion',
}


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
    if not isinstance(hora_texto, str) or not re.fullmatch(r'\d{2}:\d{2}', hora_texto):
        raise ValueError('La hora debe tener formato HH:MM (24 horas)')

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

    solicitud = SolicitudServicio(
        paciente=paciente,
        enfermero=enfermero,
        servicio=servicio,
        fecha=datos['fecha'],
        hora=datos['hora'],
        direccionAtencion=datos['direccionAtencion'],
    )
    try:
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
