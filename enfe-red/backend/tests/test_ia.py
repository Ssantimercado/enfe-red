"""HU12: búsqueda asistida por IA con dos niveles (Gemini y reglas). Sin llamadas reales."""
import http.client
import json
import logging
import unittest
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from database import db
from models.servicio_models import Servicio
from models.usuario_models import Enfermero, Paciente, Usuario
import routes.ia_routes as ia_routes
from routes.ia_routes import ia_bp
from services import ia_busqueda
from services.ia_busqueda import AVISO_URGENCIA, IAError, anonimizar, interpretar_con_reglas, validar

PERMITIDOS = {
    'especialidades': ['Cuidados Intensivos', 'General', 'Geriatría', 'Pediatría'],
    'ciudades': ['Godoy Cruz', 'Guaymallén', 'Mendoza Capital'],
    'servicios': ['Control de signos vitales', 'Curaciones', 'Inyecciones'],
}
PEDIDO = 'Necesito que alguien le ponga insulina a mi abuela los martes a la tarde en Godoy Cruz'


class _Respuesta:
    def __init__(self, cuerpo):
        self.cuerpo = json.dumps(cuerpo).encode()

    def read(self):
        return self.cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def gemini_responde(contenido):
    return _Respuesta({'candidates': [{'content': {'parts': [{'text': json.dumps(contenido)}]}}]})


class ReglasTest(unittest.TestCase):
    def test_interpreta_la_frase_tipica(self):
        filtros = validar(interpretar_con_reglas(PEDIDO, PERMITIDOS), PERMITIDOS)
        self.assertEqual(filtros, {
            'especialidad': 'Geriatría', 'ciudad': 'Godoy Cruz', 'dia_semana': 'Martes',
            'hora_desde': '14:00', 'hora_hasta': '18:00', 'servicio': 'Inyecciones', 'aclaracion': None,
        })

    def test_mama_o_papa_no_implican_geriatria(self):
        filtros = interpretar_con_reglas('mi papá tiene fiebre', PERMITIDOS)
        self.assertIsNone(filtros['especialidad'])
        self.assertEqual(filtros['servicio'], 'Control de signos vitales')

    def test_hora_puntual_ciudad_sin_capital_y_niños(self):
        filtros = interpretar_con_reglas('curación para mi nene el sábado a las 10 en Mendoza', PERMITIDOS)
        self.assertEqual((filtros['servicio'], filtros['especialidad'], filtros['dia_semana']),
                         ('Curaciones', 'Pediatría', 'Sábado'))
        self.assertEqual((filtros['hora_desde'], filtros['hora_hasta']), ('10:00', '11:00'))
        self.assertEqual(filtros['ciudad'], 'Mendoza Capital')

    def test_detecta_urgencias(self):
        self.assertEqual(interpretar_con_reglas('Es urgente, mi papá no respira bien', PERMITIDOS)['aclaracion'],
                         AVISO_URGENCIA)

    def test_anonimiza_datos_personales(self):
        texto = anonimizar('Soy ana.perez@mail.com, tel 261 555 1234, DNI 30123456, vivo en calle San Martín 1250')
        for dato in ('ana.perez', '555', '30123456', '1250'):
            self.assertNotIn(dato, texto)
        # Sin "calle" adelante también se quita, pero no las horas, los días ni las edades.
        self.assertEqual(anonimizar('vivo en cayetano silva 1172, Godoy Cruz'), 'vivo en [dirección], Godoy Cruz')
        self.assertEqual(anonimizar('Dirección: Belgrano 450, a las 18 hs'), 'Dirección: [dirección], a las 18 hs')
        for texto in ('mi abuela de 85 años, el martes 15 a las 18', 'desde las 14 hasta las 20', PEDIDO,
                      'kinesiologo turno 14', 'necesito curaciones diarias 15 días en Godoy Cruz',
                      'enfermera de geriatría durante 10 días', 'inyecciones por la mañana 10 a 12',
                      'en la tarde 15 a 18'):
            self.assertEqual(anonimizar(texto), texto)

    def test_validar_descarta_valores_inventados(self):
        filtros = validar({'especialidad': 'Cardiología', 'ciudad': 'Córdoba', 'dia_semana': 'Feriado',
                           'hora_desde': '18:00', 'hora_hasta': '14:00', 'servicio': 'Masajes',
                           'aclaracion': 'Tomá ibuprofeno'}, PERMITIDOS)
        self.assertTrue(all(valor is None for valor in filtros.values()))
        with self.assertRaises(IAError):
            validar('texto', PERMITIDOS)


