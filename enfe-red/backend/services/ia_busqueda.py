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
import time
import unicodedata
import urllib.request

from services.departamentos import departamento_de, nombres_de

DIAS = ('Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo')
MAX_TEXTO = 300
# Si Gemini no contesta en 3 segundos se usan las reglas: más espera se siente como que la búsqueda no anda.
TIMEOUT_SEGUNDOS = 3
# Si Gemini falla (servicio saturado o sin conexión), las búsquedas siguientes van directo a las reglas
# durante este tiempo, en lugar de esperar otra vez.
PAUSA_TRAS_FALLA = 120
_pausa = {'hasta': 0.0}

# Franjas para expresiones como "a la tarde". Rangos cortos para que coincidan con más horarios cargados.
FRANJAS = {
    'mañana': ('08:00', '12:00'),
    'manana': ('08:00', '12:00'),
    'mediodia': ('12:00', '14:00'),
    'tarde': ('14:00', '18:00'),
    'noche': ('20:00', '23:00'),
}
# Palabras clave → tipo de servicio del catálogo.
# Cómo dice la gente cada tarea. Son expresiones regulares sobre el texto normalizado (sin tildes ni mayúsculas;
# la ñ queda como n). Un pedido puede tener varias tareas: "curar una herida y medir la insulina".
_MEDIR = (r'(medir|medirle|medirme|medirla|medirlo|medicion|mida|midan|mide|controlar|controlarle|controlarme|'
          r'controle|controlen|control|controles|chequear|chequearle|chequeo|tomar|tomarle|tomarme|tome|tomen|'
          r'revisar|revisarle)')
_PONER = (r'(poner|ponerle|ponerme|ponerla|ponerlo|ponga|pongan|aplicar|aplicarle|aplicarme|aplique|apliquen|'
          r'colocar|colocarle|coloque|coloquen|inyectar|inyectarle|inyecte|dar|darle|darme|den|de la)')
_GLUCOSA = r'(insulina|azucar|glucosa|glucemia|diabetes|hgt)'
# "Medirle la insulina" es controlar el azúcar; "ponerle la insulina" es una inyección.
MEDIR_GLUCOSA = rf'\b{_MEDIR}\b(?:\s+\w+){{0,3}}?\s+{_GLUCOSA}\b'
PONER_INSULINA = rf'\b{_PONER}\b(?:\s+\w+){{0,3}}?\s+insulina\b'
PATRONES_SERVICIO = {
    'Control de signos vitales': (
        MEDIR_GLUCOSA, r'\b(glucemia|glucosa|azucar|hgt|glucometro)\b',
        r'\b(presion|tension arterial|signos vitales|saturacion|saturometro|oximetro|pulso|temperatura|fiebre)\b',
        r'\b(chequeo|control general|controles de rutina)\b',
    ),
    'Inyecciones': (
        PONER_INSULINA, r'\binyec', r'\bvacuna', r'\bintramuscular', r'\bsubcutane', r'\bpinchazo',
        r'\bampolla', r'\bheparina', r'\benoxaparina', r'\bpenicilina', r'\bb12\b',
    ),
    'Curaciones': (
        r'\bcura(cion|ciones|r|rle|rla|rlo|rme|rte|n|s)?\b', r'\bherida', r'\bulcera', r'\bescara', r'\bllaga',
        r'\bquemadura', r'\blastimadura', r'\bpuntos\b', r'\bvendaje', r'\bvendar', r'\baposito', r'\bgasa',
        r'\bpost ?operatori', r'\bpostquirurgic', r'\bdespues de (la|una|su) (operacion|cirugia)', r'\bdrenaje',
        r'\bpie diabetico', r'\bcicatriz',
    ),
    'Higiene y confort': (
        r'\bhigien', r'\bban(ar|arla|arlo|arle|arme|en|e|o)\b', r'\bduch', r'\baseo\b', r'\bpanal(es)?\b',
        r'\blavar(la|lo|le)?\b', r'\bropa de cama\b', r'\bcambiar(la|lo|le)? (la ropa|de ropa|las sabanas)',
        r'\bconfort\b', r'\bcambio de posicion', r'\bvestir(la|lo|le)?\b',
    ),
    'Acompañamiento de adultos mayores': (
        r'\bacompan', r'\bcompania\b', r'\bcuidador', r'\bcuid(ar|arla|arlo|arle|e|en)\b', r'\bque se quede\b',
        r'\bquedarse con\b', r'\basist(ir|irla|irlo|a|an)\b', r'\bayud(ar|arla|arlo|e|en) a (comer|caminar|levantarse)',
    ),
    'Cuidados Intensivos': (
        r'\bintensiv', r'\brespirador', r'\btraqueo', r'\boxigeno\b', r'\bsonda', r'\balta complejidad',
        r'\binternacion domiciliaria', r'\bventilacion mecanica',
    ),
}


