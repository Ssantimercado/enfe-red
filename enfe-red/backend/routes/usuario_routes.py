from flask import Blueprint, request, jsonify
import jwt
import datetime

from database import db
from models.usuario_models import Usuario 

usuario_bp = Blueprint('usuario_bp', __name__)
SECRET_KEY = "clave_secreta_enfered"

# ==========================================
# 1. RUTA DE LOGIN (Pablo)
# ==========================================
@usuario_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Faltan datos"}), 400

    if email == "pablo@test.com" and password == "123456":
        token = jwt.encode({
            'user_id': 1,
            'rol': 'enfermero',
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2)
        }, SECRET_KEY, algorithm="HS256")

        return jsonify({"mensaje": "Login exitoso", "token": token}), 200
    else:
        return jsonify({"error": "Credenciales incorrectas"}), 401


# ==========================================
# 2. RUTA DE REGISTRO (Germán - SCRUM-5)
# ==========================================
@usuario_bp.route('/registro', methods=['POST'])
def registrar_usuario():
    data = request.get_json()
    
    # Extraer campos que vienen del formulario en React
    nombre = data.get('nombre')
    email = data.get('email')
    password = data.get('password')
    rol = data.get('rol', 'paciente') # Rol por defecto si no viene

    if not nombre or not email or not password:
        return jsonify({"error": "Todos los campos son obligatorios"}), 400

    # Verificar si el email ya existe en la base de datos
    usuario_existente = Usuario.query.filter_by(email=email).first()
    if usuario_existente:
        return jsonify({"error": "El email ya está registrado"}), 400

    # Crear nuevo usuario e insertarlo en MySQL mediante SQLAlchemy
    nuevo_usuario = Usuario(
        nombre=nombre,
        email=email,
        password=password, # Idealmente hasheado si ya usan werkzeug.security
        rol=rol
    )

    try:
        db.session.add(nuevo_usuario)
        db.session.commit()
        return jsonify({"mensaje": "Usuario registrado exitosamente"}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Error al guardar el usuario", "detalle": str(e)}), 500