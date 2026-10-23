"""Mejoras posteriores al Sprint 6: sesión, límites, recuperación, privacidad, turnos y moderación en bases existentes, sin recrear datos."""
from flask import current_app
from sqlalchemy import inspect, text
from sqlalchemy.types import Text

from database import db
from models.acceso_models import CodigoRecuperacion, IntentoAcceso
from models.auditoria_models import AuditoriaAdmin
from models.calificacion_models import MAX_MOTIVO_MODERACION
from models.notificacion_models import CHECK_TIPO_NOTIFICACION, TIPOS_NOTIFICACION
from models.servicio_models import DURACION_POR_DEFECTO
from models.solicitud_models import CHECK_ESTADO_SOLICITUD, ESTADOS_SOLICITUD, MAX_MOTIVO_CANCELACION
from models.usuario_models import MAX_MOTIVO_RECHAZO
from services.cifrado import ErrorCifrado, cifrado_activo, recifrar


def inicializar_bd_mejoras():
    inspector = inspect(db.engine)
    columnas = {columna['name'] for columna in inspector.get_columns('usuarios')}
    with db.engine.begin() as connection:
        if 'versionToken' not in columnas:
            # Las cuentas existentes arrancan en 0: sus sesiones actuales siguen valiendo.
            connection.execute(text(
                'ALTER TABLE usuarios ADD COLUMN versionToken INTEGER NOT NULL DEFAULT 0'
            ))
        if 'eliminado' not in columnas:
            connection.execute(text(
                'ALTER TABLE usuarios ADD COLUMN eliminado BOOLEAN NOT NULL DEFAULT FALSE'
            ))
        # db.create_all ya las crea al arrancar; esto deja el módulo completo por sí solo.
        IntentoAcceso.__table__.create(connection, checkfirst=True)
        CodigoRecuperacion.__table__.create(connection, checkfirst=True)
        AuditoriaAdmin.__table__.create(connection, checkfirst=True)
    _agregar_columnas_turnos()
    _agregar_columnas_moderacion()
    _actualizar_restriccion('notificaciones', 'ck_notificacion_tipo', CHECK_TIPO_NOTIFICACION,
                            TIPOS_NOTIFICACION, crear_si_falta=True)
    # Si la base nunca tuvo la restricción de estados, no se agrega: filas viejas podrían no cumplirla.
    _actualizar_restriccion('solicitudes_servicio', 'ck_solicitud_estado', CHECK_ESTADO_SOLICITUD,
                            ESTADOS_SOLICITUD, crear_si_falta=False)
    _cifrar_historiales()


def _agregar_columnas_turnos():
    """Duración del servicio y datos de la cancelación (quién y por qué)."""
    inspector = inspect(db.engine)
    with db.engine.begin() as connection:
        if inspector.has_table('servicios'):
            columnas = {columna['name'] for columna in inspector.get_columns('servicios')}
            if 'duracionMinutos' not in columnas:
                # Los servicios existentes quedan en 60 minutos, lo que se asumía hasta ahora.
                connection.execute(text(
                    f'ALTER TABLE servicios ADD COLUMN duracionMinutos INTEGER NOT NULL '
                    f'DEFAULT {DURACION_POR_DEFECTO}'
                ))
        if inspector.has_table('solicitudes_servicio'):
            columnas = {columna['name'] for columna in inspector.get_columns('solicitudes_servicio')}
            if 'canceladaPor' not in columnas:
                connection.execute(text('ALTER TABLE solicitudes_servicio ADD COLUMN canceladaPor VARCHAR(20) NULL'))
            if 'motivoCancelacion' not in columnas:
                connection.execute(text(
                    f'ALTER TABLE solicitudes_servicio ADD COLUMN motivoCancelacion '
                    f'VARCHAR({MAX_MOTIVO_CANCELACION}) NULL'
                ))


