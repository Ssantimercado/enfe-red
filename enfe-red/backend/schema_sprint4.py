from sqlalchemy import inspect, text

from database import db
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio

SERVICIOS_INICIALES = (
    'Curaciones',
    'Inyecciones',
    'Control de signos vitales',
    'Higiene y confort',
    'Acompañamiento de adultos mayores',
    'Cuidados Intensivos',
)


def inicializar_bd_sprint4():
    """Crear tablas y agregar columnas optativas sin borrar datos de perfiles."""
    # Importar SolicitudServicio registra también Servicio en los metadatos.
    db.create_all()
    with db.engine.begin() as connection:
        columnas_paciente = {
            columna['name']
            for columna in inspect(connection).get_columns('pacientes')
        }
        if 'latitud' not in columnas_paciente:
            connection.execute(text('ALTER TABLE pacientes ADD COLUMN latitud FLOAT'))
        if 'longitud' not in columnas_paciente:
            connection.execute(text('ALTER TABLE pacientes ADD COLUMN longitud FLOAT'))
        if 'ubicacion_compartida' not in columnas_paciente:
            connection.execute(text(
                'ALTER TABLE pacientes ADD COLUMN ubicacion_compartida BOOLEAN NOT NULL DEFAULT FALSE'
            ))
        columnas = {columna['name'] for columna in inspect(connection).get_columns('enfermeros')}
        if 'verificado' not in columnas:
            connection.execute(text(
                'ALTER TABLE enfermeros ADD COLUMN verificado BOOLEAN NOT NULL DEFAULT FALSE'
            ))
        # Sprint 5 de Santiago (SCRUM-65.2): reputación del enfermero.
        recalcular = False
        if 'calificacionPromedio' not in columnas:
            connection.execute(text('ALTER TABLE enfermeros ADD COLUMN calificacionPromedio FLOAT NULL'))
            recalcular = True
        if 'cantidadResenas' not in columnas:
            connection.execute(text(
                'ALTER TABLE enfermeros ADD COLUMN cantidadResenas INTEGER NOT NULL DEFAULT 0'
            ))
            recalcular = True
        if inspect(connection).has_table('calificaciones_servicio'):
            columnas_calificacion = {
                columna['name']
                for columna in inspect(connection).get_columns('calificaciones_servicio')
            }
            if 'fecha' not in columnas_calificacion:
                connection.execute(text('ALTER TABLE calificaciones_servicio ADD COLUMN fecha DATETIME NULL'))
            if recalcular:
                # SQL directo: otras columnas de enfermeros se agregan después, en el Sprint 3.
                connection.execute(text(
                    'UPDATE enfermeros SET '
                    'calificacionPromedio = (SELECT ROUND(AVG(c.estrellas), 2) FROM calificaciones_servicio c '
                    'WHERE c.idUsuarioCalificado = enfermeros.usuario_id), '
                    'cantidadResenas = (SELECT COUNT(*) FROM calificaciones_servicio c '
                    'WHERE c.idUsuarioCalificado = enfermeros.usuario_id)'
                ))
        precio = next(
            (columna for columna in inspect(connection).get_columns('servicios')
             if columna['name'] == 'precioEstimado'),
            None,
        )
        if precio and not precio['nullable']:
            if connection.dialect.name == 'mysql':
                connection.execute(text(
                    'ALTER TABLE servicios MODIFY COLUMN precioEstimado NUMERIC(10, 2) NULL'
                ))
            elif connection.dialect.name == 'postgresql':
                connection.execute(text(
                    'ALTER TABLE servicios ALTER COLUMN "precioEstimado" DROP NOT NULL'
                ))
            else:
                raise RuntimeError(
                    'No se puede migrar precioEstimado a opcional en esta base de datos.'
                )


def inicializar_catalogo_servicios():
    """Agregar los servicios elegidos si faltan, sin asignar precios inventados."""
    existentes = {
        servicio.tipoServicio
        for servicio in Servicio.query.filter(
            Servicio.tipoServicio.in_(SERVICIOS_INICIALES)
        ).all()
    }
    db.session.add_all(
        Servicio(tipoServicio=tipo, precioEstimado=None)
        for tipo in SERVICIOS_INICIALES
        if tipo not in existentes
    )
    db.session.commit()
