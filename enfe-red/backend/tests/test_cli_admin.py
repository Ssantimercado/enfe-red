"""Comandos de consola para verificar matrículas (SCRUM-47) hasta el panel del Sprint 6."""
import unittest

from flask import Flask

from cli_admin import registrar_comandos
from database import db
from models.usuario_models import Enfermero, Usuario


class CliAdminTest(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:')
        db.init_app(self.app)
        registrar_comandos(self.app)
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=21, email='laura@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=22, email='nuevo@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=11, email='paciente@test.local', password_hash='x', rol='paciente'),
        ])
        db.session.flush()
        db.session.add_all([
            Enfermero(id=201, usuario_id=21, nombre='Laura', matricula='MP-1234'),
            Enfermero(id=202, usuario_id=22, nombre='Nuevo', matricula='PENDIENTE-22'),
        ])
        db.session.commit()
        self.runner = self.app.test_cli_runner()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def test_listar_verificar_y_quitar(self):
        pendientes = self.runner.invoke(args=['enfermeros-pendientes'])
        self.assertIn('laura@test.local', pendientes.output)
        self.assertIn('nuevo@test.local', pendientes.output)

        resultado = self.runner.invoke(args=['verificar-enfermero', 'laura@test.local'])
        self.assertEqual(resultado.exit_code, 0, resultado.output)
        self.assertTrue(db.session.get(Enfermero, 201).verificado)
        self.assertNotIn('laura@test.local', self.runner.invoke(args=['enfermeros-pendientes']).output)

        self.runner.invoke(args=['verificar-enfermero', 'laura@test.local', '--quitar'])
        self.assertFalse(db.session.get(Enfermero, 201).verificado)

    def test_errores_claros(self):
        for email in ('nadie@test.local', 'paciente@test.local'):
            resultado = self.runner.invoke(args=['verificar-enfermero', email])
            self.assertNotEqual(resultado.exit_code, 0)
            self.assertIn('No hay un enfermero', resultado.output)
        sin_matricula = self.runner.invoke(args=['verificar-enfermero', 'nuevo@test.local'])
        self.assertNotEqual(sin_matricula.exit_code, 0)
        self.assertIn('todavía no cargó su matrícula', sin_matricula.output)
        self.assertFalse(db.session.get(Enfermero, 202).verificado)


if __name__ == '__main__':
    unittest.main()