def _agregar_columnas_moderacion():
    """Respaldo de la revisión de matrículas y moderación de reseñas."""
    inspector = inspect(db.engine)
    nuevas = {
        'enfermeros': {
            'verificadoPor': 'INTEGER NULL',
            'verificadoEn': 'DATETIME NULL',
            'motivoRechazo': f'VARCHAR({MAX_MOTIVO_RECHAZO}) NULL',
        },
        # Las reseñas existentes quedan visibles y sin denuncias.
        'calificaciones_servicio': {
            'oculta': 'BOOLEAN NOT NULL DEFAULT FALSE',
            'motivoOcultamiento': f'VARCHAR({MAX_MOTIVO_MODERACION}) NULL',
            'denunciada': 'BOOLEAN NOT NULL DEFAULT FALSE',
            'motivoDenuncia': f'VARCHAR({MAX_MOTIVO_MODERACION}) NULL',
            'denunciaRevisada': 'BOOLEAN NOT NULL DEFAULT FALSE',
        },
    }
    with db.engine.begin() as connection:
        for tabla, columnas_nuevas in nuevas.items():
            if not inspector.has_table(tabla):
                continue
            columnas = {columna['name'] for columna in inspector.get_columns(tabla)}
            for nombre, definicion in columnas_nuevas.items():
                if nombre not in columnas:
                    connection.execute(text(f'ALTER TABLE {tabla} ADD COLUMN {nombre} {definicion}'))


def _actualizar_restriccion(tabla, nombre, condicion, valores, crear_si_falta):
    """Recrea una restricción CHECK de MySQL/MariaDB cuando le faltan valores nuevos."""
    inspector = inspect(db.engine)
    if db.engine.dialect.name != 'mysql' or not inspector.has_table(tabla):
        # SQLite (pruebas) crea la tabla de cero con la restricción nueva.
        return
    restriccion = next((
        check for check in inspector.get_check_constraints(tabla) if check.get('name') == nombre
    ), None)
    if restriccion is None and not crear_si_falta:
        return
    if restriccion is not None and all(f"'{valor}'" in restriccion.get('sqltext', '') for valor in valores):
        return
    with db.engine.begin() as connection:
        if restriccion is not None:
            connection.execute(text(f'ALTER TABLE {tabla} DROP CONSTRAINT {nombre}'))
        connection.execute(text(f'ALTER TABLE {tabla} ADD CONSTRAINT {nombre} CHECK ({condicion})'))


def _cifrar_historiales():
    """El historial médico pasa a guardarse cifrado: la columna debe ser TEXT (el token ocupa más)."""
    inspector = inspect(db.engine)
    if not inspector.has_table('pacientes'):
        return
    columna = next((c for c in inspector.get_columns('pacientes') if c['name'] == 'historial_medico'), None)
    if columna is None:
        return
    es_texto = isinstance(columna['type'], Text) and 'TINY' not in str(columna['type']).upper()
    if db.engine.dialect.name == 'mysql' and not es_texto:
        with db.engine.begin() as connection:
            connection.execute(text('ALTER TABLE pacientes MODIFY historial_medico TEXT NULL'))
    recifrar_historiales()


def recifrar_historiales():
    """Cifra con la clave actual los historiales en texto plano o cifrados con una clave anterior.

    Sin clave propia (desarrollo) no toca nada: cifrar con una clave de prueba dejaría los datos
    ilegibles al configurar la real. Devuelve (cambiados, ilegibles); se puede repetir.
    """
    if not cifrado_activo():
        current_app.logger.warning(
            'Historiales médicos sin cifrar: falta CLAVE_CIFRADO_DATOS. Se cifran al configurarla '
            'y correr flask --app app preparar-bd.'
        )
        return 0, 0
    cambiados = ilegibles = 0
    with db.engine.begin() as connection:
        filas = connection.execute(text(
            "SELECT id, historial_medico FROM pacientes WHERE historial_medico IS NOT NULL AND historial_medico <> ''"
        )).all()
        for id_paciente, valor in filas:
            try:
                nuevo = recifrar(valor)
            except ErrorCifrado:
                # Se deja como está: con la clave correcta en CLAVE_CIFRADO_ANTERIOR se recupera.
                ilegibles += 1
                continue
            if nuevo is not None:
                connection.execute(
                    text('UPDATE pacientes SET historial_medico = :valor WHERE id = :id'),
                    {'valor': nuevo, 'id': id_paciente},
                )
                cambiados += 1
    if cambiados:
        current_app.logger.info('Historiales médicos cifrados con la clave actual: %s.', cambiados)
    if ilegibles:
        current_app.logger.error(
            'Hay %s historiales médicos que ninguna clave configurada puede abrir: poné la clave con la que '
            'se cifraron en CLAVE_CIFRADO_ANTERIOR y corré flask --app app recifrar-historiales.', ilegibles,
        )
    return cambiados, ilegibles
