import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
import bcrypt
import pymysql

load_dotenv()

app = Flask(__name__)
CORS(app)

def get_db_connection():
    return pymysql.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASSWORD', 'Leoncio0'),
        database=os.getenv('DB_NAME', 'enfered_db'),
        cursorclass=pymysql.cursors.DictCursor
    )

# 1. Ruta base para probar en el navegador (GET)
@app.route('/', methods=['GET'])
def home():
    return jsonify({'mensaje': 'Servidor corriendo correctamente'}), 200

# 2. Ruta de registro para Postman/Thunder Client/React (POST)
@app.route('/api/registro', methods=['POST'])
def registrar_usuario():
    datos = request.get_json() or {}
    
    nombre = datos.get('nombre')
    email = datos.get('email')
    password = datos.get('password')
    rol = datos.get('rol')

    if not nombre or not email or not password or not rol:
        return jsonify({'mensaje': 'Todos los campos son obligatorios'}), 400

    # Encriptación de contraseña
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password_bytes, salt).decode('utf-8')

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            # Comprobar si el usuario existe
            cursor.execute("SELECT id FROM usuarios WHERE email = %s", (email,))
            if cursor.fetchone():
                return jsonify({'mensaje': 'El email ya está registrado'}), 400

            # Insertar registro
            sql = "INSERT INTO usuarios (nombre, email, password, rol) VALUES (%s, %s, %s, %s)"
            cursor.execute(sql, (nombre, email, hashed_password, rol))
            connection.commit()

        return jsonify({'mensaje': 'Usuario registrado exitosamente'}), 201

    except Exception as e:
        return jsonify({'mensaje': f'Error en el servidor: {str(e)}'}), 500
    finally:
        connection.close()

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(debug=True, port=port)