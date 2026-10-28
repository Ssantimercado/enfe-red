"""HU16: ubicar en el mapa la dirección escrita y escribir la dirección de un punto (Nominatim simulado)."""
import io
import json
import unittest
import urllib.error
import urllib.parse
from unittest.mock import patch

from flask import Flask
from flask_jwt_extended import JWTManager, create_access_token

from routes.mapa_routes import mapa_bp
from services import geocodificacion


def respuesta(datos):
    return io.BytesIO(json.dumps(datos).encode('utf-8'))


class GeocodificacionTest(unittest.TestCase):
    def setUp(self):
        app = Flask(__name__)
        app.config.update(TESTING=True, JWT_SECRET_KEY='clave-de-prueba-suficientemente-larga-123')
        JWTManager(app)
        app.register_blueprint(mapa_bp, url_prefix='/api')
        self.client = app.test_client()
        with app.app_context():
            self.headers = {'Authorization': 'Bearer ' + create_access_token(identity='11')}
        geocodificacion._cache.clear()
        # Sin esperar el segundo entre pedidos durante las pruebas.
        self.intervalo = patch.object(geocodificacion, 'INTERVALO_MINIMO', 0)
        self.intervalo.start()
        self.pedidos = []

    def tearDown(self):
        self.intervalo.stop()

    def nominatim(self, *respuestas):
        cola = list(respuestas)

        def abrir(pedido, timeout):
            self.pedidos.append(pedido)
            self.assertEqual(timeout, geocodificacion.TIMEOUT_SEGUNDOS)
            siguiente = cola.pop(0)
            if isinstance(siguiente, Exception):
                raise siguiente
            return respuesta(siguiente)
        return patch('services.geocodificacion.urllib.request.urlopen', side_effect=abrir)

    def test_ubica_una_direccion_de_mendoza(self):
        lugar = {'lat': '-32.927', 'lon': '-68.845', 'display_name': 'Belgrano 50, Godoy Cruz, Mendoza, Argentina',
                 'address': {'road': 'Belgrano', 'house_number': '50', 'city': 'Godoy Cruz'}}
        with self.nominatim([lugar]):
            r = self.client.get('/api/geocodificar', query_string={'direccion': ' Belgrano 50,  Godoy Cruz '},
                                headers=self.headers)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json, {'latitud': -32.927, 'longitud': -68.845, 'descripcion': 'Belgrano 50, Godoy Cruz'})
        pedido = self.pedidos[0]
        consulta = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(pedido.full_url).query))
        # Con localidad, primero por campos (calle y localidad), con agente identificado (política de Nominatim).
        self.assertEqual((consulta['street'], consulta['city'], consulta['state'], consulta['countrycodes']),
                         ('Belgrano 50', 'Godoy Cruz', 'Mendoza', 'ar'))
        self.assertTrue(pedido.get_header('User-agent').startswith('Enfered'))

    def test_si_no_esta_en_mendoza_busca_en_el_pais_y_guarda_en_memoria(self):
        # Gran Mendoza y provincia sin resultados; aparece al buscar en todo el país.
        lugar = {'lat': '-34.6', 'lon': '-58.4', 'address': {'road': 'Corrientes', 'house_number': '1000', 'city': 'Buenos Aires'}}
        with self.nominatim([], [], [], [lugar]):
            primera = self.client.get('/api/geocodificar?direccion=Corrientes 1000, CABA', headers=self.headers)
            segunda = self.client.get('/api/geocodificar?direccion=corrientes 1000, caba', headers=self.headers)
        self.assertEqual(primera.json['descripcion'], 'Corrientes 1000, Buenos Aires')
        self.assertEqual(segunda.json, primera.json)
        self.assertEqual(len(self.pedidos), 4)
        self.assertNotIn('viewbox', urllib.parse.urlsplit(self.pedidos[3].full_url).query)

    def test_mendoza_es_la_ciudad_y_se_prefiere_el_numero_de_casa(self):
        calle = {'lat': '-33.13', 'lon': '-68.89', 'address': {'road': 'Avenida San Martín', 'town': 'Agrelo'}}
        casa = {'lat': '-32.8893', 'lon': '-68.8391',
                'address': {'road': 'Avenida General San Martín', 'house_number': '1200', 'city': 'Ciudad de Mendoza'}}
        with self.nominatim([casa]):
            r = self.client.get('/api/geocodificar?direccion=Av. San Martín 1200, Mendoza', headers=self.headers)
        self.assertEqual(r.json['descripcion'], 'Avenida General San Martín 1200, Ciudad de Mendoza')
        consulta = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.pedidos[0].full_url).query))
        self.assertEqual(consulta['q'], 'Av. San Martín 1200, Ciudad de Mendoza')
        # Sin número de casa en ninguna zona: queda el primer resultado encontrado.
        self.pedidos.clear()
        with self.nominatim([calle], [], [], []):
            r = self.client.get('/api/geocodificar?direccion=San Martín 999, Luján', headers=self.headers)
        self.assertEqual((r.json['latitud'], r.json['descripcion']), (-33.13, 'Avenida San Martín, Agrelo'))
        self.assertEqual(len(self.pedidos), 4)

    def test_direccion_inexistente_vacia_o_servicio_caido(self):
        with self.nominatim([], [], []):
            self.assertEqual(self.client.get('/api/geocodificar?direccion=zzzz', headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get('/api/geocodificar?direccion=', headers=self.headers).status_code, 400)
        self.assertEqual(self.client.get('/api/geocodificar?direccion=' + 'a' * 201, headers=self.headers).status_code, 400)
        with self.nominatim(urllib.error.URLError('sin red')):
            caido = self.client.get('/api/geocodificar?direccion=Mitre 800', headers=self.headers)
        self.assertEqual(caido.status_code, 503)
        self.assertIn('tocando el mapa', caido.json['error'])
        self.assertEqual(self.client.get('/api/geocodificar?direccion=Mitre 800').status_code, 401)

    def test_escribe_la_direccion_de_la_ubicacion_actual(self):
        lugar = {'address': {'road': 'Avenida San Martín', 'house_number': '1200', 'city': 'Mendoza'}}
        with self.nominatim(lugar):
            r = self.client.get('/api/geocodificar/inversa?lat=-32.8813&lng=-68.8348', headers=self.headers)
        self.assertEqual(r.json, {'direccion': 'Avenida San Martín 1200, Mendoza'})
        for consulta in ('lat=x&lng=1', 'lat=91&lng=0', 'lat=nan&lng=0', 'lng=0'):
            self.assertEqual(self.client.get(f'/api/geocodificar/inversa?{consulta}', headers=self.headers).status_code, 400)
        with self.nominatim({'error': 'Unable to geocode'}):
            self.assertEqual(self.client.get('/api/geocodificar/inversa?lat=0&lng=0', headers=self.headers).status_code, 404)


if __name__ == '__main__':
    unittest.main()
