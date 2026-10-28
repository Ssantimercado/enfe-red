"""HU12: búsqueda en lenguaje natural con dos niveles.

1. Gemini (API de Google, con los créditos de Google AI Pro: el uso pago no se usa para entrenar).
2. Reglas propias (palabras clave): siempre disponibles, también como respaldo si la IA falla.

La IA solo completa filtros de la cartilla: nunca da indicaciones médicas. El texto se anonimiza
antes de enviarse, no se guarda y no se escribe en los logs.
"""
import http.client
import json
import os
import re
import unicodedata
import urllib.request

DIAS = ('Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo')
MAX_TEXTO = 300
# Si Gemini no contesta en 5 segundos se usan las reglas: más espera se siente como que la búsqueda no anda.
TIMEOUT_SEGUNDOS = 5

# Franjas para expresiones como "a la tarde". Rangos cortos para que coincidan con más horarios cargados.
FRANJAS = {
    'mañana': ('08:00', '12:00'),
    'manana': ('08:00', '12:00'),
    'mediodia': ('12:00', '14:00'),
    'tarde': ('14:00', '18:00'),
    'noche': ('20:00', '23:00'),
}
# Palabras clave → tipo de servicio del catálogo.
CLAVES_SERVICIO = {
    'Inyecciones': ('inyec', 'insulina', 'aplicar', 'vacuna', 'intramuscular', 'subcutan', 'pinchazo'),
    'Curaciones': ('curacion', 'curar', 'herida', 'ulcera', 'escara', 'puntos', 'vendaje', 'aposito'),
    'Control de signos vitales': ('presion', 'signos vitales', 'glucemia', 'azucar', 'temperatura', 'saturacion',
                                  'fiebre'),
    'Higiene y confort': ('higiene', 'banar', 'baño', 'bano', 'aseo', 'cambiar pañal', 'panal'),
    'Acompañamiento de adultos mayores': ('acompan', 'cuidar a mi', 'cuidadora', 'compania'),
    'Cuidados Intensivos': ('intensiv', 'terapia', 'respirador', 'traqueo', 'oxigeno'),
}
# Palabras clave → especialidad del profesional.
CLAVES_ESPECIALIDAD = {
    # Solo palabras inequívocas: un filtro de especialidad equivocado esconde resultados.
    'Pediatría': ('bebe', 'niño', 'nino', 'nene', 'nena', 'pediatr', 'recien nacido'),
    'Geriatría': ('abuel', 'adulto mayor', 'anciano', 'tercera edad', 'geriatr'),
    'Cuidados Intensivos': ('intensiv', 'terapia', 'respirador', 'traqueo'),
}
URGENCIAS = ('urgente', 'urgencia', 'emergencia', 'no respira', 'inconsciente', 'desmay',
             'dolor de pecho', 'sangra mucho', 'convuls', 'ahora mismo')
AVISO_URGENCIA = 'Si es una urgencia, llamá al 107 o al servicio de emergencias de tu zona.'

INSTRUCCIONES = (
    'Sos el asistente de búsqueda de Enfered, una plataforma que conecta pacientes con enfermeros a domicilio '
    'en Argentina. Tu única tarea es convertir el pedido del usuario en filtros de búsqueda. '
    'Elegí valores SOLO de las listas permitidas; si algo no se menciona o no coincide, devolvé null. '
    'No diagnostiques, no recomiendes medicamentos ni dosis y no des consejos de salud. '
    'Si el pedido describe una urgencia, en "aclaracion" escribí exactamente: "' + AVISO_URGENCIA + '". '
    'Horas en formato HH:MM de 24 horas; "a la tarde" = 14:00 a 18:00, "a la mañana" = 08:00 a 12:00, '
    '"a la noche" = 20:00 a 23:00.'
)


class IAError(Exception):
    """El proveedor de IA no respondió o respondió algo inválido."""


def normalizar(texto):
    sin_tildes = unicodedata.normalize('NFKD', texto.lower())
    return ''.join(c for c in sin_tildes if not unicodedata.combining(c))


