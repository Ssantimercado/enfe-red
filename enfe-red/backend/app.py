import os
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from cli_admin import registrar_comandos
from database import db
from extensions import bcrypt
from routes.usuario_routes import usuario_bp
from routes.auth_routes import auth_bp
from routes.solicitud_routes import solicitud_bp
from routes.comunicacion_routes import comunicacion_bp
from routes.notificacion_routes import notificacion_bp
from routes.resena_routes import resena_bp
from routes.admin_routes import admin_bp
from schema_sprint4 import inicializar_bd_sprint4, inicializar_catalogo_servicios
from schema_sprint6 import inicializar_bd_sprint6
from schema_legal import inicializar_bd_legal
from seed_sprint3 import inicializar_bd_sprint3

load_dotenv()

# Sin valor por defecto: una clave escrita en el repositorio permitiría falsificar tokens.
JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', '')
if len(JWT_SECRET_KEY) < 32:
    raise RuntimeError(
        'Falta JWT_SECRET_KEY (mínimo 32 caracteres) en backend/.env. '
        'Generala con: python -c "import secrets; print(secrets.token_urlsafe(48))"'
    )
if not os.getenv('DATABASE_URL'):
    raise RuntimeError('Falta DATABASE_URL en backend/.env (ver .env.example).')

app = Flask(__name__)
# Solo el frontend del proyecto puede llamar a la API desde el navegador.
ORIGENES_FRONTEND = [
    origen.strip()
    for origen in os.getenv('FRONTEND_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',')
    if origen.strip()
]
CORS(app, origins=ORIGENES_FRONTEND)

# Configuración de base de datos y JWT
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
# Rechaza cuerpos enormes antes de procesarlos (comentarios, mensajes, perfiles).
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024

# Inicialización de extensiones
db.init_app(app)
jwt = JWTManager(app)
bcrypt.init_app(app)

@jwt.invalid_token_loader
def token_invalido(_motivo):
    return jsonify({'error': 'La sesión no es válida. Volvé a iniciar sesión.'}), 401

# Registro de Blueprints del equipo
app.register_blueprint(usuario_bp, url_prefix='/api')
app.register_blueprint(auth_bp, url_prefix='/api')
app.register_blueprint(solicitud_bp, url_prefix='/api')
app.register_blueprint(comunicacion_bp, url_prefix='/api')
app.register_blueprint(notificacion_bp, url_prefix='/api')
app.register_blueprint(resena_bp, url_prefix='/api')
app.register_blueprint(admin_bp, url_prefix='/api')
registrar_comandos(app)

# Prepara el esquema de solicitudes antes de consultar/sembrar los perfiles existentes.
with app.app_context():
    inicializar_bd_sprint4()
    inicializar_bd_sprint6()
    inicializar_bd_legal()
    inicializar_bd_sprint3()
    inicializar_catalogo_servicios()

@app.route('/', methods=['GET'])
def home():
    return jsonify({'mensaje': 'Servidor corriendo correctamente'}), 200

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    # El debugger de Werkzeug permite ejecutar código: solo en desarrollo y a pedido.
    app.run(debug=os.getenv('FLASK_DEBUG') == '1', port=port)
