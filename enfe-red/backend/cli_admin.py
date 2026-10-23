"""Comandos de consola para verificar matrículas y provisionar administradores.

Los comandos de matrícula siguen disponibles para la preparación local:

    flask --app app enfermeros-pendientes
    flask --app app verificar-enfermero laura.gomez@test.com
    flask --app app verificar-enfermero laura.gomez@test.com --quitar
    flask --app app asignar-administrador pablo@example.com --nivel-permiso total
    flask --app app cargar-demo
    flask --app app vencer-solicitudes
    flask --app app preparar-bd
    flask --app app recifrar-historiales
"""
import click
from flask.cli import with_appcontext

from database import db
from models.usuario_models import Enfermero, Usuario
from preparar_bd import preparar_base
from schema_mejoras import recifrar_historiales
from seed_sprint3 import cargar_datos_demo
from services.turnos import ahora_local, vencer_solicitudes


@click.command('enfermeros-pendientes')
@with_appcontext
def enfermeros_pendientes():
    """Listar los enfermeros que todavía no tienen la matrícula verificada."""
    pendientes = (
        db.session.query(Enfermero, Usuario)
        .join(Usuario, Usuario.id == Enfermero.usuario_id)
        .filter(Enfermero.verificado.is_(False))
        .order_by(Enfermero.id)
        .all()
    )
    if not pendientes:
        click.echo('No hay enfermeros pendientes de verificación.')
        return
    for enfermero, usuario in pendientes:
        nombre = ' '.join(filter(None, [enfermero.nombre, enfermero.apellido])) or '(sin nombre)'
        click.echo(f'{usuario.email}\t{nombre}\tmatrícula {enfermero.matricula}')


@click.command('verificar-enfermero')
@click.argument('email')
@click.option('--quitar', is_flag=True, help='Volver a dejar la matrícula como pendiente.')
@with_appcontext
def verificar_enfermero(email, quitar):
    """Marcar como verificada (o pendiente, con --quitar) la matrícula del enfermero con ese email."""
    enfermero = (
        Enfermero.query.join(Usuario, Usuario.id == Enfermero.usuario_id)
        .filter(Usuario.email == email.strip())
        .first()
    )
    if not enfermero:
        raise click.ClickException(f'No hay un enfermero registrado con el email {email}.')
    if enfermero.matricula.startswith('PENDIENTE-') and not quitar:
        raise click.ClickException('El enfermero todavía no cargó su matrícula en el perfil.')
    enfermero.verificado = not quitar
    db.session.commit()
    estado = 'pendiente' if quitar else 'verificada'
    click.echo(f'Matrícula {enfermero.matricula} de {email} marcada como {estado}.')


def registrar_comandos(app):
    app.cli.add_command(enfermeros_pendientes)
    app.cli.add_command(verificar_enfermero)
    app.cli.add_command(asignar_administrador)
    app.cli.add_command(cargar_demo)
    app.cli.add_command(vencer_solicitudes_pendientes)
    app.cli.add_command(preparar_bd)
    app.cli.add_command(recifrar_historiales_cmd)


@click.command('asignar-administrador')
@click.argument('email')
@click.option('--nivel-permiso', default='total', show_default=True)
@with_appcontext
def asignar_administrador(email, nivel_permiso):
    """Promover una cuenta existente a administrador desde la consola local."""
    usuario = Usuario.query.filter_by(email=email.strip()).first()
    if not usuario:
        raise click.ClickException(f'No hay una cuenta registrada con el email {email}.')
    if not nivel_permiso.strip():
        raise click.ClickException('El nivel de permiso no puede estar vacío.')
    usuario.rol = 'administrador'
    usuario.nivelPermiso = nivel_permiso.strip()[:30]
    usuario.suspendido = False
    db.session.commit()
    click.echo(f'{email} ahora es administrador ({usuario.nivelPermiso}). Iniciá sesión de nuevo.')


@click.command('cargar-demo')
@with_appcontext
def cargar_demo():
    """Crear las cuentas demo de enfermeros (clave 123456). Solo para pruebas locales."""
    try:
        creadas = cargar_datos_demo()
    except Exception as error:
        db.session.rollback()
        raise click.ClickException(f'No se pudieron cargar las cuentas demo: {error}') from error
    click.echo(f'Cuentas demo listas ({creadas} nuevas). No las uses en producción.')


@click.command('vencer-solicitudes')
@with_appcontext
def vencer_solicitudes_pendientes():
    """Pasar a Vencida las solicitudes Pendientes cuyo turno ya pasó y avisar a cada paciente.

    Las bandejas ya lo hacen al consultarse; este comando sirve para correrlo cada tanto (cron).
    """
    vencidas = vencer_solicitudes(ahora_local())
    click.echo(f'Solicitudes vencidas: {vencidas}.')


@click.command('preparar-bd')
@with_appcontext
def preparar_bd():
    """Crear las tablas que falten y aplicar las migraciones pendientes, sin borrar datos.

    Correrlo en cada despliegue, antes de levantar serve.py. Se puede repetir sin problema.
    """
    try:
        preparar_base()
    except Exception as error:
        db.session.rollback()
        raise click.ClickException(f'No se pudo preparar la base de datos: {type(error).__name__}: {error}') from error
    click.echo('Base de datos lista.')


@click.command('recifrar-historiales')
@with_appcontext
def recifrar_historiales_cmd():
    """Cifrar los historiales con CLAVE_CIFRADO_DATOS (los de CLAVE_CIFRADO_ANTERIOR se pasan a la nueva)."""
    try:
        cambiados, ilegibles = recifrar_historiales()
    except RuntimeError as error:
        raise click.ClickException(str(error)) from error
    click.echo(f'Historiales cifrados con la clave actual: {cambiados}.')
    if ilegibles:
        raise click.ClickException(
            f'{ilegibles} historiales no se pudieron abrir con ninguna clave. Poné la clave con la que se '
            'cifraron en CLAVE_CIFRADO_ANTERIOR y volvé a correr este comando.'
        )
