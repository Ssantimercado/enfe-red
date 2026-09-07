import os
from flask import Flask, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)  # Permite peticiones desde React

# Configuración de PostgreSQL / Supabase
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JSON_AS_ASCII'] = False

db = SQLAlchemy(app)

# Modelo ORM - Usuarios
class Usuario(db.Model):
    __tablename__ = 'usuarios'
    
    id = db.Column(db.BigInteger, primary_key=True)
    email = db.Column(db.String)
    password_hash = db.Column(db.String)
    tipo_usuario = db.Column(db.String)
    nombre = db.Column(db.String)
    apellido = db.Column(db.String)
    telefono = db.Column(db.String)
    fecha_registro = db.Column(db.DateTime)
    activo = db.Column(db.Boolean, default=True)

# Modelo ORM - Enfermeros
class Enfermero(db.Model):
    __tablename__ = 'enfermeros'
    
    id = db.Column(db.BigInteger, primary_key=True)
    usuario_id = db.Column(db.BigInteger, db.ForeignKey('usuarios.id'))
    matricula_profesional = db.Column(db.String)
    especialidad = db.Column(db.String)
    experiencia_anios = db.Column(db.Integer)
    descripcion = db.Column(db.Text)
    direccion = db.Column(db.String)
    ciudad = db.Column(db.String)
    disponible = db.Column(db.Boolean, default=True)

    # Relación con el usuario
    usuario = db.relationship('Usuario', backref='perfil_enfermero')

@app.route('/api/perfil/<int:id>', methods=['GET'])
def get_perfil(id):
    enfermero = Enfermero.query.get(id)
    if not enfermero:
        return jsonify({'error': 'Enfermero no encontrado'}), 404
        
    return jsonify({
        'id': enfermero.id,
        'usuario_id': enfermero.usuario_id,
        'nombre': enfermero.usuario.nombre if enfermero.usuario else None,
        'apellido': enfermero.usuario.apellido if enfermero.usuario else None,
        'email': enfermero.usuario.email if enfermero.usuario else None,
        'telefono': enfermero.usuario.telefono if enfermero.usuario else None,
        'matricula_profesional': enfermero.matricula_profesional,
        'especialidad': enfermero.especialidad,
        'experiencia_anios': enfermero.experiencia_anios,
        'descripcion': enfermero.descripcion,
        'direccion': enfermero.direccion,
        'ciudad': enfermero.ciudad,
        'disponible': enfermero.disponible
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)