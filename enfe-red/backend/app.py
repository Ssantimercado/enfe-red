import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
import pymysql

from database import db
from extensions import bcrypt
from routes.usuario_routes import usuario_bp

load_dotenv()

app = Flask(__name__)
CORS(app)

# Configuración de base de datos y JWT
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'mysql+pymysql://root:root@localhost/enfe_red')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'clave_secreta_super_segura_para_enfered_2026_32bytes')

# Inicialización de extensiones
db.init_app(app)
jwt = JWTManager(app)
bcrypt.init_app(app)

# Registro de Blueprints del equipo (ej. login, autenticación)
app.register_blueprint(usuario_bp, url_prefix='/api')


# Función para conexión directa PyMySQL
def get_db_connection():
    return pymysql.connect(
        host=os.getenv('DB_HOST', 'localhost'),
        user=os.getenv('DB_USER', 'root'),
        password=os.getenv('DB_PASSWORD', 'root'),
        database=os.getenv('DB_NAME', 'enfe_red'),
        cursorclass=pymysql.cursors.DictCursor
    )


# Ruta raíz de prueba
@app.route('/', methods=['GET'])
def home():
    return jsonify({'mensaje': 'Servidor corriendo correctamente'}), 200




# ==========================================================
# RUTAS PARA EL PERFIL DE PACIENTE (SPRINT 2)
# ==========================================================

# OBTENER PERFIL DE PACIENTE (GET)
@app.route('/api/perfil/paciente', methods=['GET'])
@jwt_required()
def obtener_perfil_paciente():
    usuario_id = get_jwt_identity()
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            sql = """
                SELECT u.id, u.nombre, u.apellido, u.email, p.telefono, p.direccion, p.historial_medico
                FROM usuarios u
                LEFT JOIN pacientes p ON u.id = p.usuario_id
                WHERE u.id = %s
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
@app.route('/api/perfil/paciente', methods=['PUT'])
@jwt_required()
def actualizar_perfil_paciente():
    usuario_id = get_jwt_identity()
    datos = request.get_json() or {}
    
    nombre = datos.get('nombre')
    apellido = datos.get('apellido')
    telefono = datos.get('telefono')
    direccion = datos.get('direccion')
    historial_medico = datos.get('historial_medico')

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            if nombre or apellido:
                cursor.execute(
                    "UPDATE usuarios SET nombre = %s, apellido = %s WHERE id = %s", 
                    (nombre, apellido, usuario_id)
                )

            cursor.execute("SELECT id FROM pacientes WHERE usuario_id = %s", (usuario_id,))
            existe_paciente = cursor.fetchone()

            if existe_paciente:
                sql_update = """
                    UPDATE pacientes 
                    SET telefono = %s, direccion = %s, historial_medico = %s 
                    WHERE usuario_id = %s
                """
                cursor.execute(sql_update, (telefono, direccion, historial_medico, usuario_id))
            else:
                sql_insert = """
                    INSERT INTO pacientes (usuario_id, telefono, direccion, historial_medico) 
                    VALUES (%s, %s, %s, %s)
                """
                cursor.execute(sql_insert, (usuario_id, telefono, direccion, historial_medico))

            connection.commit()
            
            cursor.execute("""
                SELECT u.id, u.nombre, u.apellido, u.email, p.telefono, p.direccion, p.historial_medico
                FROM usuarios u
                LEFT JOIN pacientes p ON u.id = p.usuario_id
                WHERE u.id = %s
            """, (usuario_id,))
            paciente_actualizado = cursor.fetchone()

            return jsonify(paciente_actualizado), 200

    except Exception as e:
        connection.rollback()
        return jsonify({'error': f'Error al actualizar el perfil: {str(e)}'}), 500
    finally:
        connection.close()


if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    app.run(debug=True, port=port)