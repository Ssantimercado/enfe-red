import os
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from database import db
from extensions import bcrypt
from routes.usuario_routes import usuario_bp
from seed_sprint3 import inicializar_bd_sprint3

load_dotenv()

app = Flask(__name__)
CORS(app)

# Configuración de base de datos y JWT
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'clave_secreta_super_segura_para_enfered_2026_32bytes')

# Inicialización de extensiones
db.init_app(app)
jwt = JWTManager(app)
bcrypt.init_app(app)

# Registro de Blueprints del equipo
app.register_blueprint(usuario_bp, url_prefix='/api')

# Crea tablas, agrega columnas nuevas del Sprint 3 y carga datos de prueba automáticamente
with app.app_context():
    db.create_all()
    inicializar_bd_sprint3()

@app.route('/', methods=['GET'])
def home():
    return jsonify({'mensaje': 'Servidor corriendo correctamente'}), 200

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(debug=True, port=port)