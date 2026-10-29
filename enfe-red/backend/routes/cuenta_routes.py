"""Derechos de la Ley 25.326 sobre la propia cuenta: acceso (exportar) y supresión (eliminar)."""
import json
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import SQLAlchemyError

from database import db
from extensions import bcrypt
from models.acceso_models import CodigoRecuperacion
from models.calificacion_models import Calificacion
from models.mensaje_models import Mensaje
from models.notificacion_models import Notificacion, notificar
from models.solicitud_models import ESTADOS_ACTIVOS, SolicitudServicio
from models.usuario_models import Usuario
from routes.auth_routes import verificar_password
from routes.usuario_routes import es_administrador_activo
from services.cifrado import ErrorCifrado
from services.limites import borrar_intentos, registrar_intento, supera_limite

cuenta_bp = Blueprint('cuenta_bp', __name__)
ZONA_HORARIA_ARGENTINA = timezone(timedelta(hours=-3))
NOMBRE_ELIMINADO = 'Cuenta eliminada'
DIRECCION_ELIMINADA = 'Dirección eliminada'
# Frena a quien prueba contraseñas con una sesión robada para borrar la cuenta.
VENTANA_ELIMINAR, MAX_FALLIDOS_ELIMINAR = timedelta(minutes=15), 5


def _usuario_actual():
    try:
        return db.session.get(Usuario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


def _ahora_local():
    # Mismo criterio que las solicitudes: fecha y hora locales de Argentina, sin zona.
    return datetime.now(ZONA_HORARIA_ARGENTINA).replace(tzinfo=None)


def _fecha_iso(valor):
    return valor.isoformat(timespec='seconds') + 'Z' if valor else None


def _solicitudes_de(usuario):
    consulta = SolicitudServicio.query
    if usuario.perfil_paciente:
        return consulta.filter(SolicitudServicio.idPaciente == usuario.perfil_paciente.id)
    if usuario.perfil_enfermero:
        return consulta.filter(SolicitudServicio.idEnfermero == usuario.perfil_enfermero.id)
    return None


def _nombre(perfil, alternativo):
    return ' '.join(filter(None, [perfil.nombre, perfil.apellido])) or alternativo


@cuenta_bp.get('/cuenta/exportar')
@jwt_required()
def exportarDatos():
    """Derecho de acceso: todos los datos de la cuenta en un archivo JSON."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    try:
        perfil = None
        if usuario.perfil_paciente:
            perfil = usuario.perfil_paciente.to_dict()
        elif usuario.perfil_enfermero:
            perfil = usuario.perfil_enfermero.to_dict()
            perfil['horarios'] = [d.to_dict() for d in usuario.perfil_enfermero.disponibilidades]
        consulta = _solicitudes_de(usuario)
        solicitudes = consulta.order_by(SolicitudServicio.idSolicitud).all() if consulta is not None else []
        datos = {
            'exportadoEn': _fecha_iso(datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)),
            'cuenta': {
                'id': usuario.id, 'email': usuario.email, 'rol': usuario.rol,
                'estado': usuario.estado, 'nivelPermiso': usuario.nivelPermiso,
            },
            'consentimiento': {
                'versionTerminos': usuario.versionTerminos,
                'aceptoTerminosEn': _fecha_iso(usuario.aceptoTerminosEn),
            },
            'perfil': perfil,
            'solicitudes': [s.to_dict() for s in solicitudes],
            'mensajesEnviados': [m.to_dict() for m in Mensaje.query.filter_by(
                idEmisor=usuario.id).order_by(Mensaje.idMensaje)],
            'calificaciones': {
                'escritas': [c.to_dict() for c in Calificacion.query.filter_by(
                    idUsuarioAutor=usuario.id).order_by(Calificacion.idCalificacion)],
                'recibidas': [c.to_dict() for c in Calificacion.query.filter_by(
                    idUsuarioCalificado=usuario.id).order_by(Calificacion.idCalificacion)],
            },
            'notificaciones': [n.to_dict() for n in Notificacion.query.filter_by(
                idUsuario=usuario.id).order_by(Notificacion.idNotificacion)],
        }
    except (ErrorCifrado, SQLAlchemyError):
        db.session.rollback()
        current_app.logger.exception('No se pudieron exportar los datos de la cuenta')
        return jsonify(error='No pudimos preparar tus datos. Intentá de nuevo más tarde.'), 500
    contenido = json.dumps(datos, ensure_ascii=False, indent=2)
    return Response(contenido, mimetype='application/json', headers={
        'Content-Disposition': 'attachment; filename="enfered-mis-datos.json"',
        # Tiene datos de salud: que ningún intermediario lo guarde.
        'Cache-Control': 'no-store',
    })


def _cancelar_solicitudes(usuario):
    """Cancela los turnos Pendientes y los Aceptados futuros, y avisa a la otra parte."""
    consulta = _solicitudes_de(usuario)
    if consulta is None:
        return 0
    ahora = _ahora_local()
    canceladas = 0
    for solicitud in consulta.filter(SolicitudServicio.estado.in_(ESTADOS_ACTIVOS)).all():
        if solicitud.estado == 'Aceptada' and datetime.combine(solicitud.fecha, solicitud.hora) <= ahora:
            # Un turno aceptado que ya pasó queda abierto hasta que el enfermero confirme que le llegó el pago.
            continue
        solicitud.estado = 'Cancelada'
        solicitud.canceladaPor = 'paciente' if usuario.perfil_paciente else 'enfermero'
        solicitud.motivoCancelacion = 'Se eliminó la cuenta'
        solicitud.olvidar_ubicacion()
        canceladas += 1
        servicio = solicitud.servicio.tipoServicio if solicitud.servicio else 'servicio'
        turno = f'{servicio} del {solicitud.fecha:%d/%m} a las {solicitud.hora:%H:%M}'
        if usuario.perfil_paciente:
            notificar(solicitud.enfermero.usuario_id, 'cancelada',
                      f'{_nombre(solicitud.paciente, "Tu paciente")} eliminó su cuenta y se canceló '
                      f'la solicitud de {turno}.', solicitud.idSolicitud)
        else:
            notificar(solicitud.paciente.usuario_id, 'cancelada',
                      f'{_nombre(solicitud.enfermero, "El profesional")} ya no atiende por Enfered y se '
                      f'canceló tu solicitud de {turno}. Podés buscar otro profesional en la cartilla.',
                      solicitud.idSolicitud)
    return canceladas


def _anonimizar(usuario):
    """Borra los datos personales sin borrar filas: solicitudes, mensajes y reseñas siguen enteros."""
    paciente, enfermero = usuario.perfil_paciente, usuario.perfil_enfermero
    if paciente:
        paciente.nombre, paciente.apellido = NOMBRE_ELIMINADO, None
        paciente.direccion = paciente.telefono = paciente.obraSocial = None
        paciente.historial_medico = None
        paciente.latitud = paciente.longitud = None
        paciente.ubicacion_compartida = False
        # La dirección de atención también es del paciente.
        SolicitudServicio.query.filter_by(idPaciente=paciente.id).update(
            {'direccionAtencion': DIRECCION_ELIMINADA, 'latitudAtencion': None, 'longitudAtencion': None},
            synchronize_session=False,
        )
    if enfermero:
        enfermero.nombre, enfermero.apellido = NOMBRE_ELIMINADO, None
        enfermero.telefono = enfermero.direccion = enfermero.ciudad = enfermero.descripcion = None
        enfermero.latitud = enfermero.longitud = None
        # Sale de la cartilla y de la revisión de matrículas.
        enfermero.matricula = f'ELIMINADO-{usuario.id}'
        enfermero.disponible = enfermero.verificado = False
        enfermero.disponibilidades.clear()
    usuario.email = f'eliminado-{usuario.id}@enfered.invalid'
    # Nadie conoce esta contraseña: la cuenta no se puede volver a usar.
    usuario.password_hash = bcrypt.generate_password_hash(secrets.token_urlsafe(32)).decode('utf-8')
    usuario.nivelPermiso = None
    usuario.eliminado = True
    # Suspendida además de eliminada: todas las consultas que ya excluyen suspendidos la ignoran.
    usuario.suspendido = True
    usuario.versionToken = (usuario.versionToken or 0) + 1
    Notificacion.query.filter_by(idUsuario=usuario.id).delete(synchronize_session=False)
    CodigoRecuperacion.query.filter_by(usuario_id=usuario.id).delete(synchronize_session=False)


@cuenta_bp.delete('/cuenta')
@jwt_required()
def eliminarCuenta():
    """Derecho de supresión: anonimiza la cuenta y cierra todas sus sesiones."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    data = request.get_json(silent=True)
    password = data.get('password') if isinstance(data, dict) else None
    if not isinstance(password, str) or not password:
        return jsonify(error='Escribí tu contraseña para confirmar que querés eliminar la cuenta'), 400
    if supera_limite('eliminar_cuenta', usuario.id, MAX_FALLIDOS_ELIMINAR, VENTANA_ELIMINAR):
        return jsonify(error='Hiciste muchos intentos. Esperá 15 minutos y probá de nuevo.'), 429
    # 400 y no 401: un 401 haría que el frontend cierre la sesión.
    if not verificar_password(usuario, password):
        registrar_intento('eliminar_cuenta', usuario.id)
        return jsonify(error='La contraseña no es correcta'), 400
    if es_administrador_activo(usuario):
        otros_administradores = Usuario.query.filter(
            Usuario.id != usuario.id,
            Usuario.rol == 'administrador',
            Usuario.nivelPermiso.isnot(None),
            Usuario.suspendido.is_(False),
            Usuario.eliminado.is_(False),
        ).count()
        if not otros_administradores:
            return jsonify(error='Sos el único administrador activo. Antes de eliminar tu cuenta, '
                                 'pedí que otra persona quede como administradora.'), 409
    try:
        canceladas = _cancelar_solicitudes(usuario)
        _anonimizar(usuario)
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo eliminar la cuenta')
        return jsonify(error='No se pudo eliminar la cuenta. Intentá nuevamente.'), 500
    borrar_intentos('eliminar_cuenta', usuario.id)
    return jsonify(mensaje='Tu cuenta se eliminó. Gracias por haber usado Enfered.',
                   solicitudesCanceladas=canceladas), 200
