"""Sprint de reputación de Santiago: reseñas de enfermeros (SCRUM-65, SCRUM-66 y SCRUM-67).

Reutiliza la tabla de calificaciones de Renzo para que haya un único sistema de
reputación: una reseña es la calificación que el paciente deja sobre el enfermero.
"""
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import joinedload

from database import db
from models.calificacion_models import MAX_MOTIVO_MODERACION, Calificacion, recalcular_promedio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario

resena_bp = Blueprint('resena_bp', __name__)
CAMPOS_RESENA = {'idSolicitud', 'puntuacion', 'comentario'}
CAMPOS_OBLIGATORIOS = {'idSolicitud', 'puntuacion'}
MAX_CARACTERES = 2000
MAX_PALABRAS = 250
MIN_MOTIVO_DENUNCIA = 5


def _usuario_actual():
    try:
        return db.session.get(Usuario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        return None


def _validar_resena(datos):
    """Normalizar el JSON o lanzar ValueError con el mensaje para el paciente.

    Solo las estrellas son obligatorias: a una persona mayor le cuesta escribir desde el celular.
    """
    if not isinstance(datos, dict) or not CAMPOS_OBLIGATORIOS <= set(datos) <= CAMPOS_RESENA:
        raise ValueError('Los datos de la reseña no son válidos. Elegí de 1 a 5 estrellas (el comentario es opcional).')
    id_solicitud = datos['idSolicitud']
    if type(id_solicitud) is not int or id_solicitud <= 0:
        raise ValueError('idSolicitud debe ser un entero positivo')
    puntuacion = datos['puntuacion']
    if type(puntuacion) is not int or not 1 <= puntuacion <= 5:
        raise ValueError('La puntuación debe ser un número entero de 1 a 5')
    comentario = datos.get('comentario')
    if comentario is None:
        comentario = ''
    if not isinstance(comentario, str):
        raise ValueError('El comentario debe ser texto')
    # Sin comentario se guarda vacío: la columna no admite nulos y el frontend espera texto.
    comentario = comentario.strip()
    if len(comentario) > MAX_CARACTERES or len(comentario.split()) > MAX_PALABRAS:
        raise ValueError(f'El comentario no puede superar las {MAX_PALABRAS} palabras ni los {MAX_CARACTERES} caracteres')
    return id_solicitud, puntuacion, comentario


def resena_dict(calificacion, paciente):
    # Para el perfil público alcanza con el nombre y la inicial del apellido.
    autor = ' '.join(filter(None, [
        paciente.nombre if paciente else None,
        f'{paciente.apellido[0]}.' if paciente and paciente.apellido else None,
    ])) or 'Paciente'
    return {
        'idResena': calificacion.idCalificacion,
        'idSolicitud': calificacion.idSolicitud,
        'puntuacion': calificacion.estrellas,
        'comentario': calificacion.comentario,
        'fecha': calificacion.fecha.isoformat(timespec='seconds') + 'Z' if calificacion.fecha else None,
        'paciente': autor,
    }


@resena_bp.post('/resenas')
@jwt_required()
def publicarResena():
    """SCRUM-66.1: el paciente reseña al enfermero una vez finalizada la atención (HU11)."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    if usuario.rol != 'paciente':
        return jsonify(error='Solo un paciente puede publicar una reseña'), 403
    try:
        id_solicitud, puntuacion, comentario = _validar_resena(request.get_json(silent=True))
    except ValueError as error:
        return jsonify(error=str(error)), 400

    solicitud = SolicitudServicio.query.options(
        joinedload(SolicitudServicio.paciente), joinedload(SolicitudServicio.enfermero),
    ).filter_by(idSolicitud=id_solicitud).first()
    if not solicitud:
        return jsonify(error='Solicitud no encontrada'), 404
    if solicitud.paciente.usuario_id != usuario.id:
        return jsonify(error='Solo podés reseñar tus propias solicitudes'), 403
    if solicitud.estado != 'Realizada':
        return jsonify(error='La reseña solo puede realizarse una vez finalizada la atención'), 409
    if Calificacion.query.filter_by(idSolicitud=id_solicitud, idUsuarioAutor=usuario.id).first():
        return jsonify(error='Ya publicaste una reseña para este servicio'), 409

    calificacion = Calificacion(
        idSolicitud=id_solicitud,
        idUsuarioAutor=usuario.id,
        idUsuarioCalificado=solicitud.enfermero.usuario_id,
        estrellas=puntuacion,
        comentario=comentario,
    )
    try:
        db.session.add(calificacion)
        recalcular_promedio(solicitud.enfermero)
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify(error='Ya publicaste una reseña para este servicio'), 409
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo publicar la reseña')
        return jsonify(error='No se pudo publicar la reseña. Intentá nuevamente.'), 500

    return jsonify({
        'mensaje': 'Reseña publicada',
        'resena': resena_dict(calificacion, solicitud.paciente),
        'calificacionPromedio': solicitud.enfermero.calificacionPromedio,
        'cantidadResenas': solicitud.enfermero.cantidadResenas,
    }), 201


@resena_bp.get('/enfermeros/<int:idEnfermero>/resenas')
@jwt_required()
def consultarResenas(idEnfermero):
    """SCRUM-67.1: reseñas recibidas por el enfermero, de la más nueva a la más vieja.

    Pide sesión igual que el perfil del enfermero (GET /usuarios/<id>), donde se muestran.
    """
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    enfermero = db.session.get(Enfermero, idEnfermero)
    if not enfermero:
        return jsonify(error='Enfermero no encontrado'), 404
    filas = (
        db.session.query(Calificacion, Paciente)
        .join(Paciente, Paciente.usuario_id == Calificacion.idUsuarioAutor)
        .filter(Calificacion.idUsuarioCalificado == enfermero.usuario_id, Calificacion.oculta.is_(False))
        .order_by(Calificacion.idCalificacion.desc())
        .all()
    )
    resenas = [resena_dict(calificacion, paciente) for calificacion, paciente in filas]
    if usuario.id == enfermero.usuario_id:
        # El propio enfermero ve cuáles ya denunció, para no ofrecerle denunciarlas de nuevo.
        for resena, (calificacion, _paciente) in zip(resenas, filas):
            resena['denunciada'] = bool(calificacion.denunciada)
    return jsonify({
        'idEnfermero': enfermero.id,
        'calificacionPromedio': enfermero.calificacionPromedio,
        'cantidadResenas': enfermero.cantidadResenas or 0,
        'resenas': resenas,
    }), 200


@resena_bp.post('/resenas/<int:idResena>/denunciar')
@jwt_required()
def denunciarResena(idResena):
    """El enfermero calificado pide que un administrador revise una reseña sobre él."""
    usuario = _usuario_actual()
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    if usuario.rol != 'enfermero':
        return jsonify(error='Solo el profesional calificado puede denunciar una reseña'), 403
    datos = request.get_json(silent=True)
    motivo = datos.get('motivo') if isinstance(datos, dict) else None
    motivo = motivo.strip() if isinstance(motivo, str) else ''
    if not MIN_MOTIVO_DENUNCIA <= len(motivo) <= MAX_MOTIVO_MODERACION:
        return jsonify(error=f'Contanos por qué querés denunciar esta reseña '
                             f'(entre {MIN_MOTIVO_DENUNCIA} y {MAX_MOTIVO_MODERACION} caracteres).'), 400
    calificacion = db.session.get(Calificacion, idResena)
    if not calificacion or calificacion.oculta:
        return jsonify(error='Reseña no encontrada'), 404
    if calificacion.idUsuarioCalificado != usuario.id:
        return jsonify(error='Solo podés denunciar reseñas sobre vos'), 403
    if calificacion.denunciada:
        return jsonify(error='Ya denunciaste esta reseña. El equipo de Enfered la va a revisar.'), 409
    calificacion.denunciada = True
    calificacion.motivoDenuncia = motivo
    calificacion.denunciaRevisada = False
    try:
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudo denunciar la reseña')
        return jsonify(error='No se pudo enviar la denuncia. Intentá nuevamente.'), 500
    return jsonify(mensaje='Recibimos tu denuncia. El equipo de Enfered va a revisar la reseña.',
                   idResena=calificacion.idCalificacion, denunciada=True), 200
