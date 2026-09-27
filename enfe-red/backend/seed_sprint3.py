from sqlalchemy import text
from database import db
from models.usuario_models import Usuario, Enfermero, Disponibilidad
from extensions import bcrypt
from datetime import time

def inicializar_bd_sprint3():
    # 1. Agregar columnas nuevas a 'enfermeros' si no existen todavía
    columnas_nuevas = [
        "ADD COLUMN telefono VARCHAR(20) NULL",
        "ADD COLUMN experiencia_anios INT DEFAULT 0",
        "ADD COLUMN descripcion TEXT NULL",
        "ADD COLUMN direccion VARCHAR(200) NULL",
        "ADD COLUMN ciudad VARCHAR(100) NULL",
        "ADD COLUMN tarifa_hora FLOAT DEFAULT 0",
        "ADD COLUMN disponible BOOLEAN DEFAULT TRUE",
        "ADD COLUMN latitud FLOAT NULL",
        "ADD COLUMN longitud FLOAT NULL"
    ]
    
    for col in columnas_nuevas:
        try:
            db.session.execute(text(f"ALTER TABLE enfermeros {col};"))
            db.session.commit()
        except Exception:
            db.session.rollback() # Si la columna ya existe, sigue de largo sin dar error

    # 2. Crear el índice compuesto de optimización si no existe
    try:
        db.session.execute(text(
            "CREATE INDEX idx_enfermeros_busqueda ON enfermeros (nombre, apellido, especialidad, ciudad, tarifa_hora, disponible);"
        ))
        db.session.commit()
    except Exception:
        db.session.rollback()

    # 3. Cargar los 4 enfermeros de prueba con coordenadas de Mendoza (solo si no existen)
    datos_prueba = [
        {
            "email": "laura.gomez@test.com", "nombre": "Laura", "apellido": "Gómez",
            "matricula": "MAT-5001", "especialidad": "Cuidados Intensivos", "telefono": "2615001111",
            "experiencia_anios": 6, "descripcion": "Especialista en terapia intensiva y atención domiciliaria.",
            "direccion": "San Martín 1250", "ciudad": "Godoy Cruz", "tarifa_hora": 8500.0,
            "disponible": True, "latitud": -32.9253, "longitud": -68.8444,
            "horarios": [("Lunes", time(8, 0), time(14, 0)), ("Miércoles", time(14, 0), time(20, 0))]
        },
        {
            "email": "carlos.ruiz@test.com", "nombre": "Carlos", "apellido": "Ruiz",
            "matricula": "MAT-5002", "especialidad": "Geriatría", "telefono": "2615002222",
            "experiencia_anios": 10, "descripcion": "Cuidado integral de adultos mayores y control de signos vitales.",
            "direccion": "Av. Colón 450", "ciudad": "Mendoza Capital", "tarifa_hora": 6000.0,
            "disponible": True, "latitud": -32.8908, "longitud": -68.8440,
            "horarios": [("Lunes", time(9, 0), time(18, 0))]
        },
        {
            "email": "sofia.mendez@test.com", "nombre": "Sofía", "apellido": "Méndez",
            "matricula": "MAT-5003", "especialidad": "Pediatría", "telefono": "2615003333",
            "experiencia_anios": 4, "descripcion": "Enfermera pediátrica y neonatal. Vacunas y nebulizaciones.",
            "direccion": "Libertad 820", "ciudad": "Guaymallén", "tarifa_hora": 7500.0,
            "disponible": True, "latitud": -32.8995, "longitud": -68.7950,
            "horarios": [("Viernes", time(10, 0), time(16, 0))]
        },
        {
            "email": "martin.castro@test.com", "nombre": "Martín", "apellido": "Castro",
            "matricula": "MAT-5004", "especialidad": "General", "telefono": "2615004444",
            "experiencia_anios": 2, "descripcion": "Curaciones planas, inyecciones intramusculares y sueroterapia.",
            "direccion": "Sáenz Peña 1100", "ciudad": "Luján de Cuyo", "tarifa_hora": 5000.0,
            "disponible": False, "latitud": -33.0350, "longitud": -68.8780,
            "horarios": []
        }
    ]

    pass_hash = bcrypt.generate_password_hash("123456").decode('utf-8')

    for item in datos_prueba:
        if not Usuario.query.filter_by(email=item["email"]).first():
            nuevo_u = Usuario(email=item["email"], password_hash=pass_hash, rol="enfermero")
            db.session.add(nuevo_u)
            db.session.flush()

            nuevo_enf = Enfermero(
                usuario_id=nuevo_u.id, nombre=item["nombre"], apellido=item["apellido"],
                matricula=item["matricula"], especialidad=item["especialidad"],
                telefono=item["telefono"], experiencia_anios=item["experiencia_anios"],
                descripcion=item["descripcion"], direccion=item["direccion"],
                ciudad=item["ciudad"], tarifa_hora=item["tarifa_hora"],
                disponible=item["disponible"], latitud=item["latitud"], longitud=item["longitud"]
            )
            db.session.add(nuevo_enf)
            db.session.flush()

            for dia, h_ini, h_fin in item["horarios"]:
                db.session.add(Disponibilidad(
                    enfermero_id=nuevo_enf.id, dia_semana=dia,
                    hora_inicio=h_ini, hora_fin=h_fin, estado="Disponible"
                ))

    db.session.commit()
    print("✅ BD verificada: Columnas e información de prueba del Sprint 3 listas.")