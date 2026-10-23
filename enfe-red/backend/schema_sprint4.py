from decimal import Decimal

from sqlalchemy import inspect, text

from database import db
from models.servicio_models import Servicio
from models.solicitud_models import SolicitudServicio

# Precio estimado de referencia por visita (ARS), para que el comprobante muestre un
# valor orientativo. El precio final lo acuerdan paciente y profesional; cuando exista
# la gestión de servicios del administrador, estos valores se podrán editar.
PRECIOS_REFERENCIA = {
    'Curaciones': Decimal('8500.00'),
    'Inyecciones': Decimal('6000.00'),
    'Control de signos vitales': Decimal('5500.00'),
    'Higiene y confort': Decimal('9000.00'),
    'Acompañamiento de adultos mayores': Decimal('12000.00'),
    'Cuidados Intensivos': Decimal('18000.00'),
}
SERVICIOS_INICIALES = tuple(PRECIOS_REFERENCIA)
DESCRIPCIONES_SERVICIO = {
    'Curaciones': 'Limpieza y cuidado de heridas, úlceras o puntos quirúrgicos, con cambio de apósitos.',
    'Inyecciones': 'Aplicación de medicación inyectable indicada por un médico (intramuscular, subcutánea).',
    'Control de signos vitales': 'Control de presión arterial, temperatura, pulso, saturación y glucemia.',
    'Higiene y confort': 'Higiene personal, cambio de ropa de cama y cuidados de confort en el domicilio.',
    'Acompañamiento de adultos mayores': 'Acompañamiento y asistencia en las actividades diarias.',
    'Cuidados Intensivos': 'Atención de pacientes con alta complejidad o dependencia en el domicilio.',
}


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
        # Atributos del diagrama de clases: Paciente.obraSocial y Servicio.descripcion.
        if 'obraSocial' not in columnas_paciente:
            connection.execute(text('ALTER TABLE pacientes ADD COLUMN obraSocial VARCHAR(100) NULL'))
        columnas_servicio = {columna['name'] for columna in inspect(connection).get_columns('servicios')}
        if 'descripcion' not in columnas_servicio:
            connection.execute(text('ALTER TABLE servicios ADD COLUMN descripcion VARCHAR(255) NULL'))
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
    """Cargar el catálogo inicial en una base vacía y completar precios o descripciones que nunca se cargaron.

    Con servicios ya cargados no agrega los que falten: el administrador puede haberlos renombrado
    desde el panel (SCRUM-30/50) y volver a crearlos los duplicaría.
    """
    if Servicio.query.count() == 0:
        for tipo, precio in PRECIOS_REFERENCIA.items():
            db.session.add(Servicio(tipoServicio=tipo, precioEstimado=precio,
                                    descripcion=DESCRIPCIONES_SERVICIO[tipo]))
        db.session.commit()
        return
    for servicio in Servicio.query.filter(Servicio.tipoServicio.in_(SERVICIOS_INICIALES)).all():
        # Nunca pisa un precio o una descripción que alguien ya cargó (ni una descripción borrada a propósito).
        if servicio.precioEstimado is None:
            servicio.precioEstimado = PRECIOS_REFERENCIA[servicio.tipoServicio]
        if servicio.descripcion is None:
            servicio.descripcion = DESCRIPCIONES_SERVICIO[servicio.tipoServicio]
    db.session.commit()
