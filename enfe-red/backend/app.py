from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from database import db
from extensions import bcrypt
from routes.usuario_routes import usuario_bp

app = Flask(__name__)

# Permite peticiones desde el frontend en React
CORS(app)

# Configuración de base de datos y JWT
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+pymysql://root:root@localhost/enfe_red'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = 'clave_secreta_enfered'  # Requerido para firmar los tokens JWT

# Inicialización de extensiones
db.init_app(app)
jwt = JWTManager(app)
bcrypt.init_app(app)

# Ruta raíz para verificar que el servidor está corriendo (soluciona el 404 al entrar a /)
@app.route('/', methods=['GET'])
def health_check():
    return jsonify({"mensaje": "API de EnfeRed funcionando correctamente"}), 200

# Registro de rutas con prefijo /api
app.register_blueprint(usuario_bp, url_prefix='/api')

# Creación automática de tablas si no existen
with app.app_context():
    db.create_all()

if __name__ == '__main__':
    app.run(debug=True, port=5000)