def anonimizar(texto):
    """Quita datos personales antes de enviar el texto a un proveedor externo."""
    texto = re.sub(r'[\w.+-]+@[\w-]+\.[\w.]+', '[email]', texto)
    texto = re.sub(r'\+?\d[\d\s-]{6,}\d', '[número]', texto)  # teléfonos y DNI
    # Calles con altura ("San Martín 1250"): se deja la ciudad, que sí sirve para buscar.
    texto = re.sub(r'\b(calle|av\.?|avenida|pasaje|ruta)\s+[\wáéíóúñ. ]+?\s\d{1,5}\b', '[dirección]', texto,
                   flags=re.IGNORECASE)
    return texto


def esquema_respuesta(permitidos):
    """JSON Schema de la respuesta, con listas cerradas para que el modelo no invente valores."""
    def enumerado(valores):
        return {'type': ['string', 'null'], 'enum': [*valores, None]}
    return {
        'type': 'object',
        'properties': {
            'especialidad': enumerado(permitidos['especialidades']),
            'ciudad': enumerado(permitidos['ciudades']),
            'dia_semana': enumerado(DIAS),
            'hora_desde': {'type': ['string', 'null']},
            'hora_hasta': {'type': ['string', 'null']},
            'servicio': enumerado(permitidos['servicios']),
            'aclaracion': {'type': ['string', 'null']},
        },
        'required': ['especialidad', 'ciudad', 'dia_semana', 'hora_desde', 'hora_hasta', 'servicio', 'aclaracion'],
    }


def _mensaje_usuario(texto, permitidos):
    return (
        f'Especialidades permitidas: {", ".join(permitidos["especialidades"]) or "ninguna"}.\n'
        f'Ciudades permitidas: {", ".join(permitidos["ciudades"]) or "ninguna"}.\n'
        f'Días permitidos: {", ".join(DIAS)}.\n'
        f'Servicios permitidos: {", ".join(permitidos["servicios"]) or "ninguno"}.\n'
        f'Pedido del usuario: """{texto}"""'
    )


def _post_json(url, cuerpo, headers):
    datos = json.dumps(cuerpo).encode('utf-8')
    req = urllib.request.Request(url, data=datos, method='POST',
                                 headers={'Content-Type': 'application/json', **headers})
    # OSError cubre URLError, timeouts y cortes de conexión (ConnectionResetError, RemoteDisconnected);
    # HTTPException, respuestas cortadas a la mitad. Cualquiera de ellos pasa a las reglas.
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SEGUNDOS) as respuesta:
            return json.loads(respuesta.read().decode('utf-8'))
    except (OSError, http.client.HTTPException, ValueError) as error:
        raise IAError(type(error).__name__) from error


def consultar_gemini(texto, permitidos):
    clave = os.getenv('GEMINI_API_KEY', '').strip()
    if not clave:
        raise IAError('Falta GEMINI_API_KEY')
    modelo = os.getenv('GEMINI_MODELO', 'gemini-flash-lite-latest').strip()
    esquema = esquema_respuesta(permitidos)
    # Gemini usa "nullable" en lugar de tipos combinados.
    propiedades = {
        nombre: ({'type': 'string', 'nullable': True, **({'enum': [v for v in p['enum'] if v]} if 'enum' in p else {})})
        for nombre, p in esquema['properties'].items()
    }
    cuerpo = {
        'systemInstruction': {'parts': [{'text': INSTRUCCIONES}]},
        'contents': [{'role': 'user', 'parts': [{'text': _mensaje_usuario(texto, permitidos)}]}],
        'generationConfig': {
            'temperature': 0,
            'maxOutputTokens': 300,
            'responseMimeType': 'application/json',
            'responseSchema': {'type': 'object', 'properties': propiedades, 'required': esquema['required']},
        },
    }
    respuesta = _post_json(
        f'https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent',
        cuerpo, {'x-goog-api-key': clave},
    )
    try:
        return json.loads(respuesta['candidates'][0]['content']['parts'][0]['text'])
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise IAError('Respuesta de Gemini inválida') from error


