"""Dirección escrita <-> punto del mapa con el buscador de OpenStreetMap (Nominatim).

Se consulta desde el servidor y no desde el navegador para cumplir la política de uso de Nominatim
(un agente identificado y como mucho un pedido por segundo) y para guardar en memoria las búsquedas repetidas.
GEOCODIFICAR_URL permite usar un servidor propio o contratado en producción.
"""
import json
import os
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict

URL = (os.getenv('GEOCODIFICAR_URL') or 'https://nominatim.openstreetmap.org').rstrip('/')
AGENTE = os.getenv('GEOCODIFICAR_AGENTE') or 'Enfered/1.0 (proyecto de practica profesionalizante)'
TIMEOUT_SEGUNDOS = 5
MAX_DIRECCION = 200
# Zonas (oeste, norte, este, sur) en el orden en que se busca: primero el Gran Mendoza (Capital, Godoy Cruz,
# Guaymallén, Las Heras, Maipú y Luján), después la provincia y por último todo el país. Si se buscara de entrada
# en toda la provincia, "San Martín 1200, Mendoza" podría caer en otra ciudad con una calle igual.
ZONAS = ('-69.05,-32.70,-68.55,-33.15', '-70.6,-32.0,-66.5,-37.6', None)
INTERVALO_MINIMO = 1.0
MAX_CACHE = 500


class ErrorGeocodificacion(Exception):
    """El servicio de direcciones no respondió o respondió algo que no se entiende."""


_cache = OrderedDict()
_candado = threading.Lock()
_ultimo_pedido = [0.0]


def _normalizar(texto):
    texto = unicodedata.normalize('NFKC', str(texto or '')).strip()
    return ' '.join(texto.split())


def _desde_cache(clave):
    with _candado:
        if clave in _cache:
            _cache.move_to_end(clave)
            return True, _cache[clave]
    return False, None


def _guardar_cache(clave, valor):
    with _candado:
        _cache[clave] = valor
        _cache.move_to_end(clave)
        while len(_cache) > MAX_CACHE:
            _cache.popitem(last=False)


def _pedir(ruta, parametros):
    # Política de Nominatim: como mucho un pedido por segundo desde este servidor.
    with _candado:
        espera = INTERVALO_MINIMO - (time.monotonic() - _ultimo_pedido[0])
        if espera > 0:
            time.sleep(espera)
        _ultimo_pedido[0] = time.monotonic()
    url = f'{URL}/{ruta}?{urllib.parse.urlencode({**parametros, "format": "jsonv2", "accept-language": "es"})}'
    pedido = urllib.request.Request(url, headers={'User-Agent': AGENTE})
    try:
        with urllib.request.urlopen(pedido, timeout=TIMEOUT_SEGUNDOS) as respuesta:
            return json.loads(respuesta.read().decode('utf-8'))
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise ErrorGeocodificacion(str(error)) from error


def _descripcion(lugar):
    """Texto corto para mostrar: calle y número, y la localidad."""
    direccion = lugar.get('address') or {}
    calle = ' '.join(filter(None, [direccion.get('road') or direccion.get('pedestrian'), direccion.get('house_number')]))
    localidad = (direccion.get('city') or direccion.get('town') or direccion.get('village')
                 or direccion.get('suburb') or direccion.get('county'))
    texto = ', '.join(filter(None, [calle, localidad]))
    return texto or (lugar.get('display_name') or '').split(', Argentina')[0][:MAX_DIRECCION] or None


def buscar_direccion(texto):
    """{'latitud', 'longitud', 'descripcion'} de una dirección escrita, o None si no se encuentra."""
    texto = _normalizar(texto)
    if not texto:
        return None
    clave = ('buscar', texto.lower())
    encontrado, valor = _desde_cache(clave)
    if encontrado:
        return valor
    con_numero = any(caracter.isdigit() for caracter in texto)
    # Si la persona escribió un número, sirve más el resultado con ese número de casa que uno de la calle entera;
    # el primero que aparezca queda de respaldo por si ninguno lo tiene.
    respaldo = None
    for parametros in _intentos(texto):
        lugares = _pedir('search', {'countrycodes': 'ar', 'limit': 5, 'addressdetails': 1, **parametros})
        if not isinstance(lugares, list) or not lugares:
            continue
        exacto = next((l for l in lugares if (l.get('address') or {}).get('house_number')), None)
        if exacto or not con_numero:
            respaldo = exacto or lugares[0]
            break
        respaldo = respaldo or lugares[0]
    resultado = _punto(respaldo) if respaldo else None
    _guardar_cache(clave, resultado)
    return resultado


# En Mendoza se escribe "Mendoza" o "Capital" por la Ciudad de Mendoza; para el buscador es toda la provincia.
CAPITAL = {'mendoza', 'capital', 'mendoza capital', 'capital mendoza', 'ciudad de mendoza'}


def _intentos(texto):
    """Búsquedas a probar en orden; la primera que encuentra la dirección corta las demás."""
    partes = [parte.strip() for parte in texto.split(',') if parte.strip()]
    intentos = []
    if len(partes) > 1 and partes[-1].lower() in CAPITAL:
        intentos.append({'q': ', '.join([*partes[:-1], 'Ciudad de Mendoza']), 'viewbox': ZONAS[0], 'bounded': 1})
    elif len(partes) > 1:
        # "Lavalle 300, Las Heras": por campos, para que la localidad no se confunda con una calle o un departamento.
        intentos.append({'street': partes[0], 'city': partes[1], 'state': 'Mendoza'})
    for zona in ZONAS:
        intentos.append({'q': texto, **({'viewbox': zona, 'bounded': 1} if zona else {})})
    return intentos


def _punto(lugar):
    try:
        return {
            'latitud': round(float(lugar['lat']), 6),
            'longitud': round(float(lugar['lon']), 6),
            'descripcion': _descripcion(lugar),
        }
    except (KeyError, TypeError, ValueError) as error:
        raise ErrorGeocodificacion('Respuesta sin coordenadas') from error


def direccion_de(latitud, longitud):
    """Dirección aproximada (calle, número y localidad) de un punto, o None."""
    clave = ('inversa', round(latitud, 5), round(longitud, 5))
    encontrado, valor = _desde_cache(clave)
    if encontrado:
        return valor
    lugar = _pedir('reverse', {'lat': latitud, 'lon': longitud, 'zoom': 18, 'addressdetails': 1})
    resultado = _descripcion(lugar) if isinstance(lugar, dict) and not lugar.get('error') else None
    _guardar_cache(clave, resultado)
    return resultado
