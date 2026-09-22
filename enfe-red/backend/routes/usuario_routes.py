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

    usuario = Usuario.query.filter_by(email=email).first()

    if not usuario or not bcrypt.check_password_hash(usuario.password_hash, password):
        return jsonify({"error": "Credenciales incorrectas"}), 401

    token = create_access_token(
        identity=str(usuario.id),
        additional_claims={"rol": usuario.rol}
    )

    return jsonify({"mensaje": "Login exitoso", "token": token, "rol": usuario.rol}), 200


# ==========================================
# 2. RUTA DE REGISTRO (Corregida con matrícula temporal)
# ==========================================
@usuario_bp.route('/registro', methods=['POST'])
def registrar_usuario():
    data = request.get_json()

    nombre_completo = data.get('nombre', '').strip()
    email = data.get('email')
    password = data.get('password')
    rol = data.get('rol', 'paciente')

    if not nombre_completo or not email or not password:
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

    # Separar nombre y apellido automáticamente
    partes = nombre_completo.split(' ', 1)
    nombre = partes[0]
    apellido = partes[1] if len(partes) > 1 else ''

    try:
        db.session.add(nuevo_usuario)
        db.session.flush() # Hace el insert para conseguir el nuevo_usuario.id sin cerrar la transacción

        if rol == 'paciente':
            nuevo_perfil = Paciente(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido
            )
        elif rol == 'enfermero':
            # MAGIA ACÁ: Creamos una matrícula temporal única usando el ID del usuario
            matricula_temporal = f"PENDIENTE-{nuevo_usuario.id}"
            
            nuevo_perfil = Enfermero(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido,
                especialidad='General',
                matricula=matricula_temporal  # Esto salva el Error 500
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
@usuario_bp.route('/perfil/paciente', methods=['GET', 'PUT'])
@jwt_required()
def perfil_paciente():
    usuario_id = int(get_jwt_identity())
    usuario = Usuario.query.get(usuario_id)

    if not usuario or usuario.rol != 'paciente':
        return jsonify({"error": "Perfil no encontrado o acceso denegado"}), 404

    paciente = Paciente.query.filter_by(usuario_id=usuario_id).first()

    # Si es GET, devolvemos los datos
    if request.method == 'GET':
        datos_completos = usuario.to_dict()
        if not paciente:
            datos_completos.update({
                "nombre": "Falta configurar", "apellido": "", "direccion": "No registrada",
                "telefono": "No registrado", "historial_medico": "Sin datos"
            })
        else:
            datos_completos.update(paciente.to_dict())
        return jsonify(datos_completos), 200

    # Si es PUT, actualizamos los datos
    if request.method == 'PUT':
        data = request.get_json()
        if paciente:
            paciente.nombre = data.get('nombre', paciente.nombre)
            paciente.apellido = data.get('apellido', paciente.apellido)
            paciente.direccion = data.get('direccion', paciente.direccion)
            paciente.telefono = data.get('telefono', paciente.telefono)
            paciente.historial_medico = data.get('historial_medico', paciente.historial_medico)
            db.session.commit()
            
            # Devolvemos el perfil actualizado
            datos_completos = usuario.to_dict()
            datos_completos.update(paciente.to_dict())
            return jsonify(datos_completos), 200
        return jsonify({"error": "No se pudo actualizar"}), 400


# ==========================================
# 4. VISTA "MI PERFIL" DE ENFERMERO (Pablo)
# ==========================================
@usuario_bp.route('/perfil/enfermero', methods=['GET', 'PUT'])
@jwt_required()
def perfil_enfermero():
    usuario_id = int(get_jwt_identity())
    usuario = Usuario.query.get(usuario_id)

    if not usuario or usuario.rol != 'enfermero':
        return jsonify({"error": "No sos enfermero"}), 403

    enfermero = Enfermero.query.filter_by(usuario_id=usuario_id).first()

    if request.method == 'GET':
        datos_completos = usuario.to_dict()
        if enfermero:
            datos_completos.update(enfermero.to_dict())
        return jsonify(datos_completos), 200

    if request.method == 'PUT':
        data = request.get_json()
        if enfermero:
            enfermero.nombre = data.get('nombre', enfermero.nombre)
            enfermero.apellido = data.get('apellido', enfermero.apellido)
            enfermero.especialidad = data.get('especialidad', enfermero.especialidad)
            enfermero.matricula = data.get('matricula', enfermero.matricula)
            db.session.commit()
            
            datos_completos = usuario.to_dict()
            datos_completos.update(enfermero.to_dict())
            return jsonify(datos_completos), 200


# ==========================================
# 5. MOCK PARA HORARIOS (Hasta que Renzo lo arme)
# ==========================================
@usuario_bp.route('/perfil/enfermero/horarios', methods=['GET', 'POST'])
@jwt_required()
def gestionar_horarios():
    usuario_id = int(get_jwt_identity())
    
    # En un futuro acá Renzo va a leer/guardar en la tabla 'Disponibilidad'
    if request.method == 'GET':
        # Simulamos que no hay horarios guardados todavía
        return jsonify([]), 200
        
    if request.method == 'POST':
        # Simulamos que lo recibimos y lo guardamos con éxito
        data = request.get_json()
        return jsonify({"mensaje": "Horarios guardados con éxito"}), 200

# ==========================================
# 6. OBTENER TODOS LOS ENFERMEROS (Para la Cartilla)
# ==========================================
@usuario_bp.route('/enfermeros', methods=['GET'])
def obtener_enfermeros():
    enfermeros_db = Enfermero.query.all()
    lista_enfermeros = []
    
    for enfermero in enfermeros_db:
        usuario = Usuario.query.get(enfermero.usuario_id)
        if usuario:
            datos = enfermero.to_dict()
            # Le pasamos el ID del usuario para que el frontend sepa a qué perfil entrar
            datos['id'] = usuario.id 
            datos['email'] = usuario.email
            lista_enfermeros.append(datos)
            
    return jsonify(lista_enfermeros), 200

# ==========================================
# 7. OBTENER UN PERFIL POR ID (Para VerPerfiles.jsx)
# ==========================================
@usuario_bp.route('/usuarios/<int:id>', methods=['GET'])
@jwt_required()
def obtener_usuario_por_id(id):
    usuario = Usuario.query.get(id)
    if not usuario:
        return jsonify({"error": "Usuario no encontrado"}), 404

    datos = usuario.to_dict()
    
    # Si es enfermero, le sumamos sus datos profesionales
    if usuario.rol == 'enfermero':
        enfermero = Enfermero.query.filter_by(usuario_id=id).first()
        if enfermero:
            datos.update(enfermero.to_dict())
            
    return jsonify(datos), 200

# ==========================================
# 8. OBTENER HORARIOS POR ID (Para VerPerfiles.jsx)
# ==========================================
@usuario_bp.route('/usuarios/<int:id>/horarios', methods=['GET'])
@jwt_required()
def obtener_horarios_por_id(id):
    # Esto es temporal hasta que Renzo termine la tabla en la Base de Datos.
    # Por ahora devolvemos una lista vacía para que no tire error el frontend.
    return jsonify([]), 200