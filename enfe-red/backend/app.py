import os
from datetime import timedelta
from dotenv import load_dotenv
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from werkzeug.middleware.proxy_fix import ProxyFix

from cli_admin import registrar_comandos
from configuracion import configurar_encabezados, configurar_logging, entero_positivo, origenes_frontend
from database import db
from extensions import bcrypt
from routes.usuario_routes import usuario_bp
from routes.auth_routes import auth_bp
from routes.solicitud_routes import solicitud_bp
from routes.comunicacion_routes import comunicacion_bp
from routes.notificacion_routes import notificacion_bp
from routes.resena_routes import resena_bp
from routes.admin_routes import admin_bp
from routes.ia_routes import ia_bp
from routes.cuenta_routes import cuenta_bp
from routes.salud_routes import salud_bp
from preparar_bd import debe_preparar_al_arrancar, preparar_base
from seguridad import configurar_sesiones
from services.cifrado import configurar_cifrado

load_dotenv()
# Antes de crear la app, para que Flask y las librerías escriban en stdout con el mismo formato.
configurar_logging()

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
# Detrás de un proxy (nginx, Render, etc.) la IP real llega en X-Forwarded-For. Solo se le cree
# a esa cabecera si el proxy es nuestro: si no, cualquiera la inventa y esquiva los límites.
if os.getenv('PROXY_CONFIABLE') == '1':
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
# Solo el frontend del proyecto puede llamar a la API desde el navegador.
# Fuera de debug FRONTEND_ORIGINS es obligatorio; en debug se usa localhost:5173.
ORIGENES_FRONTEND = origenes_frontend()
CORS(app, origins=ORIGENES_FRONTEND)
configurar_encabezados(app)

# Configuración de base de datos y JWT
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = JWT_SECRET_KEY
# Token de acceso corto y uno de renovación largo: el frontend renueva sin pedir la clave.
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(minutes=entero_positivo('JWT_ACCESS_MINUTOS', 60))
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = timedelta(days=entero_positivo('JWT_REFRESH_DIAS', 30))
# Rechaza cuerpos enormes antes de procesarlos (comentarios, mensajes, perfiles).
app.config['MAX_CONTENT_LENGTH'] = 1024 * 1024

# Sin CLAVE_CIFRADO_DATOS, fuera de debug el backend no arranca (cifra el historial médico).
app.config['CLAVE_CIFRADO_DATOS'] = os.getenv('CLAVE_CIFRADO_DATOS', '')
configurar_cifrado(app)

# Inicialización de extensiones
db.init_app(app)
jwt = JWTManager(app)
bcrypt.init_app(app)

configurar_sesiones(jwt)

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
app.register_blueprint(ia_bp, url_prefix='/api')
app.register_blueprint(cuenta_bp, url_prefix='/api')
app.register_blueprint(salud_bp, url_prefix='/api')
registrar_comandos(app)

# En producción la base se prepara una vez por despliegue (flask --app app preparar-bd), no en cada
# worker al importar. En desarrollo (FLASK_DEBUG=1 o python app.py) sigue preparándose sola.
if debe_preparar_al_arrancar() or __name__ == '__main__':
    with app.app_context():
        preparar_base()

@app.route('/', methods=['GET'])
def home():
    return jsonify({'mensaje': 'Servidor corriendo correctamente'}), 200

if __name__ == '__main__':
    # Servidor de desarrollo. En producción: python serve.py (waitress).
    port = entero_positivo('PORT', 5000)
    # El debugger de Werkzeug permite ejecutar código: solo en desarrollo y a pedido.
    app.run(debug=os.getenv('FLASK_DEBUG') == '1', port=port)
