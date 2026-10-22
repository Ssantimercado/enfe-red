import hashlib
import hmac
import secrets
from datetime import timedelta
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy import func
from database import db
from extensions import bcrypt
from models.acceso_models import CodigoRecuperacion, ahora_utc
from models.usuario_models import Usuario
from seguridad import crear_token_acceso, crear_tokens
from services.correo import enviar_correo_en_segundo_plano
from services.limites import borrar_intentos, ip_cliente, registrar_intento, supera_limite

# Creamos el "Blueprint" para las rutas de autenticación
auth_bp = Blueprint('auth', __name__)

# Recuperación: códigos de diez minutos, cinco intentos y un solo uso, guardados en la base.
VIGENCIA_CODIGO = timedelta(minutes=10)
MAX_INTENTOS_CODIGO = 5
# Límites por email dentro de una ventana: pedir un código nuevo no reinicia los
# intentos fallidos, así que no se puede adivinar el código pidiendo otro.
VENTANA_RECUPERACION = timedelta(minutes=30)
MAX_CODIGOS_POR_VENTANA = 3
MAX_FALLIDOS_POR_VENTANA = 10
# Por IP, para quien prueba con muchos emails (o muchas formas de escribir el mismo).
MAX_PEDIDOS_RECUPERACION_IP = 10
MAX_FALLIDOS_RECUPERACION_IP = 20
MENSAJE_LIMITE_RECUPERACION = 'Demasiados intentos. Esperá unos minutos y pedí un código nuevo.'
# Cambio de contraseña desde el perfil: frena a quien prueba claves con una sesión robada.
VENTANA_CAMBIO_PASSWORD = timedelta(minutes=15)
MAX_FALLIDOS_CAMBIO_PASSWORD = 5
MIN_PASSWORD, MAX_PASSWORD_BYTES = 8, 72  # bcrypt no admite más de 72 bytes.

# Se calcula una sola vez: comparar contra él tarda lo mismo que con una cuenta real.
_hash_ficticio = None


def error_password(password):
    """Mensaje de error de la contraseña, o None si es válida."""
    if not isinstance(password, str) or len(password) < MIN_PASSWORD:
        return f'La contraseña debe tener al menos {MIN_PASSWORD} caracteres'
    if len(password.encode('utf-8')) > MAX_PASSWORD_BYTES:
        return 'La contraseña es demasiado larga (máximo 72 caracteres)'
    return None


def normalizar_email(email):
    return email.strip().lower()


def buscar_usuario_por_email(email):
    # Sin distinguir mayúsculas: hay cuentas viejas guardadas tal como se escribieron.
    return Usuario.query.filter(func.lower(Usuario.email) == normalizar_email(email)).first()


def clave_de_cuenta(usuario, email):
    """Clave de los límites por cuenta.

    Con el id de la cuenta, todas las formas de escribir el mismo email (MySQL compara sin
    distinguir tildes) suman en el mismo contador. Sin cuenta, el email normalizado.
    """
    return f'usuario:{usuario.id}' if usuario else f'email:{email}'


def verificar_password(usuario, password):
    """True si la contraseña es la de la cuenta. Sin cuenta, igual hace el trabajo de bcrypt."""
    global _hash_ficticio
    if usuario is None:
        if _hash_ficticio is None:
            _hash_ficticio = bcrypt.generate_password_hash(secrets.token_urlsafe(16)).decode('utf-8')
        hash_a_comparar = _hash_ficticio
    else:
        hash_a_comparar = usuario.password_hash
    try:
        coincide = bcrypt.check_password_hash(hash_a_comparar, password)
    except ValueError:
        # bcrypt rechaza contraseñas de más de 72 bytes (o hashes inválidos): nunca coinciden.
        coincide = False
    return usuario is not None and coincide


def hash_codigo(usuario_id, codigo):
    # Con HMAC, quien lea la tabla no puede probar el millón de códigos posibles.
    secreto = (current_app.config.get('JWT_SECRET_KEY') or '').encode('utf-8')
    return hmac.new(secreto, f'{usuario_id}:{codigo}'.encode('utf-8'), hashlib.sha256).hexdigest()


def _texto_codigo(codigo):
    return (
        'Hola:\n\n'
        f'Tu código para crear una contraseña nueva en Enfered es: {codigo}\n\n'
        'Escribilo en la pantalla de recuperación. Vence en 10 minutos y sirve una sola vez.\n\n'
        'Si no lo pediste, ignorá este correo: tu contraseña no cambia.'
    )


