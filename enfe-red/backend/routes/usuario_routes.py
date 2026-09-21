from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token

from database import db
from extensions import bcrypt
from models.usuario_models import Usuario, Paciente, Enfermero

usuario_bp = Blueprint('usuario_bp', __name__)


# ==========================================
# 1. RUTA DE LOGIN (Pablo)
# ==========================================
@usuario_bp.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Faltan datos"}), 400

    # Buscamos el usuario real en la base de datos
    usuario = Usuario.query.filter_by(email=email).first()

    # Usamos bcrypt.check_password_hash para validar la contraseña
    if not usuario or not bcrypt.check_password_hash(usuario.password_hash, password):
        return jsonify({"error": "Credenciales incorrectas"}), 401
    
    token = create_access_token(
        identity=str(usuario.id),
        additional_claims={"rol": usuario.rol}
    )

    return jsonify({"mensaje": "Login exitoso", "token": token, "rol": usuario.rol}), 200


# ==========================================
# 2. RUTA DE REGISTRO (Germán - SCRUM-5)
# ==========================================
@usuario_bp.route('/registro', methods=['POST'])
def registrar_usuario():
    data = request.get_json()

    nombre = data.get('nombre')
    apellido = data.get('apellido', '')
    email = data.get('email')
    password = data.get('password')
    rol = data.get('rol', 'paciente')

    if not nombre or not email or not password:
        return jsonify({"error": "Todos los campos son obligatorios"}), 400

    usuario_existente = Usuario.query.filter_by(email=email).first()
    if usuario_existente:
        return jsonify({"error": "El email ya está registrado"}), 400

    password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    nuevo_usuario = Usuario(
        email=email,
        password_hash=password_hash,
        rol=rol
    )

    try:
        db.session.add(nuevo_usuario)
        db.session.flush()

        if rol == 'paciente':
            nuevo_perfil = Paciente(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido
            )
        elif rol == 'enfermero':
            matricula = data.get('matricula', '')
            especialidad = data.get('especialidad', '')
            nuevo_perfil = Enfermero(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido,
                matricula=matricula,
                especialidad=especialidad
            )
        else:
            db.session.rollback()
            return jsonify({"error": "Rol inválido"}), 400

        db.session.add(nuevo_perfil)
        db.session.commit()
        return jsonify({"mensaje": "Usuario registrado exitosamente"}), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Error al guardar el usuario", "detalle": str(e)}), 500


# ==========================================
# 3. VISTA "MI PERFIL" DE PACIENTE (Pablo)
# ==========================================
@usuario_bp.route('/perfil/paciente', methods=['GET'])
@jwt_required()
def obtener_perfil_paciente():
    usuario_id = int(get_jwt_identity())

    usuario = Usuario.query.get(usuario_id)
    if not usuario or usuario.rol != 'paciente':
        return jsonify({"error": "Perfil no encontrado o acceso denegado"}), 404

    paciente = Paciente.query.filter_by(usuario_id=usuario_id).first()

    datos_completos = usuario.to_dict()

    if not paciente:
        datos_completos.update({
            "nombre": "Falta configurar",
            "apellido": "",
            "direccion": "No registrada",
            "telefono": "No registrado",
            "historial_medico": "Sin datos"
        })
    else:
        datos_completos.update(paciente.to_dict())

    return jsonify(datos_completos), 200


# ==========================================
# 4. VISTA "MI PERFIL" DE ENFERMERO (propio usuario logueado)
# ==========================================
@usuario_bp.route('/perfil/enfermero', methods=['GET'])
@jwt_required()
def obtener_perfil_enfermero():
    usuario_id = int(get_jwt_identity())

    usuario = Usuario.query.get(usuario_id)
    if not usuario or usuario.rol != 'enfermero':
        return jsonify({"error": "Perfil no encontrado o acceso denegado"}), 404

    enfermero = Enfermero.query.filter_by(usuario_id=usuario_id).first()

    datos_completos = usuario.to_dict()

    if not enfermero:
        datos_completos.update({
            "nombre": "Falta configurar",
            "apellido": "",
            "matricula": "No registrada",
            "especialidad": "No especificada"
        })
    else:
        datos_completos.update(enfermero.to_dict())

    return jsonify(datos_completos), 200


