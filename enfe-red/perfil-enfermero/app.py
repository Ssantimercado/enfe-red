import os
from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

app = Flask(__name__)

CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JSON_AS_ASCII'] = False

db = SQLAlchemy(app)

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

    usuario = db.relationship('Usuario', backref='perfil_enfermero')
    disponibilidades = db.relationship('Disponibilidad', backref='enfermero', cascade="all, delete-orphan")

class Disponibilidad(db.Model):
    __tablename__ = 'disponibilidades'

    id = db.Column(db.Integer, primary_key=True)
    enfermero_id = db.Column(db.Integer, db.ForeignKey('enfermeros.id'), nullable=False)
    dia_semana = db.Column(db.String(20), nullable=False)
    hora_inicio = db.Column(db.Time, nullable=False)
    hora_fin = db.Column(db.Time, nullable=False)
    estado = db.Column(db.String(20), default='Disponible')  # 'Disponible', 'Ocupado', 'En Pausa'

    def to_dict(self):
        return {
            'id': self.id,
            'enfermero_id': self.enfermero_id,
            'dia_semana': self.dia_semana,
            'hora_inicio': self.hora_inicio.strftime('%H:%M'),
            'hora_fin': self.hora_fin.strftime('%H:%M'),
            'estado': self.estado
        }

with app.app_context():
    db.create_all()

# --- ENDPOINTS ---

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

@app.route('/api/enfermeros/<int:enfermero_id>/disponibilidades', methods=['GET'])
def get_disponibilidades(enfermero_id):
    disponibilidades = Disponibilidad.query.filter_by(enfermero_id=enfermero_id).all()
    return jsonify({
        'enfermero_id': enfermero_id,
        'disponibilidades': [d.to_dict() for d in disponibilidades]
    }), 200

@app.route('/api/disponibilidades', methods=['POST'])
def crear_disponibilidad():
    data = request.get_json() or {}
    enfermero_id = data.get('enfermero_id')
    dia_semana = data.get('dia_semana')
    str_inicio = data.get('hora_inicio')
    str_fin = data.get('hora_fin')
    estado = data.get('estado', 'Disponible')

    if not all([enfermero_id, dia_semana, str_inicio, str_fin]):
        return jsonify({'error': 'Faltan campos obligatorios'}), 400

    try:
        hora_inicio = datetime.strptime(str_inicio, '%H:%M').time()
        hora_fin = datetime.strptime(str_fin, '%H:%M').time()
    except ValueError:
        return jsonify({'error': 'Formato de hora inválido. Use HH:MM'}), 400

    if hora_inicio >= hora_fin:
        return jsonify({'error': 'La hora de inicio debe ser menor a la hora de fin'}), 400

    # Solapamientos
    existentes = Disponibilidad.query.filter_by(enfermero_id=enfermero_id, dia_semana=dia_semana).all()
    for disp in existentes:
        if not (hora_fin <= disp.hora_inicio or hora_inicio >= disp.hora_fin):
            return jsonify({'error': 'El horario se solapa con otro rango existente'}), 400

    nueva_disp = Disponibilidad(
        enfermero_id=enfermero_id,
        dia_semana=dia_semana,
        hora_inicio=hora_inicio,
        hora_fin=hora_fin,
        estado=estado
    )
    db.session.add(nueva_disp)
    db.session.commit()

    return jsonify({'mensaje': 'Creado exitosamente', 'disponibilidad': nueva_disp.to_dict()}), 201

@app.route('/api/disponibilidades/<int:id>', methods=['PUT'])
def actualizar_disponibilidad(id):
    disp = Disponibilidad.query.get(id)
    if not disp:
        return jsonify({'error': 'No encontrado'}), 404

    data = request.get_json() or {}
    dia_semana = data.get('dia_semana', disp.dia_semana)
    str_inicio = data.get('hora_inicio')
    str_fin = data.get('hora_fin')
    disp.estado = data.get('estado', disp.estado)

    if str_inicio and str_fin:
        try:
            hora_inicio = datetime.strptime(str_inicio, '%H:%M').time()
            hora_fin = datetime.strptime(str_fin, '%H:%M').time()
            if hora_inicio >= hora_fin:
                return jsonify({'error': 'La hora de inicio debe ser menor a la de fin'}), 400
            
            existentes = Disponibilidad.query.filter(
                Disponibilidad.enfermero_id == disp.enfermero_id,
                Disponibilidad.dia_semana == dia_semana,
                Disponibilidad.id != id
            ).all()

            for item in existentes:
                if not (hora_fin <= item.hora_inicio or hora_inicio >= item.hora_fin):
                    return jsonify({'error': 'El horario se solapa'}), 400

            disp.hora_inicio = hora_inicio
            disp.hora_fin = hora_fin
        except ValueError:
            return jsonify({'error': 'Formato HH:MM inválido'}), 400

    disp.dia_semana = dia_semana
    db.session.commit()

    return jsonify({'mensaje': 'Actualizado correctamente', 'disponibilidad': disp.to_dict()}), 200

@app.route('/api/disponibilidades/<int:id>', methods=['DELETE'])
def eliminar_disponibilidad(id):
    disp = Disponibilidad.query.get(id)
    if not disp:
        return jsonify({'error': 'No encontrado'}), 404
    db.session.delete(disp)
    db.session.commit()
    return jsonify({'mensaje': 'Eliminado correctamente', 'id_eliminado': id}), 200

if __name__ == '__main__':
    app.run(debug=True, port=5000)