@auth_bp.route('/recuperar-password', methods=['POST'])
def solicitar_recuperacion():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Datos inválidos'}), 400
    email = data.get('email')

    if not isinstance(email, str) or not email.strip():
        return jsonify({"error": "Falta el email"}), 400

    email = normalizar_email(email)
    ip = ip_cliente()
    # Frena los pedidos en masa (correos a la víctima o códigos para adivinar). No revela nada del email.
    if supera_limite('recuperacion_ip', ip, MAX_PEDIDOS_RECUPERACION_IP, VENTANA_RECUPERACION):
        return jsonify({'error': MENSAJE_LIMITE_RECUPERACION}), 429
    registrar_intento('recuperacion_ip', ip)
    ahora = ahora_utc()
    CodigoRecuperacion.query.filter(CodigoRecuperacion.vence <= ahora).delete(synchronize_session=False)
    usuario = buscar_usuario_por_email(email)
    clave = clave_de_cuenta(usuario, email)
    # La respuesta es siempre la misma para no revelar si el email existe o está limitado.
    if usuario and not supera_limite('recuperacion_codigo', clave, MAX_CODIGOS_POR_VENTANA, VENTANA_RECUPERACION):
        codigo = f'{secrets.randbelow(1000000):06d}'
        try:
            # Pedir otro código reemplaza al anterior.
            CodigoRecuperacion.query.filter_by(usuario_id=usuario.id).delete(synchronize_session=False)
            db.session.add(CodigoRecuperacion(
                usuario_id=usuario.id, codigo_hash=hash_codigo(usuario.id, codigo),
                vence=ahora + VIGENCIA_CODIGO, intentos=0,
            ))
            db.session.commit()
        except Exception:
            db.session.rollback()
            current_app.logger.exception('No se pudo guardar el código de recuperación')
        else:
            registrar_intento('recuperacion_codigo', clave)
            enviar_correo_en_segundo_plano(usuario.email, 'Tu código de Enfered', _texto_codigo(codigo))
    else:
        db.session.commit()

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
    email = normalizar_email(email)
    ip = ip_cliente()
    usuario = buscar_usuario_por_email(email)
    clave = clave_de_cuenta(usuario, email)
    registro = CodigoRecuperacion.query.filter_by(usuario_id=usuario.id).first() if usuario else None
    if supera_limite('recuperacion_fallido', clave, MAX_FALLIDOS_POR_VENTANA, VENTANA_RECUPERACION) or supera_limite(
        'recuperacion_fallido_ip', ip, MAX_FALLIDOS_RECUPERACION_IP, VENTANA_RECUPERACION
    ):
        if registro:
            db.session.delete(registro)
            db.session.commit()
        return jsonify({'error': MENSAJE_LIMITE_RECUPERACION}), 429
    if not registro or registro.vence <= ahora_utc():
        if registro:
            db.session.delete(registro)
        # Guarda también el borrado del código vencido.
        registrar_intento('recuperacion_fallido_ip', ip)
        return jsonify({'error': 'Código incorrecto o vencido'}), 400
    registro.intentos += 1
    if not hmac.compare_digest(registro.codigo_hash, hash_codigo(usuario.id, codigo.strip())):
        if registro.intentos >= MAX_INTENTOS_CODIGO:
            db.session.delete(registro)
        registrar_intento('recuperacion_fallido_ip', ip)
        # Guarda también el intento del código (o su borrado).
        registrar_intento('recuperacion_fallido', clave)
        return jsonify({"error": "Código incorrecto"}), 400
    # Con el código correcto, una contraseña inválida no lo consume: se puede corregir.
    mensaje = error_password(nueva_password)
    if mensaje:
        db.session.commit()
        return jsonify({'error': mensaje}), 400
    try:
        usuario.password_hash = bcrypt.generate_password_hash(nueva_password).decode('utf-8')
        # Cierra las sesiones abiertas en otros dispositivos.
        usuario.versionToken = (usuario.versionToken or 0) + 1
        db.session.delete(registro)
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception('No se pudo actualizar la contraseña')
        return jsonify({'error': 'No se pudo actualizar la contraseña'}), 500
    borrar_intentos('recuperacion_codigo', clave)
    borrar_intentos('recuperacion_fallido', clave)
    # Quien recuperó la clave tiene que poder entrar ya: el bloqueo del login (que le sugirió
    # recuperarla) se levanta. También es la salida si alguien bloquea la cuenta a propósito.
    borrar_intentos('login_email', clave)
    return jsonify({'mensaje': 'Contraseña actualizada'}), 200


@auth_bp.route('/token/refresh', methods=['POST'])
@jwt_required(refresh=True)
def renovar_token():
    # El blocklist ya rechazó cuentas suspendidas o tokens de una versión vieja.
    usuario = db.session.get(Usuario, int(get_jwt_identity()))
    if not usuario:
        return jsonify({'error': 'La sesión no es válida. Volvé a iniciar sesión.'}), 401
    return jsonify({'token': crear_token_acceso(usuario)}), 200


@auth_bp.route('/perfil/password', methods=['PUT'])
@jwt_required()
def cambiar_password():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'Datos inválidos'}), 400
    actual = data.get('password_actual')
    nueva = data.get('password_nueva')
    if not isinstance(actual, str) or not actual or not isinstance(nueva, str) or not nueva:
        return jsonify({'error': 'Completá tu contraseña actual y la nueva'}), 400
    usuario = db.session.get(Usuario, int(get_jwt_identity()))
    if not usuario:
        return jsonify({'error': 'La sesión no es válida. Volvé a iniciar sesión.'}), 401
    if supera_limite('cambio_password', usuario.id, MAX_FALLIDOS_CAMBIO_PASSWORD, VENTANA_CAMBIO_PASSWORD):
        return jsonify({'error': 'Hiciste muchos intentos. Esperá 15 minutos y probá de nuevo.'}), 429
    mensaje = error_password(nueva)
    if mensaje:
        return jsonify({'error': mensaje}), 400
    # 400 y no 401: un 401 haría que el frontend cierre la sesión.
    if not verificar_password(usuario, actual):
        registrar_intento('cambio_password', usuario.id)
        return jsonify({'error': 'La contraseña actual no es correcta'}), 400
    try:
        usuario.password_hash = bcrypt.generate_password_hash(nueva).decode('utf-8')
        usuario.versionToken = (usuario.versionToken or 0) + 1
        db.session.commit()
    except Exception:
        db.session.rollback()
        current_app.logger.exception('No se pudo cambiar la contraseña')
        return jsonify({'error': 'No se pudo cambiar la contraseña. Intentá nuevamente.'}), 500
    borrar_intentos('cambio_password', usuario.id)
    # Las otras sesiones se cierran; esta sigue con tokens nuevos.
    return jsonify({'mensaje': 'Contraseña actualizada', 'rol': usuario.rol, **crear_tokens(usuario)}), 200