def servicios_del_texto(texto, permitidos):
    """Servicios que pide el texto, en el orden en que aparecen (puede ser más de uno)."""
    t = normalizar(texto)
    encontrados = {}
    for servicio, patrones in PATRONES_SERVICIO.items():
        if servicio not in permitidos:
            continue
        posiciones = [m.start() for patron in patrones for m in [re.search(patron, t)] if m]
        if posiciones:
            encontrados[servicio] = min(posiciones)
    # "Insulina" sola ("necesito insulina para mi mamá") es aplicarla, salvo que se pida medirla.
    if 'Inyecciones' in permitidos and 'Inyecciones' not in encontrados and re.search(r'\binsulina\b', t) \
            and not re.search(MEDIR_GLUCOSA, t):
        encontrados['Inyecciones'] = t.index('insulina')
    return sorted(encontrados, key=encontrados.get)
# Palabras clave → especialidad del profesional.
CLAVES_ESPECIALIDAD = {
    # Solo cuando se pide la especialidad con esa palabra. Quién es el paciente ("mi abuela", "mi bebé") no la
    # define: ponerle insulina a una abuela lo puede hacer cualquiera que ponga inyecciones, y un filtro de
    # especialidad escondería a todos los demás.
    'Pediatría': ('pediatr', 'neonat'),
    'Geriatría': ('geriatr', 'gerontolog'),
    'Cuidados Intensivos': ('cuidados intensivos', 'terapia intensiva', 'intensivista'),
}


def _claves_de(especialidad):
    """Palabras que piden esa especialidad: las de la tabla o, si no está, la raíz de su nombre ("cardiolog")."""
    if especialidad in CLAVES_ESPECIALIDAD:
        return CLAVES_ESPECIALIDAD[especialidad]
    palabras = [p for p in normalizar(especialidad).split() if len(p) >= 6 and p != 'general']
    return (max(palabras, key=len)[:7],) if palabras else ()


def pide_especialidad(texto, especialidad):
    """Si el texto pide esa especialidad con todas las letras (no por deducción)."""
    t = normalizar(texto)
    return any(normalizar(clave) in t for clave in _claves_de(especialidad))
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
    '"a la noche" = 20:00 a 23:00. '
    'Completá "especialidad" SOLO si la persona pide una especialidad con esa palabra (por ejemplo "geriatra", '
    '"enfermera pediátrica", "terapia intensiva"). No la deduzcas por quién es el paciente: "mi abuela", '
    '"mi bebé" o "mi mamá" no piden una especialidad, y elegirla escondería a otros profesionales que pueden '
    'atenderlo. En "servicios" poné todas las tareas que pide (pueden ser varias, por ejemplo curar una herida y '
    'medir la insulina). Medir o controlar la insulina o el azúcar es "Control de signos vitales"; ponerle o '
    'aplicarle insulina es "Inyecciones". Si no pide una tarea concreta ("que la vengan a ver"), dejá la lista vacía.'
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
    # Calles escritas sin "calle" ni "avenida", pero con una pista de lugar delante ("vivo en cayetano
    # silva 1172"). Sin la pista no se toca nada: "geriatría durante 10 días" o "a la mañana 10 a 12" son
    # parte del pedido.
    return _CALLE_SIN_PREFIJO.sub(_quitar_calle, texto)


_NO_SON_CALLE = {
    'a', 'al', 'el', 'la', 'las', 'los', 'lo', 'de', 'del', 'en', 'y', 'o', 'u', 'e', 'hasta', 'desde', 'entre',
    'tipo', 'por', 'para', 'con', 'sin', 'unos', 'unas', 'tengo', 'tiene', 'edad', 'mas', 'más', 'menos', 'cada',
    'lunes', 'martes', 'miercoles', 'miércoles', 'jueves', 'viernes', 'sabado', 'sábado', 'domingo',
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre',
    'octubre', 'noviembre', 'diciembre', 'mañana', 'tarde', 'noche', 'turno', 'turnos', 'durante', 'diarias',
    'diarios', 'semana', 'mes', 'dia', 'día', 'horario',
}
_CALLE_SIN_PREFIJO = re.compile(
    r'\b(?P<pista>vivo en|viven en|vive en|queda en|domicilio:?|direcci[oó]n:?|casa en|en)\s+'
    r'(?P<calle>(?:[^\W\d_]+\s+){0,2}[^\W\d_]{3,})\s+\d{2,5}\b'
    r'(?!\s*(?:hs\b|h\b|:|\.\d|horas?\b|años?\b|am\b|pm\b|%|minutos?\b|d[ií]as?\b|semanas?\b|meses\b|veces\b|-|a\s+\d))',
    flags=re.IGNORECASE,
)


def _quitar_calle(coincidencia):
    if any(palabra.lower() in _NO_SON_CALLE for palabra in coincidencia.group('calle').split()):
        return coincidencia.group(0)
    return f"{coincidencia.group('pista')} [dirección]"


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
            'servicios': {'type': 'array', 'items': {'type': 'string', 'enum': list(permitidos['servicios'])}},
            'aclaracion': {'type': ['string', 'null']},
        },
        'required': ['especialidad', 'ciudad', 'dia_semana', 'hora_desde', 'hora_hasta', 'servicios', 'aclaracion'],
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
        _pausa['hasta'] = time.monotonic() + PAUSA_TRAS_FALLA
        raise IAError(type(error).__name__) from error