def interpretar_con_reglas(texto, permitidos):
    """Nivel 3: interpreta frases típicas con palabras clave, sin enviar nada a terceros."""
    t = normalizar(texto)
    resultado = dict.fromkeys(('especialidad', 'ciudad', 'dia_semana', 'hora_desde', 'hora_hasta',
                               'servicio', 'aclaracion'))
    for servicio, claves in CLAVES_SERVICIO.items():
        if servicio in permitidos['servicios'] and any(normalizar(c) in t for c in claves):
            resultado['servicio'] = servicio
            break
    for especialidad, claves in CLAVES_ESPECIALIDAD.items():
        if especialidad in permitidos['especialidades'] and any(normalizar(c) in t for c in claves):
            resultado['especialidad'] = especialidad
            break
    for ciudad in sorted(permitidos['ciudades'], key=len, reverse=True):
        nombre = normalizar(ciudad).replace(' capital', '')
        if nombre and nombre in t:
            resultado['ciudad'] = ciudad
            break
    for dia in DIAS:
        if re.search(rf'\b{normalizar(dia)}', t):
            resultado['dia_semana'] = dia
            break
    hora = re.search(r'\ba las (\d{1,2})(?::(\d{2}))?\s*(?:hs|h|horas)?\b', t)
    if hora and 0 <= int(hora.group(1)) <= 22:
        inicio = int(hora.group(1))
        if inicio < 8 and 'tarde' in t:
            inicio += 12  # "a las 4 de la tarde"
        minutos = hora.group(2) or '00'
        resultado['hora_desde'] = f'{inicio:02d}:{minutos}'
        resultado['hora_hasta'] = f'{min(inicio + 1, 23):02d}:{minutos}'
    else:
        for palabra, (desde, hasta) in FRANJAS.items():
            if re.search(rf'\b(la|de|por la|a la)\s+{palabra}\b', t):
                resultado['hora_desde'], resultado['hora_hasta'] = desde, hasta
                break
    if any(u in t for u in URGENCIAS):
        resultado['aclaracion'] = AVISO_URGENCIA
    return resultado


def validar(crudo, permitidos):
    """Descarta todo valor que no exista en el sistema (la IA nunca agrega filtros inventados)."""
    if not isinstance(crudo, dict):
        raise IAError('La respuesta no es un objeto')

    def elegir(campo, opciones):
        valor = crudo.get(campo)
        return valor if isinstance(valor, str) and valor in opciones else None

    resultado = {
        'especialidad': elegir('especialidad', permitidos['especialidades']),
        'ciudad': elegir('ciudad', permitidos['ciudades']),
        'dia_semana': elegir('dia_semana', DIAS),
        'servicio': elegir('servicio', permitidos['servicios']),
        'hora_desde': None,
        'hora_hasta': None,
        'aclaracion': None,
    }
    horas = [crudo.get('hora_desde'), crudo.get('hora_hasta')]
    if all(isinstance(h, str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', h) for h in horas) and horas[0] < horas[1]:
        resultado['hora_desde'], resultado['hora_hasta'] = horas
    # El único texto libre permitido es el aviso de urgencia: nunca se muestra otra cosa que diga la IA.
    if isinstance(crudo.get('aclaracion'), str) and '107' in crudo['aclaracion']:
        resultado['aclaracion'] = AVISO_URGENCIA
    return resultado


PROVEEDORES = {'gemini': consultar_gemini}


def interpretar(texto, permitidos, proveedor=None):
    """Devuelve (filtros, fuente). Si la IA falla o no está configurada, usa las reglas."""
    proveedor = (proveedor or os.getenv('IA_PROVEEDOR', 'reglas')).strip().lower()
    reglas = validar(interpretar_con_reglas(texto, permitidos), permitidos)
    consultar = PROVEEDORES.get(proveedor)
    if consultar is None:
        return reglas, 'reglas'
    try:
        filtros = validar(consultar(anonimizar(texto), permitidos), permitidos)
    except IAError:
        return reglas, 'reglas'
    # La regla de seguridad no depende del modelo: si las reglas detectan urgencia, se avisa igual.
    filtros['aclaracion'] = filtros['aclaracion'] or reglas['aclaracion']
    return filtros, proveedor
