from database import db
from services.cifrado import ErrorCifrado, cifrar, descifrar

MAX_MOTIVO_RECHAZO = 300
PREFIJO_MATRICULA_TEMPORAL = 'PENDIENTE-'
# Datos de la revisión de la matrícula: los ven el propio enfermero y los administradores.
CAMPOS_VERIFICACION = ('estadoVerificacion', 'motivoRechazo', 'verificadoEn', 'verificadoPor')

# Cartilla pública: 2 decimales (~1 km) alcanzan para el mapa sin mostrar el domicilio exacto.
DECIMALES_UBICACION_PUBLICA = 2

class Usuario(db.Model):
    __tablename__ = 'usuarios'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    rol = db.Column(db.String(50), nullable=False)
    suspendido = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    nivelPermiso = db.Column(db.String(30), nullable=True)
    # Ley 25.326: constancia del consentimiento expreso (versión y fecha UTC) dado al registrarse.
    versionTerminos = db.Column(db.String(10), nullable=True)
    aceptoTerminosEn = db.Column(db.DateTime, nullable=True)
    # Sube al cambiar o recuperar la contraseña: invalida todas las sesiones abiertas.
    versionToken = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    # Ley 25.326 (supresión): la fila queda anonimizada para no romper solicitudes ni reseñas.
    eliminado = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())

    # Relaciones para conectar con los perfiles
    perfil_paciente = db.relationship('Paciente', backref='usuario', uselist=False, cascade="all, delete-orphan")
    perfil_enfermero = db.relationship('Enfermero', backref='usuario', uselist=False, cascade="all, delete-orphan")

    def __repr__(self):
        return f'<Usuario {self.email}>'

    @property
    def estado(self):
        """Estado legible por la consigna; la interfaz usa el booleano suspendido."""
        return 'Suspendido' if self.suspendido else 'Activo'

    @estado.setter
    def estado(self, valor):
        if valor not in ('Activo', 'Suspendido'):
            raise ValueError("El estado debe ser 'Activo' o 'Suspendido'")
        self.suspendido = valor == 'Suspendido'

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "rol": self.rol
        }


# Administrador (diagrama de clases): es un Usuario con rol 'administrador' y nivelPermiso;
# sus métodos son las rutas de admin_routes.py. No necesita una tabla ni una clase propia.

class Paciente(db.Model):
    __tablename__ = 'pacientes'
    
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False, unique=True)
    
    nombre = db.Column(db.String(100), nullable=True)
    apellido = db.Column(db.String(100), nullable=True)
    direccion = db.Column(db.String(200), nullable=True)
    telefono = db.Column(db.String(20), nullable=True)
    # Dato de salud: en la base queda cifrado (services/cifrado.py); el atributo historial_medico es el texto.
    historial_cifrado = db.Column('historial_medico', db.Text, nullable=True)
    # Paciente.obraSocial del diagrama de clases (opcional).
    obraSocial = db.Column(db.String(100), nullable=True)
    latitud = db.Column(db.Float, nullable=True)
    longitud = db.Column(db.Float, nullable=True)
    ubicacion_compartida = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
    )
    
    def to_dict(self):
        historial = self.historial_legible()
        datos = {
            "idPaciente": self.id,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "direccion": self.direccion,
            "telefono": self.telefono,
            "historial_medico": historial,
            "obraSocial": self.obraSocial,
            "latitud": self.latitud,
            "longitud": self.longitud,
            "ubicacion_compartida": self.ubicacion_compartida,
        }
        if historial is None and self.historial_cifrado not in (None, ''):
            datos["historialIlegible"] = True
        return datos

    def historial_legible(self):
        """El historial, o None si está cifrado con una clave que no está configurada."""
        try:
            return self.historial_medico
        except ErrorCifrado:
            return None

    def historial_ilegible(self):
        # El dato sigue guardado: con la clave correcta (CLAVE_CIFRADO_ANTERIOR) se recupera.
        return self.historial_cifrado not in (None, '') and self.historial_legible() is None

    @property
    def historial_medico(self):
        return descifrar(self.historial_cifrado)

    @historial_medico.setter
    def historial_medico(self, texto):
        self.historial_cifrado = cifrar(texto)

