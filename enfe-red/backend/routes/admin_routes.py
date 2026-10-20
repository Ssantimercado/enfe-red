"""SCRUM-68 a SCRUM-70: funciones de administración con autorización JWT."""
from functools import wraps
import math

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt, get_jwt_identity, jwt_required
from sqlalchemy import or_
from sqlalchemy.exc import SQLAlchemyError

from database import db
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio
from models.usuario_models import Enfermero, Paciente, Usuario


admin_bp = Blueprint('admin', __name__)


def admin_required(func):
    @wraps(func)
    @jwt_required()
    def wrapper(*args, **kwargs):
        try:
            usuario = db.session.get(Usuario, int(get_jwt_identity()))
        except (TypeError, ValueError):
            usuario = None
        claims = get_jwt()
        if (usuario is None or usuario.suspendido or usuario.rol != 'administrador'
                or claims.get('rol') != 'administrador' or not usuario.nivelPermiso
                or claims.get('nivelPermiso') != usuario.nivelPermiso):
            return jsonify(error='Se requiere una cuenta administradora activa'), 403
        return func(*args, **kwargs)
    return wrapper


def _datos_usuario(usuario, paciente=None, enfermero=None):
    perfil = paciente or enfermero
    return {
        'id': usuario.id,
        'email': usuario.email,
        'rol': usuario.rol,
        'suspendido': bool(usuario.suspendido),
        'nombre': perfil.nombre if perfil else None,
        'apellido': perfil.apellido if perfil else None,
    }


@admin_bp.get('/admin/usuarios')
@admin_required
def buscarUsuario():
    termino = request.args.get('q', '').strip()
    rol = request.args.get('rol', '').strip()
    estado = request.args.get('estado', '').strip().lower()
    try:
        pagina = max(1, int(request.args.get('page', 1)))
        por_pagina = min(50, max(1, int(request.args.get('per_page', 10))))
    except (TypeError, ValueError):
        return jsonify(error='La paginación no es válida'), 400

    consulta = db.session.query(Usuario, Paciente, Enfermero).outerjoin(
        Paciente, Paciente.usuario_id == Usuario.id
    ).outerjoin(Enfermero, Enfermero.usuario_id == Usuario.id)
    if termino:
        patron = f'%{termino}%'
        consulta = consulta.filter(or_(
            Usuario.email.ilike(patron), Paciente.nombre.ilike(patron),
            Paciente.apellido.ilike(patron), Enfermero.nombre.ilike(patron),
            Enfermero.apellido.ilike(patron), Enfermero.matricula.ilike(patron),
        ))
    if rol:
        if rol not in ('paciente', 'enfermero', 'administrador'):
            return jsonify(error='El rol no es válido'), 400
        consulta = consulta.filter(Usuario.rol == rol)
    if estado:
        if estado not in ('activo', 'suspendido'):
            return jsonify(error='El estado no es válido'), 400
        consulta = consulta.filter(Usuario.suspendido.is_(estado == 'suspendido'))

    total = consulta.with_entities(Usuario.id).count()
    filas = consulta.order_by(Usuario.id).offset((pagina - 1) * por_pagina).limit(por_pagina).all()
    paginas = math.ceil(total / por_pagina) if total else 0
    return jsonify({
        'usuarios': [_datos_usuario(usuario, paciente, enfermero)
                     for usuario, paciente, enfermero in filas],
        'total_resultados': total,
        'total_paginas': paginas,
    }), 200


@admin_bp.put('/admin/usuarios/<int:idUsuario>/suspension')
@admin_required
def suspenderUsuario(idUsuario):
    data = request.get_json(silent=True)
    suspendido = data.get('suspendido') if isinstance(data, dict) else None
    if not isinstance(suspendido, bool):
        return jsonify(error='El campo suspendido debe ser booleano'), 400
    usuario = db.session.get(Usuario, idUsuario)
    if usuario is None:
        return jsonify(error='Usuario no encontrado'), 404
    if usuario.id == int(get_jwt_identity()) and suspendido:
        return jsonify(error='No podés suspender tu propia cuenta'), 400
    usuario.suspendido = suspendido
    try:
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify(error='No se pudo actualizar el estado del usuario'), 500
    paciente = Paciente.query.filter_by(usuario_id=usuario.id).first()
    enfermero = Enfermero.query.filter_by(usuario_id=usuario.id).first()
    return jsonify(mensaje='Estado actualizado', usuario=_datos_usuario(usuario, paciente, enfermero)), 200


