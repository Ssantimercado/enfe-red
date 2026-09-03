from flask import Flask
from flask_cors import CORS
from database import db
from routes.usuario_routes import usuario_bp

app = Flask(__name__)
# Esto permite que tu React en localhost:5173 se conecte sin problemas
CORS(app) 

# Configuración falsa de MySQL por ahora (para que no tire error al arrancar)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///test.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

# Registramos tus rutas de login
app.register_blueprint(usuario_bp)

if __name__ == '__main__':
    # Arrancamos el servidor en el puerto 5000
    app.run(debug=True, port=5000)