class Enfermero(db.Model):
    __tablename__ = 'enfermeros'
    
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False, unique=True)
    
    # Datos personales y profesionales (con index=True para optimizar búsquedas en MySQL)
    nombre = db.Column(db.String(100), nullable=True, index=True)
    apellido = db.Column(db.String(100), nullable=True, index=True)
    matricula = db.Column(db.String(50), unique=True, nullable=False)
    especialidad = db.Column(db.String(100), nullable=True, index=True)
    
    # Campos para filtros, perfil y geolocalización (Sprint 2 y 3)
    telefono = db.Column(db.String(20), nullable=True)
    experiencia_anios = db.Column(db.Integer, default=0)
    descripcion = db.Column(db.Text, nullable=True)
    direccion = db.Column(db.String(200), nullable=True)
    ciudad = db.Column(db.String(100), nullable=True, index=True)
    tarifa_hora = db.Column(db.Float, default=0.0, index=True)
    disponible = db.Column(db.Boolean, default=True, index=True)
    verificado = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    matricula_rechazada = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    # Respaldo de la última revisión de la matrícula. Sin ForeignKey a propósito: una segunda
    # relación enfermeros -> usuarios volvería ambiguo el backref Usuario.perfil_enfermero.
    verificadoPor = db.Column(db.Integer, nullable=True)
    verificadoEn = db.Column(db.DateTime, nullable=True)
    motivoRechazo = db.Column(db.String(MAX_MOTIVO_RECHAZO), nullable=True)
    latitud = db.Column(db.Float, nullable=True)
    longitud = db.Column(db.Float, nullable=True)
    # SCRUM-65.2: se recalcula con cada calificación nueva de un paciente.
    calificacionPromedio = db.Column(db.Float, nullable=True)
    cantidadResenas = db.Column(db.Integer, nullable=False, default=0, server_default='0')

    disponibilidades = db.relationship('Disponibilidad', backref='enfermero', cascade="all, delete-orphan")
    
    def to_dict(self):
        return {
            "id": self.usuario_id,          # Para VerPerfiles.jsx
            "usuario_id": self.usuario_id,  # Para ListaEnfermeros.jsx y Mapa de Germán
            "enfermero_id": self.id,
            "idEnfermero": self.id,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "matricula": self.matricula,
            "especialidad": self.especialidad,
            "telefono": self.telefono,
            "experiencia_anios": self.experiencia_anios,
            "descripcion": self.descripcion,
            "direccion": self.direccion,
            "ciudad": self.ciudad,
            "tarifa_hora": self.tarifa_hora,
            "disponible": self.disponible,
            "verificado": self.verificado,
            **self.datos_verificacion(),
            "latitud": self.latitud,
            "longitud": self.longitud,
            "calificacionPromedio": self.calificacionPromedio,
            "cantidadResenas": self.cantidadResenas or 0,
            # ListaEnfermeros.jsx muestra la estrella con este campo (HU3).
            "puntuacion": self.calificacionPromedio,
        }

    @property
    def estado_verificacion(self):
        if self.verificado:
            return 'verificada'
        if self.matricula_rechazada:
            return 'rechazada'
        if (self.matricula or '').startswith(PREFIJO_MATRICULA_TEMPORAL):
            return 'sin_cargar'
        return 'pendiente'

    def datos_verificacion(self):
        return {
            "estadoVerificacion": self.estado_verificacion,
            "motivoRechazo": self.motivoRechazo,
            "verificadoEn": self.verificadoEn.isoformat(timespec='seconds') + 'Z' if self.verificadoEn else None,
            "verificadoPor": self.verificadoPor,
        }

    def to_dict_publico(self):
        """Perfil para la cartilla y otros usuarios: sin teléfono, dirección ni ubicación exacta."""
        datos = self.to_dict()
        for campo in ('telefono', 'direccion', *CAMPOS_VERIFICACION):
            datos.pop(campo)
        for campo in ('latitud', 'longitud'):
            if datos[campo] is not None:
                datos[campo] = round(datos[campo], DECIMALES_UBICACION_PUBLICA)
        return datos

class Disponibilidad(db.Model):
    __tablename__ = 'disponibilidades'

    id = db.Column(db.Integer, primary_key=True)
    enfermero_id = db.Column(db.Integer, db.ForeignKey('enfermeros.id'), nullable=False)
    dia_semana = db.Column(db.String(20), nullable=False)
    hora_inicio = db.Column(db.Time, nullable=False)
    hora_fin = db.Column(db.Time, nullable=False)
    estado = db.Column(db.String(20), default='Disponible')

    def to_dict(self):
        return {
            "id": self.id,
            "enfermero_id": self.enfermero_id,
            "dia_semana": self.dia_semana,
            "hora_inicio": self.hora_inicio.strftime('%H:%M') if self.hora_inicio else None,
            "hora_fin": self.hora_fin.strftime('%H:%M') if self.hora_fin else None,
            "estado": self.estado
        }
