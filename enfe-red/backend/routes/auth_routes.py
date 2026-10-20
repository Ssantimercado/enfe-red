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
# Límites por email dentro de una ventana: pedir un código nuevo no reinicia los
# intentos fallidos, así que no se puede adivinar el código pidiendo otro.
limites_recuperacion = {}
VENTANA_RECUPERACION = timedelta(minutes=30)
MAX_CODIGOS_POR_VENTANA = 3
MAX_FALLIDOS_POR_VENTANA = 10
MIN_PASSWORD, MAX_PASSWORD_BYTES = 8, 72  # bcrypt no admite más de 72 bytes.


def _limite(email, ahora):
    registro = limites_recuperacion.get(email)
    if not registro or registro['desde'] + VENTANA_RECUPERACION <= ahora:
        registro = {'desde': ahora, 'codigos': 0, 'fallidos': 0}
        limites_recuperacion[email] = registro
    return registro


def error_password(password):
    """Mensaje de error de la contraseña, o None si es válida."""
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        return f'La contraseña debe tener al menos {MIN_PASSWORD} caracteres'
    if len(password.encode('utf-8')) > MAX_PASSWORD_BYTES:
        return 'La contraseña es demasiado larga (máximo 72 caracteres)'
    return None


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
    limite = _limite(email, ahora)
    # La respuesta es siempre la misma para no revelar si el email existe o está limitado.
    if limite['codigos'] < MAX_CODIGOS_POR_VENTANA and Usuario.query.filter_by(email=email).first():
        limite['codigos'] += 1
        codigo = f'{secrets.randbelow(1000000):06d}'
        codigos_recuperacion[email] = {
            'codigo': codigo, 'vence': ahora + timedelta(minutes=10), 'intentos': 0,
        }
        # Sin correo integrado, el código se muestra en la consola solo en desarrollo.
        if current_app.debug:
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
    ahora = datetime.now(timezone.utc)
    limite = _limite(email, ahora)
    if limite['fallidos'] >= MAX_FALLIDOS_POR_VENTANA:
        codigos_recuperacion.pop(email, None)
        return jsonify({'error': 'Demasiados intentos. Esperá unos minutos y pedí un código nuevo.'}), 429
    registro = codigos_recuperacion.get(email)
    if not registro or registro['vence'] <= ahora:
        codigos_recuperacion.pop(email, None)
        return jsonify({'error': 'Código incorrecto o vencido'}), 400
    registro['intentos'] += 1
    if not secrets.compare_digest(registro['codigo'].encode(), codigo.strip().encode()):
        limite['fallidos'] += 1
        if registro['intentos'] >= 5:
            codigos_recuperacion.pop(email, None)
        return jsonify({"error": "Código incorrecto"}), 400
    # Con el código correcto, una contraseña inválida no lo consume: se puede corregir.
    mensaje = error_password(nueva_password)
    if mensaje:
        return jsonify({'error': mensaje}), 400
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
    codigos_recuperacion.pop(email, None)
    limites_recuperacion.pop(email, None)
    return jsonify({'mensaje': 'Contraseña actualizada'}), 200
