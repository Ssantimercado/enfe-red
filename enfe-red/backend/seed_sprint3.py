import logging

from sqlalchemy import inspect, text
from database import db
from models.servicio_models import Servicio
from models.usuario_models import Usuario, Enfermero, Disponibilidad
from extensions import bcrypt
from datetime import time

logger = logging.getLogger(__name__)

# Columnas del Sprint 3 en bases creadas antes de que existieran.
COLUMNAS_ENFERMEROS = {
    'telefono': 'VARCHAR(20) NULL',
    'experiencia_anios': 'INT DEFAULT 0',
    'descripcion': 'TEXT NULL',
    'direccion': 'VARCHAR(200) NULL',
    'ciudad': 'VARCHAR(100) NULL',
    'tarifa_hora': 'FLOAT DEFAULT 0',
    'disponible': 'BOOLEAN DEFAULT TRUE',
    'latitud': 'FLOAT NULL',
    'longitud': 'FLOAT NULL',
}
INDICE_BUSQUEDA = 'idx_enfermeros_busqueda'


def inicializar_bd_sprint3():
    """Agrega las columnas y el índice de búsqueda de enfermeros si faltan. No carga datos."""
    inspector = inspect(db.engine)
    columnas = {columna['name'] for columna in inspector.get_columns('enfermeros')}
    indices = {indice['name'] for indice in inspector.get_indexes('enfermeros')}
    with db.engine.begin() as connection:
        for columna, definicion in COLUMNAS_ENFERMEROS.items():
            if columna not in columnas:
                connection.execute(text(f'ALTER TABLE enfermeros ADD COLUMN {columna} {definicion}'))
    if INDICE_BUSQUEDA not in indices:
        try:
            with db.engine.begin() as connection:
                connection.execute(text(
                    f'CREATE INDEX {INDICE_BUSQUEDA} ON enfermeros '
                    '(nombre, apellido, especialidad, ciudad, tarifa_hora, disponible)'
                ))
        except Exception:
            # Sin el índice la búsqueda funciona igual, solo más lenta: se avisa y se sigue.
            logger.exception('No se pudo crear el índice de búsqueda de enfermeros')


