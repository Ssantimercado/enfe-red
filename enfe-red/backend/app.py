import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from database import db
from extensions import bcrypt
from routes.usuario_routes import usuario_bp

app = Flask(__name__)
CORS(app)

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
def home():
    return jsonify({'mensaje': 'Servidor corriendo correctamente'}), 200

# 2. Ruta de registro (POST)
@app.route('/api/registro', methods=['POST'])
def registrar_usuario():
    datos = request.get_json() or {}
    
    nombre = datos.get('nombre')
    email = datos.get('email')
    password = datos.get('password')
    rol = datos.get('rol')

    if not nombre or not email or not password or not rol:
        return jsonify({'mensaje': 'Todos los campos son obligatorios'}), 400

    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed_password = bcrypt.hashpw(password_bytes, salt).decode('utf-8')

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM usuarios WHERE email = %s", (email,))
            if cursor.fetchone():
                return jsonify({'mensaje': 'El email ya está registrado'}), 400

            sql = "INSERT INTO usuarios (nombre, email, password, rol) VALUES (%s, %s, %s, %s)"
            cursor.execute(sql, (nombre, email, hashed_password, rol))
            connection.commit()

        return jsonify({'mensaje': 'Usuario registrado exitosamente'}), 201

    except Exception as e:
        return jsonify({'mensaje': f'Error en el servidor: {str(e)}'}), 500
    finally:
        connection.close()


# ==========================================================
# 3. RUTAS PARA EL PERFIL DE PACIENTE (SPRINT 2)
# ==========================================================

# OBTENER PERFIL DE PACIENTE (GET)
@app.route('/api/perfil/paciente/<int:usuario_id>', methods=['GET'])
def obtener_perfil_paciente(usuario_id):
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            # Traemos datos del usuario y los complementamos con la tabla de pacientes si existe
            sql = """
                SELECT u.id, u.nombre, u.email, p.telefono, p.direccion, p.historial_medico
                FROM usuarios u
                LEFT JOIN pacientes p ON u.id = p.usuario_id
                WHERE u.id = %s AND u.rol = 'paciente'
            """
            cursor.execute(sql, (usuario_id,))
            paciente = cursor.fetchone()

            if not paciente:
                return jsonify({'error': 'Paciente no encontrado'}), 404

            return jsonify(paciente), 200

    except Exception as e:
        return jsonify({'error': f'Error en el servidor: {str(e)}'}), 500
    finally:
        connection.close()


# ACTUALIZAR PERFIL DE PACIENTE (PUT)
@app.route('/api/perfil/paciente/<int:usuario_id>', methods=['PUT'])
def actualizar_perfil_paciente(usuario_id):
    datos = request.get_json() or {}
    
    nombre = datos.get('nombre')
    telefono = datos.get('telefono')
    direccion = datos.get('direccion')
    historial_medico = datos.get('historial_medico')

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            # 1. Actualizamos el nombre en la tabla principal de usuarios
            if nombre:
                cursor.execute("UPDATE usuarios SET nombre = %s WHERE id = %s", (nombre, usuario_id))

            # 2. Verificamos si ya existe el registro en la tabla pacientes
            cursor.execute("SELECT id FROM pacientes WHERE usuario_id = %s", (usuario_id,))
            existe_paciente = cursor.fetchone()

            if existe_paciente:
                # Si existe, actualizamos los datos
                sql_update = """
                    UPDATE pacientes 
                    SET telefono = %s, direccion = %s, historial_medico = %s 
                    WHERE usuario_id = %s
                """
                cursor.execute(sql_update, (telefono, direccion, historial_medico, usuario_id))
            else:
                # Si no existe, creamos la fila del perfil en la tabla pacientes
                sql_insert = """
                    INSERT INTO pacientes (usuario_id, telefono, direccion, historial_medico) 
                    VALUES (%s, %s, %s, %s)
                """
                cursor.execute(sql_insert, (usuario_id, telefono, direccion, historial_medico))

            connection.commit()
            return jsonify({'mensaje': 'Perfil de paciente actualizado correctamente'}), 200

    except Exception as e:
        connection.rollback()
        return jsonify({'error': f'Error al actualizar el perfil: {str(e)}'}), 500
    finally:
        connection.close()


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(debug=True, port=port)