class ProveedoresTest(unittest.TestCase):
    def setUp(self):
        ia_busqueda._pausa['hasta'] = 0.0

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_lo_que_gemini_no_reconoce_lo_completan_las_reglas(self):
        reglas = ia_busqueda.validar(ia_busqueda.interpretar_con_reglas(PEDIDO, PERMITIDOS), PERMITIDOS)
        self.assertTrue(any(reglas[campo] for campo in ('especialidad', 'ciudad', 'dia_semana', 'hora_desde')))
        with patch('services.ia_busqueda.urllib.request.urlopen', return_value=gemini_responde({'aclaracion': None})):
            filtros, fuente = ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')
        self.assertEqual(fuente, 'gemini')
        self.assertEqual(filtros, reglas)

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_si_gemini_falla_las_busquedas_siguientes_no_lo_esperan(self):
        with patch('services.ia_busqueda.urllib.request.urlopen', side_effect=TimeoutError) as abrir:
            self.assertEqual(ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')[1], 'reglas')
            self.assertEqual(ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')[1], 'reglas')
        self.assertEqual(abrir.call_count, 1)
        # Pasada la pausa se vuelve a probar con Gemini.
        ia_busqueda._pausa['hasta'] = 0.0
        with patch('services.ia_busqueda.urllib.request.urlopen',
                   return_value=gemini_responde({'especialidad': 'Geriatría'})):
            self.assertEqual(ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')[1], 'gemini')

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_gemini_envia_texto_anonimizado_y_esquema_cerrado(self):
        enviado = {}

        def falso_urlopen(req, timeout):
            enviado['url'], enviado['headers'], enviado['cuerpo'] = req.full_url, req.headers, json.loads(req.data)
            return gemini_responde({'especialidad': 'Geriatría', 'ciudad': 'Godoy Cruz', 'dia_semana': 'Martes',
                                    'hora_desde': '15:00', 'hora_hasta': '18:00', 'servicio': 'Inyecciones',
                                    'aclaracion': None})

        with patch('services.ia_busqueda.urllib.request.urlopen', falso_urlopen):
            filtros, fuente = ia_busqueda.interpretar(PEDIDO + ' mi teléfono es 2615551234', PERMITIDOS, 'gemini')
        self.assertEqual(fuente, 'gemini')
        self.assertEqual(filtros['hora_desde'], '15:00')
        self.assertIn('generativelanguage.googleapis.com', enviado['url'])
        self.assertEqual(enviado['headers']['X-goog-api-key'], 'clave-de-prueba')
        self.assertNotIn('2615551234', json.dumps(enviado['cuerpo']))
        esquema = enviado['cuerpo']['generationConfig']['responseSchema']
        self.assertEqual(esquema['properties']['dia_semana']['enum'][0], 'Lunes')

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_si_la_ia_falla_usa_las_reglas(self):
        with patch('services.ia_busqueda.urllib.request.urlopen', side_effect=TimeoutError()):
            filtros, fuente = ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')
        self.assertEqual((fuente, filtros['servicio']), ('reglas', 'Inyecciones'))

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_si_se_corta_la_conexion_usa_las_reglas(self):
        # Cortes de red que no son URLError: antes terminaban en un 500.
        for falla in (ConnectionResetError(), http.client.RemoteDisconnected(), http.client.IncompleteRead(b'')):
            with self.subTest(falla=type(falla).__name__):
                with patch('services.ia_busqueda.urllib.request.urlopen', side_effect=falla):
                    filtros, fuente = ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')
                self.assertEqual((fuente, filtros['servicio']), ('reglas', 'Inyecciones'))

    @patch.dict('os.environ', {'GEMINI_API_KEY': ''})
    def test_gemini_sin_clave_usa_las_reglas(self):
        self.assertEqual(ia_busqueda.interpretar(PEDIDO, PERMITIDOS, 'gemini')[1], 'reglas')

    @patch.dict('os.environ', {'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_el_aviso_de_urgencia_no_depende_del_modelo(self):
        with patch('services.ia_busqueda.urllib.request.urlopen',
                   return_value=gemini_responde({'aclaracion': None})):
            filtros, _ = ia_busqueda.interpretar('urgente, se desmayó', PERMITIDOS, 'gemini')
        self.assertEqual(filtros['aclaracion'], AVISO_URGENCIA)


class EndpointTest(unittest.TestCase):
    def setUp(self):
        ia_busqueda._pausa['hasta'] = 0.0
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                               JWT_SECRET_KEY='testing-key-with-at-least-32-characters')
        db.init_app(self.app)
        JWTManager(self.app)
        self.app.register_blueprint(ia_bp, url_prefix='/api')
        self.context = self.app.app_context()
        self.context.push()
        db.create_all()
        db.session.add_all([
            Usuario(id=11, email='p@test.local', password_hash='x', rol='paciente'),
            Usuario(id=21, email='e@test.local', password_hash='x', rol='enfermero'),
            Usuario(id=22, email='s@test.local', password_hash='x', rol='enfermero', suspendido=True),
        ])
        db.session.flush()
        db.session.add_all([
            Paciente(id=101, usuario_id=11, nombre='Ana'),
            Enfermero(id=201, usuario_id=21, nombre='Laura', matricula='MP-1', especialidad='Geriatría',
                      ciudad='Godoy Cruz', verificado=True, disponible=True),
            # Suspendido: su ciudad y especialidad no deben ofrecerse como filtros.
            Enfermero(id=202, usuario_id=22, nombre='X', matricula='MP-2', especialidad='Cardiología',
                      ciudad='San Rafael', verificado=True, disponible=True),
            Servicio(idServicio=301, tipoServicio='Inyecciones'),
        ])
        db.session.commit()
        ia_routes._uso.clear()
        self.client = self.app.test_client()

    def tearDown(self):
        db.session.remove()
        db.drop_all()
        db.engine.dispose()
        self.context.pop()

    def pedir(self, texto, usuario=11):
        headers = {'Authorization': 'Bearer ' + create_access_token(identity=str(usuario))}
        return self.client.post('/api/ia/interpretar-busqueda', headers=headers, json={'texto': texto})

    @patch.dict('os.environ', {'IA_PROVEEDOR': 'reglas'})
    def test_devuelve_filtros_solo_con_valores_del_sistema(self):
        respuesta = self.pedir('insulina para mi abuela el martes en San Rafael o Godoy Cruz')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['fuente'], 'reglas')
        filtros = respuesta.json['filtros']
        self.assertEqual((filtros['servicio'], filtros['especialidad'], filtros['ciudad'], filtros['dia_semana']),
                         ('Inyecciones', 'Geriatría', 'Godoy Cruz', 'Martes'))

    def test_valida_rol_y_texto(self):
        self.assertEqual(self.pedir('hola', usuario=21).status_code, 403)
        self.assertEqual(self.pedir('   ').status_code, 400)
        self.assertEqual(self.pedir('x' * 301).status_code, 400)
        self.assertEqual(self.client.post('/api/ia/interpretar-busqueda', json={'texto': 'hola'}).status_code, 401)

    @patch.dict('os.environ', {'IA_PROVEEDOR': 'gemini', 'GEMINI_API_KEY': 'clave-de-prueba'})
    def test_si_gemini_corta_la_conexion_responde_con_las_reglas(self):
        with patch('services.ia_busqueda.urllib.request.urlopen', side_effect=ConnectionResetError()):
            respuesta = self.pedir('insulina para mi abuela el martes en Godoy Cruz')
        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json['fuente'], 'reglas')
        self.assertEqual(respuesta.json['filtros']['servicio'], 'Inyecciones')

    def test_limite_de_uso(self):
        for _ in range(10):
            self.assertEqual(self.pedir('curación').status_code, 200)
        self.assertEqual(self.pedir('curación').status_code, 429)

    def test_el_log_no_guarda_el_texto(self):
        with self.assertLogs(self.app.logger, level=logging.INFO) as registro:
            self.pedir('mi mamá tiene diabetes y vive en Godoy Cruz')
        self.assertFalse(any('diabetes' in linea for linea in registro.output))
        self.assertTrue(any('fuente=' in linea for linea in registro.output))


if __name__ == '__main__':
    unittest.main()
