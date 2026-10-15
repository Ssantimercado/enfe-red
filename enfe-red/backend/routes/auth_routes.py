import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, request, jsonify, current_app
from database import db
from extensions import bcrypt
from models.usuario_models import Usuario

# Creamos el "Blueprint" para las rutas de autenticación
auth_bp = Blueprint('auth', __name__)

# Recuperación local: códigos de diez minutos, cinco intentos y un solo uso.
# El envío de correo real todavía no está integrado.
codigos_recuperacion = {}

@auth_bp.route('/recuperar-password', methods=['POST'])
def solicitar_recuperacion():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Datos inválidos'}), 400
    email = data.get('email')

    if not isinstance(email, str) or not email.strip():
        return jsonify({"error": "Falta el email"}), 400

    email = email.strip()
    ahora = datetime.now(timezone.utc)
    for correo, registro in list(codigos_recuperacion.items()):
        if registro['vence'] <= ahora:
            del codigos_recuperacion[correo]
    if Usuario.query.filter_by(email=email).first():
        codigo = f'{secrets.randbelow(1000000):06d}'
        codigos_recuperacion[email] = {
            'codigo': codigo, 'vence': ahora + timedelta(minutes=10), 'intentos': 0,
        }
        current_app.logger.warning('RECUPERACION LOCAL - %s - Codigo: %s', email, codigo)

    return jsonify({"mensaje": "Solicitud procesada"}), 200


@auth_bp.route('/reset-password', methods=['POST'])
def resetear_password():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Datos inválidos'}), 400
    email = data.get('email')
    codigo = data.get('codigo')
    nueva_password = data.get('nueva_password')

    if not all(isinstance(v, str) and v.strip() for v in (email, codigo, nueva_password)):
        return jsonify({'error': 'Completá email, código y nueva contraseña'}), 400
    email = email.strip()
    registro = codigos_recuperacion.get(email)
    if not registro or registro['vence'] <= datetime.now(timezone.utc):
        codigos_recuperacion.pop(email, None)
        return jsonify({'error': 'Código incorrecto o vencido'}), 400
    registro['intentos'] += 1
    if not secrets.compare_digest(registro['codigo'].encode(), codigo.strip().encode()):
        if registro['intentos'] >= 5:
            codigos_recuperacion.pop(email, None)
        return jsonify({"error": "Código incorrecto"}), 400
    usuario = Usuario.query.filter_by(email=email).first()
    if not usuario:
        return jsonify({'error': 'Código incorrecto o vencido'}), 400
    try:
        usuario.password_hash = bcrypt.generate_password_hash(nueva_password).decode('utf-8')
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception('No se pudo actualizar la contraseña')
        return jsonify({'error': 'No se pudo actualizar la contraseña'}), 500
    del codigos_recuperacion[email]
    return jsonify({'mensaje': 'Contraseña actualizada'}), 200
