from database import db

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


class Administrador(Usuario):
    """Perfil administrativo sobre la tabla de usuarios existente."""

class Paciente(db.Model):
    __tablename__ = 'pacientes'
    
    id = db.Column(db.Integer, primary_key=True)
    usuario_id = db.Column(db.Integer, db.ForeignKey('usuarios.id'), nullable=False, unique=True)
    
    nombre = db.Column(db.String(100), nullable=True)
    apellido = db.Column(db.String(100), nullable=True)
    direccion = db.Column(db.String(200), nullable=True)
    telefono = db.Column(db.String(20), nullable=True)
    historial_medico = db.Column(db.Text, nullable=True)
    latitud = db.Column(db.Float, nullable=True)
    longitud = db.Column(db.Float, nullable=True)
    ubicacion_compartida = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
        server_default=db.false(),
    )
    
    def to_dict(self):
        return {
            "idPaciente": self.id,
            "nombre": self.nombre,
            "apellido": self.apellido,
            "direccion": self.direccion,
            "telefono": self.telefono,
            "historial_medico": self.historial_medico,
            "latitud": self.latitud,
            "longitud": self.longitud,
            "ubicacion_compartida": self.ubicacion_compartida,
        }

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
            "latitud": self.latitud,
            "longitud": self.longitud,
            "calificacionPromedio": self.calificacionPromedio,
            "cantidadResenas": self.cantidadResenas or 0,
            # ListaEnfermeros.jsx muestra la estrella con este campo (HU3).
            "puntuacion": self.calificacionPromedio,
        }

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
