from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, create_access_token
from sqlalchemy import or_

from database import db
from extensions import bcrypt
from models.usuario_models import Usuario, Paciente, Enfermero, Disponibilidad

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

    partes = nombre_completo.split(' ', 1)
    nombre = partes[0]
    apellido = partes[1] if len(partes) > 1 else ''

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
            matricula_temporal = f"PENDIENTE-{nuevo_usuario.id}"
            
            nuevo_perfil = Enfermero(
                usuario_id=nuevo_usuario.id,
                nombre=nombre,
                apellido=apellido,
                especialidad='General',
                matricula=matricula_temporal
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

    if request.method == 'PUT':
        data = request.get_json()
        if paciente:
            paciente.nombre = data.get('nombre', paciente.nombre)
            paciente.apellido = data.get('apellido', paciente.apellido)
            paciente.direccion = data.get('direccion', paciente.direccion)
            paciente.telefono = data.get('telefono', paciente.telefono)
            paciente.historial_medico = data.get('historial_medico', paciente.historial_medico)
            db.session.commit()
            
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
            enfermero.telefono = data.get('telefono', enfermero.telefono)
            enfermero.experiencia_anios = data.get('experiencia_anios', enfermero.experiencia_anios)
            enfermero.descripcion = data.get('descripcion', enfermero.descripcion)
            enfermero.direccion = data.get('direccion', enfermero.direccion)
            enfermero.ciudad = data.get('ciudad', enfermero.ciudad)
            enfermero.tarifa_hora = data.get('tarifa_hora', enfermero.tarifa_hora)
            enfermero.disponible = data.get('disponible', enfermero.disponible)
            enfermero.latitud = data.get('latitud', enfermero.latitud)
            enfermero.longitud = data.get('longitud', enfermero.longitud)
            db.session.commit()
            
            datos_completos = usuario.to_dict()
            datos_completos.update(enfermero.to_dict())
            return jsonify(datos_completos), 200


# ==========================================
# 5. GESTIÓN DE HORARIOS DE ENFERMERO (Integrado con tabla Disponibilidad)
# ==========================================
@usuario_bp.route('/perfil/enfermero/horarios', methods=['GET', 'POST'])
@jwt_required()
def gestionar_horarios():
    usuario_id = int(get_jwt_identity())
    enfermero = Enfermero.query.filter_by(usuario_id=usuario_id).first()
    
    if not enfermero:
        return jsonify({"error": "Enfermero no encontrado"}), 404

    if request.method == 'GET':
        horarios = Disponibilidad.query.filter_by(enfermero_id=enfermero.id).all()
        return jsonify([h.to_dict() for h in horarios]), 200
        
    if request.method == 'POST':
        data = request.get_json() or {}
        # Permite guardar un objeto de horario nuevo
        dia_semana = data.get('dia_semana')
        str_inicio = data.get('hora_inicio')
        str_fin = data.get('hora_fin')
        estado = data.get('estado', 'Disponible')

        if dia_semana and str_inicio and str_fin:
            hora_inicio = datetime.strptime(str_inicio, '%H:%M').time()
            hora_fin = datetime.strptime(str_fin, '%H:%M').time()
            nueva_disp = Disponibilidad(
                enfermero_id=enfermero.id,
                dia_semana=dia_semana,
                hora_inicio=hora_inicio,
                hora_fin=hora_fin,
                estado=estado
            )
            db.session.add(nueva_disp)
            db.session.commit()
            return jsonify({"mensaje": "Horarios guardados con éxito", "disponibilidad": nueva_disp.to_dict()}), 201

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
            datos['id'] = usuario.id 
            datos['usuario_id'] = usuario.id
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
    enfermero = Enfermero.query.filter_by(usuario_id=id).first()
    if not enfermero:
        return jsonify([]), 200
    horarios = Disponibilidad.query.filter_by(enfermero_id=enfermero.id).all()
    return jsonify([h.to_dict() for h in horarios]), 200


# ==========================================
# 9. SPRINT 3: API DE BÚSQUEDA AVANZADA Y FILTROS (Pablo)
# ==========================================
@usuario_bp.route('/enfermeros/buscar', methods=['GET'])
def buscar_enfermeros():
    # Parámetros de filtro que envía el Frontend por URL (?q=...&especialidad=...&precio_max=...)
    texto = request.args.get('q', '').strip()
    especialidad = request.args.get('especialidad', '').strip()
    ciudad = request.args.get('ciudad', '').strip()
    precio_max = request.args.get('precio_max', type=float)
    disponible = request.args.get('disponible', '').strip()
    dia_semana = request.args.get('dia_semana', '').strip()

    # Parámetros de paginación
    pagina = request.args.get('page', 1, type=int)
    por_pagina = request.args.get('per_page', 10, type=int)

    # Query base en SQLAlchemy
    query = Enfermero.query.join(Usuario, Enfermero.usuario_id == Usuario.id)

    # 1. Filtro por texto libre (nombre, apellido, especialidad o ciudad/zona)
    if texto:
        patron = f"%{texto}%"
        query = query.filter(
            or_(
                Enfermero.nombre.ilike(patron),
                Enfermero.apellido.ilike(patron),
                Enfermero.especialidad.ilike(patron),
                Enfermero.ciudad.ilike(patron),
                Enfermero.direccion.ilike(patron)
            )
        )

    # 2. Filtro exacto o parcial por especialidad
    if especialidad:
        query = query.filter(Enfermero.especialidad.ilike(f"%{especialidad}%"))

    # 3. Filtro por ciudad / zona
    if ciudad:
        query = query.filter(Enfermero.ciudad.ilike(f"%{ciudad}%"))

    # 4. Filtro por rango de precio máximo
    if precio_max is not None:
        query = query.filter(Enfermero.tarifa_hora <= precio_max)

    # 5. Filtro por disponibilidad general (true/false)
    if disponible.lower() == 'true':
        query = query.filter(Enfermero.disponible.is_(True))
    elif disponible.lower() == 'false':
        query = query.filter(Enfermero.disponible.is_(False))

    # 6. Filtro por día de atención en la tabla Disponibilidad
    if dia_semana:
        query = query.join(Disponibilidad).filter(
            Disponibilidad.dia_semana.ilike(f"%{dia_semana}%"),
            Disponibilidad.estado == 'Disponible'
        )

    # Evitar duplicados si hizo join con disponibilidades y paginar resultados
    query = query.distinct()
    paginacion = query.paginate(page=pagina, per_page=por_pagina, error_out=False)

    resultados = []
    for enf in paginacion.items:
        datos_enf = enf.to_dict()
        datos_enf['email'] = enf.usuario.email if enf.usuario else None
        datos_enf['horarios'] = [d.to_dict() for d in enf.disponibilidades]
        resultados.append(datos_enf)

    return jsonify({
        "pagina_actual": paginacion.page,
        "por_pagina": paginacion.per_page,
        "total_resultados": paginacion.total,
        "total_paginas": paginacion.pages,
        "enfermeros": resultados
    }), 200