def cargar_datos_demo():
    """Cuentas demo de enfermeros (clave 123456). Solo con CARGAR_DEMO=1 o el comando cargar-demo.

    No pisa cuentas existentes. Devuelve cuántas cuentas creó.
    """
    # Enfermeros de prueba con coordenadas de Mendoza
    datos_prueba = [
        {
            "email": "laura.gomez@test.com", "nombre": "Laura", "apellido": "Gómez",
            "matricula": "MAT-5001", "especialidad": "Cuidados Intensivos", "telefono": "2615001111",
            "experiencia_anios": 6, "descripcion": "Especialista en terapia intensiva y atención domiciliaria.",
            "direccion": "San Martín 1250", "ciudad": "Godoy Cruz", "tarifa_hora": 8500.0,
            "disponible": True, "latitud": -32.9253, "longitud": -68.8444,
            "horarios": [("Lunes", time(8, 0), time(14, 0)), ("Miércoles", time(14, 0), time(20, 0))],
            "servicios": ['Cuidados Intensivos', 'Control de signos vitales', 'Inyecciones']
        },
        {
            "email": "carlos.ruiz@test.com", "nombre": "Carlos", "apellido": "Ruiz",
            "matricula": "MAT-5002", "especialidad": "Geriatría", "telefono": "2615002222",
            "experiencia_anios": 10, "descripcion": "Cuidado integral de adultos mayores y control de signos vitales.",
            "direccion": "Av. Colón 450", "ciudad": "Mendoza Capital", "tarifa_hora": 6000.0,
            "disponible": True, "latitud": -32.8908, "longitud": -68.8440,
            "horarios": [("Lunes", time(9, 0), time(18, 0))],
            "servicios": ['Control de signos vitales', 'Higiene y confort', 'Acompañamiento de adultos mayores']
        },
        {
            "email": "sofia.mendez@test.com", "nombre": "Sofía", "apellido": "Méndez",
            "matricula": "MAT-5003", "especialidad": "Pediatría", "telefono": "2615003333",
            "experiencia_anios": 4, "descripcion": "Enfermera pediátrica y neonatal. Vacunas y nebulizaciones.",
            "direccion": "Libertad 820", "ciudad": "Guaymallén", "tarifa_hora": 7500.0,
            "disponible": True, "latitud": -32.8995, "longitud": -68.7950,
            "horarios": [("Viernes", time(10, 0), time(16, 0))],
            "servicios": ['Inyecciones', 'Control de signos vitales', 'Curaciones']
        },
        {
            "email": "martin.castro@test.com", "nombre": "Martín", "apellido": "Castro",
            "matricula": "MAT-5004", "especialidad": "General", "telefono": "2615004444",
            "experiencia_anios": 2, "descripcion": "Curaciones planas, inyecciones intramusculares y sueroterapia.",
            "direccion": "Sáenz Peña 1100", "ciudad": "Luján de Cuyo", "tarifa_hora": 5000.0,
            "disponible": False, "latitud": -33.0350, "longitud": -68.8780,
            "horarios": [],
            "servicios": ['Curaciones', 'Inyecciones']
        },
        # Más profesionales para mostrar la cartilla: especialidades, zonas, servicios y horarios distintos
        # (mañana, tarde, noche y fin de semana). Lucía queda con la matrícula pendiente para mostrar la verificación.
        {
            "email": "valeria.rios@test.com", "nombre": "Valeria", "apellido": "Ríos",
            "matricula": "MAT-5005", "especialidad": "Pediatría", "telefono": "2615005555",
            "experiencia_anios": 8, "descripcion": "Atención de bebés y niños en casa: vacunas, nebulizaciones y control de fiebre.",
            "direccion": "Lavalle 300", "ciudad": "Las Heras", "tarifa_hora": 7000.0,
            "disponible": True, "latitud": -32.8500, "longitud": -68.8200,
            "horarios": [("Martes", time(8, 0), time(13, 0)), ("Jueves", time(8, 0), time(13, 0)), ("Sábado", time(9, 0), time(12, 0))],
            "servicios": ['Control de signos vitales', 'Curaciones', 'Inyecciones']
        },
        {
            "email": "jorge.benitez@test.com", "nombre": "Jorge", "apellido": "Benítez",
            "matricula": "MAT-5006", "especialidad": "Geriatría", "telefono": "2615006666",
            "experiencia_anios": 15, "descripcion": "Acompañamiento de adultos mayores, higiene y control de la medicación diaria.",
            "direccion": "Ozamis 1500", "ciudad": "Maipú", "tarifa_hora": 6500.0,
            "disponible": True, "latitud": -32.9800, "longitud": -68.7900,
            "horarios": [("Lunes", time(14, 0), time(20, 0)), ("Miércoles", time(14, 0), time(20, 0)), ("Viernes", time(14, 0), time(20, 0))],
            "servicios": ['Acompañamiento de adultos mayores', 'Higiene y confort', 'Control de signos vitales']
        },
        {
            "email": "natalia.quiroga@test.com", "nombre": "Natalia", "apellido": "Quiroga",
            "matricula": "MAT-5007", "especialidad": "Cuidados Intensivos", "telefono": "2615007777",
            "experiencia_anios": 12, "descripcion": "Guardias nocturnas para pacientes con alta complejidad o recién operados.",
            "direccion": "Av. San Martín 900", "ciudad": "Mendoza Capital", "tarifa_hora": 15000.0,
            "disponible": True, "latitud": -32.8900, "longitud": -68.8400,
            "horarios": [("Lunes", time(20, 0), time(23, 30)), ("Martes", time(20, 0), time(23, 30)), ("Miércoles", time(20, 0), time(23, 30))],
            "servicios": ['Cuidados Intensivos', 'Control de signos vitales', 'Curaciones']
        },
        {
            "email": "diego.ferreyra@test.com", "nombre": "Diego", "apellido": "Ferreyra",
            "matricula": "MAT-5008", "especialidad": "General", "telefono": "2615008888",
            "experiencia_anios": 3, "descripcion": "Inyecciones y curaciones los fines de semana, cuando no hay consultorios abiertos.",
            "direccion": "Bandera de los Andes 2200", "ciudad": "Guaymallén", "tarifa_hora": 5500.0,
            "disponible": True, "latitud": -32.9000, "longitud": -68.7850,
            "horarios": [("Sábado", time(8, 0), time(14, 0)), ("Domingo", time(8, 0), time(14, 0))],
            "servicios": ['Inyecciones', 'Curaciones']
        },
        {
            "email": "paula.sosa@test.com", "nombre": "Paula", "apellido": "Sosa",
            "matricula": "MAT-5009", "especialidad": "Geriatría", "telefono": "2615009999",
            "experiencia_anios": 9, "descripcion": "Cuidado integral de adultos mayores con movilidad reducida.",
            "direccion": "Roque Sáenz Peña 400", "ciudad": "Luján de Cuyo", "tarifa_hora": 8000.0,
            "disponible": True, "latitud": -33.0400, "longitud": -68.8800,
            "horarios": [("Martes", time(9, 0), time(17, 0)), ("Jueves", time(9, 0), time(17, 0))],
            "servicios": ['Acompañamiento de adultos mayores', 'Higiene y confort']
        },
        {
            "email": "mariano.videla@test.com", "nombre": "Mariano", "apellido": "Videla",
            "matricula": "MAT-5010", "especialidad": "General", "telefono": "2615001010",
            "experiencia_anios": 5, "descripcion": "Inyecciones, curaciones y control de presión temprano, antes de ir a trabajar.",
            "direccion": "Perito Moreno 700", "ciudad": "Godoy Cruz", "tarifa_hora": 6000.0,
            "disponible": True, "latitud": -32.9300, "longitud": -68.8500,
            "horarios": [("Lunes", time(7, 0), time(11, 0)), ("Miércoles", time(7, 0), time(11, 0)), ("Viernes", time(7, 0), time(11, 0))],
            "servicios": ['Inyecciones', 'Control de signos vitales', 'Curaciones']
        },
        {
            "email": "florencia.herrera@test.com", "nombre": "Florencia", "apellido": "Herrera",
            "matricula": "MAT-5011", "especialidad": "Pediatría", "telefono": "2615001111",
            "experiencia_anios": 6, "descripcion": "Enfermera pediátrica: controles, higiene y acompañamiento de chicos con discapacidad.",
            "direccion": "Colón 250", "ciudad": "Mendoza Capital", "tarifa_hora": 9000.0,
            "disponible": True, "latitud": -32.8950, "longitud": -68.8450,
            "horarios": [("Miércoles", time(15, 0), time(21, 0)), ("Sábado", time(15, 0), time(21, 0))],
            "servicios": ['Control de signos vitales', 'Higiene y confort']
        },
        {
            "email": "gabriel.ortiz@test.com", "nombre": "Gabriel", "apellido": "Ortiz",
            "matricula": "MAT-5012", "especialidad": "Cuidados Intensivos", "telefono": "2615001212",
            "experiencia_anios": 10, "descripcion": "Cuidados de alta complejidad los fines de semana por la noche.",
            "direccion": "San Miguel 1800", "ciudad": "Las Heras", "tarifa_hora": 12000.0,
            "disponible": True, "latitud": -32.8450, "longitud": -68.8300,
            "horarios": [("Viernes", time(18, 0), time(23, 30)), ("Sábado", time(18, 0), time(23, 30)), ("Domingo", time(18, 0), time(23, 30))],
            "servicios": ['Cuidados Intensivos', 'Curaciones']
        },
        {
            "email": "lucia.pereyra@test.com", "nombre": "Lucía", "apellido": "Pereyra",
            "matricula": "MAT-5013", "especialidad": "General", "telefono": "2615001313",
            "experiencia_anios": 1, "descripcion": "Recién recibida: inyecciones y control de signos vitales.",
            "direccion": "Padre Vázquez 120", "ciudad": "Maipú", "tarifa_hora": 5000.0,
            "disponible": True, "latitud": -32.9850, "longitud": -68.7950,
            "horarios": [("Lunes", time(9, 0), time(15, 0)), ("Jueves", time(9, 0), time(15, 0))],
            "servicios": ['Inyecciones', 'Control de signos vitales'],
            "verificado": False
        }
    ]

    pass_hash = bcrypt.generate_password_hash("123456").decode('utf-8')

    creadas = 0
    for item in datos_prueba:
        usuario_existente = Usuario.query.filter_by(email=item["email"]).first()
        if not usuario_existente:
            nuevo_u = Usuario(email=item["email"], password_hash=pass_hash, rol="enfermero")
            db.session.add(nuevo_u)
            db.session.flush()
            creadas += 1

            nuevo_enf = Enfermero(
                usuario_id=nuevo_u.id, nombre=item["nombre"], apellido=item["apellido"],
                matricula=item["matricula"], especialidad=item["especialidad"],
                telefono=item["telefono"], experiencia_anios=item["experiencia_anios"],
                descripcion=item["descripcion"], direccion=item["direccion"],
                ciudad=item["ciudad"], tarifa_hora=item["tarifa_hora"],
                disponible=item["disponible"], latitud=item["latitud"], longitud=item["longitud"],
                verificado=item.get("verificado", True)
            )
            db.session.add(nuevo_enf)
            db.session.flush()

            for dia, h_ini, h_fin in item["horarios"]:
                db.session.add(Disponibilidad(
                    enfermero_id=nuevo_enf.id, dia_semana=dia,
                    hora_inicio=h_ini, hora_fin=h_fin, estado="Disponible"
                ))

        # SCRUM-14/53: servicios que ofrece cada cuenta demo (también a las ya creadas que no tengan).
        enfermero = Enfermero.query.filter_by(matricula=item["matricula"]).first()
        if enfermero and not enfermero.servicios:
            enfermero.servicios = Servicio.query.filter(Servicio.tipoServicio.in_(item["servicios"])).all()

    db.session.commit()
    return creadas
