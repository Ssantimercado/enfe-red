from flask import Blueprint, request, jsonify
import jwt
import datetime

from database import db
from models.usuario_models import Usuario 

usuario_bp = Blueprint('usuario_bp', __name__)
SECRET_KEY = "clave_secreta_enfered"

@usuario_bp.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Faltan datos"}), 400

    # --- USUARIO DE PRUEBA (MOCK) ---
    # Cuando conectes MySQL, borrarás esto y usarás: 
    # usuario = Usuario.query.filter_by(email=email).first()
    # --------------------------------
    if email == "pablo@test.com" and password == "123456":
        # Simulamos que las credenciales son correctas
        token = jwt.encode({
            'user_id': 1,
            'rol': 'enfermero',
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=2)
        }, SECRET_KEY, algorithm="HS256")

        return jsonify({"mensaje": "Login exitoso", "token": token}), 200
    else:
        # Si pone otra cosa, le tiramos error
        return jsonify({"error": "Credenciales incorrectas"}), 401