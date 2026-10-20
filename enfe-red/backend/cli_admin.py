"""Comandos de consola para verificar matrículas mientras no exista el panel de administración.

SCRUM-47 / HU9: el panel con aprobación y rechazo se hace en el Sprint 6 (70.1 de Pablo).
Hasta entonces, el equipo puede validar enfermeros para las demostraciones:

    flask --app app enfermeros-pendientes
    flask --app app verificar-enfermero laura.gomez@test.com
    flask --app app verificar-enfermero laura.gomez@test.com --quitar
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
