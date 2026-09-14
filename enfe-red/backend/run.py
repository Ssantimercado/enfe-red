from flask import Flask
from flask_cors import CORS

# Importamos las rutas que armaste vos en tu archivo auth_routes.py
from app.routes.auth_routes import auth_bp

app = Flask(__name__)

# Habilitamos CORS para que React (puerto 5173) se pueda comunicar sin problemas
CORS(app)

# Registramos tu Blueprint para que las rutas empiecen con "/api"
app.register_blueprint(auth_bp, url_prefix='/api')

if __name__ == '__main__':
    print("🚀 Servidor de Enfe-Red corriendo en http://localhost:5000")
    app.run(debug=True, port=5000)