# ==========================================
# 5. VISTA PERFIL DE ENFERMERO PÚBLICO (Santiago - SCRUM visualización)
# ==========================================
@usuario_bp.route('/usuarios/<int:id>', methods=['GET'])
def ver_perfil_enfermero(id):
    usuario = Usuario.query.get(id)

    if not usuario or usuario.rol != 'enfermero':
        return jsonify({"error": "Perfil de enfermero no encontrado"}), 404

    enfermero = Enfermero.query.filter_by(usuario_id=id).first()

    datos_completos = usuario.to_dict()

    if not enfermero:
        datos_completos.update({
            "nombre": "Falta configurar",
            "apellido": "",
            "matricula": "No registrada",
            "especialidad": "No especificada"
        })
    else:
        datos_completos.update(enfermero.to_dict())

    return jsonify(datos_completos), 200


# ==========================================
# 6. EDITAR "MI PERFIL" - PACIENTE (Renzo)
# ==========================================
@usuario_bp.route('/perfil/paciente', methods=['PUT'])
@jwt_required()
def actualizar_perfil_paciente():
    usuario_id = int(get_jwt_identity())
    data = request.get_json()

    usuario = Usuario.query.get(usuario_id)
    if not usuario or usuario.rol != 'paciente':
        return jsonify({"error": "Perfil no encontrado o acceso denegado"}), 404

    paciente = Paciente.query.filter_by(usuario_id=usuario_id).first()
    if not paciente:
        paciente = Paciente(usuario_id=usuario_id)
        db.session.add(paciente)

    paciente.nombre = data.get('nombre', paciente.nombre)
    paciente.apellido = data.get('apellido', paciente.apellido)
    paciente.telefono = data.get('telefono', paciente.telefono)
    paciente.direccion = data.get('direccion', paciente.direccion)
    paciente.historial_medico = data.get('historial_medico', paciente.historial_medico)

    try:
        db.session.commit()
        datos_completos = usuario.to_dict()
        datos_completos.update(paciente.to_dict())
        return jsonify(datos_completos), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Error al actualizar", "detalle": str(e)}), 500


# ==========================================
# 7. EDITAR "MI PERFIL" - ENFERMERO (Renzo)
# ==========================================
@usuario_bp.route('/perfil/enfermero', methods=['PUT'])
@jwt_required()
def actualizar_perfil_enfermero():
    usuario_id = int(get_jwt_identity())
    data = request.get_json()

    usuario = Usuario.query.get(usuario_id)
    if not usuario or usuario.rol != 'enfermero':
        return jsonify({"error": "Perfil no encontrado o acceso denegado"}), 404

    enfermero = Enfermero.query.filter_by(usuario_id=usuario_id).first()
    if not enfermero:
        enfermero = Enfermero(usuario_id=usuario_id, matricula=data.get('matricula', ''))
        db.session.add(enfermero)

    enfermero.nombre = data.get('nombre', enfermero.nombre)
    enfermero.apellido = data.get('apellido', enfermero.apellido)
    enfermero.especialidad = data.get('especialidad', enfermero.especialidad)

    try:
        db.session.commit()
        datos_completos = usuario.to_dict()
        datos_completos.update(enfermero.to_dict())
        return jsonify(datos_completos), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": "Error al actualizar", "detalle": str(e)}), 500

# ==========================================
# 8. LISTA DE ENFERMEROS (Para la cartilla del paciente)
# ==========================================
@usuario_bp.route('/enfermeros', methods=['GET', 'OPTIONS'])
@jwt_required()
def obtener_todos_los_enfermeros():
    # Si es una petición OPTIONS de CORS (preflight), la dejamos pasar
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    enfermeros = Enfermero.query.all()
    
    lista = []
    for enf in enfermeros:
        lista.append({
            "usuario_id": enf.usuario_id,
            "nombre": enf.nombre,
            "apellido": enf.apellido,
            "especialidad": enf.especialidad
        })
        
    return jsonify(lista), 200