def consultar_gemini(texto, permitidos):
    clave = os.getenv('GEMINI_API_KEY', '').strip()
    if not clave:
        raise IAError('Falta GEMINI_API_KEY')
    modelo = os.getenv('GEMINI_MODELO', 'gemini-flash-lite-latest').strip()
    esquema = esquema_respuesta(permitidos)
    # Gemini usa "nullable" en lugar de tipos combinados.
    propiedades = {
        nombre: (p if p.get('type') == 'array' else
                 {'type': 'string', 'nullable': True, **({'enum': [v for v in p['enum'] if v]} if 'enum' in p else {})})
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
    resultado['servicios'] = servicios_del_texto(texto, permitidos['servicios'])
    resultado['servicio'] = resultado['servicios'][0] if resultado['servicios'] else None
    for especialidad in permitidos['especialidades']:
        if pide_especialidad(texto, especialidad):
            resultado['especialidad'] = especialidad
            break
    # Cada departamento con sus otras formas ("Capital", "Chacras de Coria"...), de la más larga a la más corta:
    # en "Godoy Cruz, Mendoza" gana Godoy Cruz.
    nombres = [(normalizar(nombre), ciudad) for ciudad in permitidos['ciudades']
               for nombre in {ciudad, *nombres_de(departamento_de(ciudad))}]
    for nombre, ciudad in sorted(nombres, key=lambda par: len(par[0]), reverse=True):
        if nombre and re.search(rf'\b{re.escape(nombre)}\b', t):
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
        'servicios': [],
        'servicio': None,
        'hora_desde': None,
        'hora_hasta': None,
        'aclaracion': None,
    }
    pedidos = crudo.get('servicios')
    pedidos = pedidos if isinstance(pedidos, list) else [crudo.get('servicio')]
    for servicio in pedidos:
        if isinstance(servicio, str) and servicio in permitidos['servicios'] and servicio not in resultado['servicios']:
            resultado['servicios'].append(servicio)
    resultado['servicio'] = resultado['servicios'][0] if resultado['servicios'] else None
    horas = [crudo.get('hora_desde'), crudo.get('hora_hasta')]
    if all(isinstance(h, str) and re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', h) for h in horas) and horas[0] < horas[1]:
        resultado['hora_desde'], resultado['hora_hasta'] = horas
    # El único texto libre permitido es el aviso de urgencia: nunca se muestra otra cosa que diga la IA.
    if isinstance(crudo.get('aclaracion'), str) and '107' in crudo['aclaracion']:
        resultado['aclaracion'] = AVISO_URGENCIA
    return resultado


PROVEEDORES = {'gemini': consultar_gemini}


def es_franja(texto):
    """Si el horario se pidió como una parte del día ("a la tarde") y no como una hora puntual ("a las 10")."""
    t = normalizar(texto)
    if re.search(r'\ba las \d', t):
        return False
    return any(re.search(rf'\b(la|de|por la|a la)\s+{palabra}\b', t) for palabra in FRANJAS)


def interpretar(texto, permitidos, proveedor=None):
    """Devuelve (filtros, fuente). Si la IA falla o no está configurada, usa las reglas."""
    proveedor = (proveedor or os.getenv('IA_PROVEEDOR', 'reglas')).strip().lower()
    reglas = validar(interpretar_con_reglas(texto, permitidos), permitidos)
    consultar = PROVEEDORES.get(proveedor)
    if consultar is None or time.monotonic() < _pausa['hasta']:
        return reglas, 'reglas'
    try:
        filtros = validar(consultar(anonimizar(texto), permitidos), permitidos)
    except IAError:
        return reglas, 'reglas'
    # Aunque se le pide que no lo haga, el modelo puede deducir la especialidad ("abuela" -> Geriatría):
    # si la persona no la pidió, se descarta para no esconder profesionales.
    if filtros['especialidad'] and not pide_especialidad(texto, filtros['especialidad']):
        filtros['especialidad'] = None
    # La regla de seguridad no depende del modelo: si las reglas detectan urgencia, se avisa igual.
    filtros['aclaracion'] = filtros['aclaracion'] or reglas['aclaracion']
    # Lo que la IA no reconoció y las reglas sí, se completa con las reglas.
    for campo in ('especialidad', 'ciudad', 'dia_semana'):
        filtros[campo] = filtros[campo] or reglas[campo]
    # Las tareas: si las reglas reconocen alguna, mandan las reglas (distinguen "medir" de "poner" la insulina);
    # si no, quedan las que entendió el modelo.
    if reglas['servicios']:
        filtros['servicios'] = reglas['servicios']
        filtros['servicio'] = reglas['servicio']
    if not filtros['hora_desde'] and reglas['hora_desde']:
        filtros['hora_desde'], filtros['hora_hasta'] = reglas['hora_desde'], reglas['hora_hasta']
    return filtros, proveedor