@admin_bp.put('/admin/usuarios/<int:idUsuario>/estado')
@admin_required
def cambiarEstadoUsuario(idUsuario):
    data = request.get_json(silent=True)
    estado = data.get('estado') if isinstance(data, dict) else None
    if estado not in ('Activo', 'Suspendido'):
        return jsonify(error="El estado debe ser 'Activo' o 'Suspendido'"), 400
    usuario = db.session.get(Usuario, idUsuario)
    if usuario is None:
        return jsonify(error='Usuario no encontrado'), 404
    if usuario.id == int(get_jwt_identity()) and estado == 'Suspendido':
        return jsonify(error='No podés suspender tu propia cuenta'), 400
    usuario.estado = estado
    try:
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify(error='No se pudo actualizar el estado del usuario'), 500
    return jsonify(mensaje='Estado actualizado', usuario={
        **_datos_usuario(usuario), 'estado': usuario.estado,
    }), 200


@admin_bp.put('/admin/enfermeros/<int:idEnfermero>/matricula')
@admin_required
def verificarMatricula(idEnfermero):
    data = request.get_json(silent=True)
    verificado = data.get('verificado') if isinstance(data, dict) else None
    if not isinstance(verificado, bool):
        return jsonify(error='El campo verificado debe ser booleano'), 400
    enfermero = db.session.get(Enfermero, idEnfermero)
    if enfermero is None:
        return jsonify(error='Enfermero no encontrado'), 404
    enfermero.verificado = verificado
    enfermero.matricula_rechazada = not verificado
    try:
        db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        return jsonify(error='No se pudo actualizar la matrícula'), 500
    return jsonify(mensaje='Verificación actualizada', enfermero={
        'idEnfermero': enfermero.id, 'verificado': enfermero.verificado,
    }), 200


@admin_bp.get('/admin/enfermeros/pendientes')
@admin_required
def enfermerosPendientes():
    pendientes = Enfermero.query.filter_by(
        verificado=False, matricula_rechazada=False
    ).order_by(Enfermero.id).all()
    return jsonify(enfermeros=[{
        'idEnfermero': enfermero.id,
        'usuarioId': enfermero.usuario_id,
        'nombre': enfermero.nombre,
        'apellido': enfermero.apellido,
        'email': enfermero.usuario.email if enfermero.usuario else '',
        'matricula': enfermero.matricula,
        'especialidad': enfermero.especialidad,
    } for enfermero in pendientes]), 200


@admin_bp.get('/admin/metricas')
@admin_bp.get('/admin/resumen')
@admin_required
def resumenAdmin():
    total_usuarios = Usuario.query.count()
    usuarios_activos = Usuario.query.filter_by(suspendido=False).count()
    pendientes = Enfermero.query.filter_by(
        verificado=False, matricula_rechazada=False
    ).count()
    realizados = SolicitudServicio.query.filter_by(estado='Realizada').count()
    return jsonify({
        'total_usuarios': total_usuarios,
        'usuarios_activos': usuarios_activos,
        'usuariosActivos': usuarios_activos,
        'pacientes': Usuario.query.filter_by(rol='paciente').count(),
        'enfermeros': Usuario.query.filter_by(rol='enfermero').count(),
        'usuarios_suspendidos': Usuario.query.filter_by(suspendido=True).count(),
        'matriculas_pendientes': pendientes,
        'enfermerosPendientes': pendientes,
        'total_solicitudes': SolicitudServicio.query.count(),
        'servicios_realizados': realizados,
        'serviciosRealizados': realizados,
        'servicios_catalogo': Servicio.query.count(),
    }), 200
