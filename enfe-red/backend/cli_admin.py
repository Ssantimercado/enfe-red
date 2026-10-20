"""Comandos de consola para verificar matrículas y provisionar administradores.

Los comandos de matrícula siguen disponibles para la preparación local:

    flask --app app enfermeros-pendientes
    flask --app app verificar-enfermero laura.gomez@test.com
    flask --app app verificar-enfermero laura.gomez@test.com --quitar
    flask --app app asignar-administrador pablo@example.com --nivel-permiso total
"""
import click
from flask.cli import with_appcontext

from database import db
from models.usuario_models import Enfermero, Usuario


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
