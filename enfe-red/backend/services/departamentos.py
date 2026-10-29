"""Departamentos de Mendoza: el filtro por zona de la cartilla agrupa lo que cada enfermero escribió en "ciudad".

Cada profesional escribe su zona a mano ("Mendoza Capital", "Capital", "Chacras de Coria"...). Para filtrar por
departamento se reconoce el nombre del departamento, sus formas habituales y las localidades más conocidas.
Lo que no se reconoce se muestra tal como está escrito.
"""
import re
import unicodedata

# Primero los del Gran Mendoza, que es donde hay más profesionales; después el resto de la provincia.
DEPARTAMENTOS = (
    'Ciudad de Mendoza', 'Godoy Cruz', 'Guaymallén', 'Las Heras', 'Luján de Cuyo', 'Maipú',
    'Lavalle', 'San Martín', 'Junín', 'Rivadavia', 'Santa Rosa', 'La Paz',
    'Tunuyán', 'Tupungato', 'San Carlos', 'San Rafael', 'General Alvear', 'Malargüe',
)

# Otras formas de escribir cada departamento, y localidades que pertenecen a él.
_OTROS_NOMBRES = {
    'Ciudad de Mendoza': ('mendoza', 'capital', 'mendoza capital', 'capital mendoza', 'ciudad', 'centro',
                          'centro de mendoza', 'ciudad capital', 'quinta seccion', 'sexta seccion', 'cuarta seccion'),
    'Godoy Cruz': ('villa hipodromo', 'san francisco del monte', 'gobernador benegas', 'las tortugas',
                   'trapiche', 'villa marini', 'godoy'),
    'Guaymallén': ('guaymallen', 'villa nueva', 'dorrego', 'rodeo de la cruz', 'bermejo',
                   'las canas', 'pedro molina', 'jesus nazareno', 'corralitos', 'kilometro 8',
                   'kilometro 11', 'colonia segovia', 'nueva ciudad', 'puente de hierro'),
    'Las Heras': ('el challao', 'panquehua', 'el plumerillo', 'el algarrobal', 'el zapallar', 'el resguardo',
                  'el borbollon', 'uspallata', 'la cieneguita'),
    'Luján de Cuyo': ('lujan', 'chacras de coria', 'vistalba', 'carrodilla', 'la puntilla', 'perdriel',
                      'mayor drummond', 'agrelo', 'ugarteche', 'carrizal', 'potrerillos', 'cacheuta'),
    'Maipú': ('coquimbito', 'russell', 'lunlunta', 'fray luis beltran', 'general gutierrez', 'gutierrez',
              'rodeo del medio', 'luzuriaga', 'cruz de piedra', 'barrancas', 'san roque', 'coquimbo'),
    'San Martín': ('palmira', 'gral san martin'),
    'General Alvear': ('alvear', 'gral alvear', 'bowen'),
    'Malargüe': ('malargue',),
    'Tunuyán': ('tunuyan',),
    'Junín': ('junin',),
}
_PREFIJOS = re.compile(r'^(departamento|depto\.?|dpto\.?)\s+(de\s+)?')


def normalizar(texto):
    """Sin tildes ni mayúsculas, sin puntuación y con un solo espacio: "Luján" y "lujan" son lo mismo."""
    sin_tildes = unicodedata.normalize('NFKD', str(texto or '')).encode('ascii', 'ignore').decode('ascii')
    limpio = re.sub(r'[^\w\s]', ' ', sin_tildes.casefold())
    return _PREFIJOS.sub('', ' '.join(limpio.split()))


_NOMBRES = {}
for _departamento in DEPARTAMENTOS:
    for _nombre in (_departamento, *_OTROS_NOMBRES.get(_departamento, ())):
        _NOMBRES[normalizar(_nombre)] = _departamento
# Palabras demasiado comunes para buscarlas dentro de un texto: valen solo si es lo único escrito.
_SOLO_EXACTOS = {'ciudad', 'centro'}
# Del más largo al más corto: en "Godoy Cruz, Mendoza" gana Godoy Cruz y no "mendoza".
_POR_LARGO = sorted((nombre for nombre in _NOMBRES if nombre not in _SOLO_EXACTOS), key=len, reverse=True)


def departamento_de(texto):
    """Departamento al que corresponde lo escrito ("Mendoza Capital" -> "Ciudad de Mendoza"), o None."""
    limpio = normalizar(texto)
    if not limpio:
        return None
    if limpio in _NOMBRES:
        return _NOMBRES[limpio]
    for nombre in _POR_LARGO:
        if re.search(rf'\b{re.escape(nombre)}\b', limpio):
            return _NOMBRES[nombre]
    return None


def zona_de(texto):
    """Lo que se muestra en el filtro: el departamento si se reconoce; si no, lo escrito."""
    return departamento_de(texto) or ' '.join(str(texto or '').split()) or None


def nombres_de(departamento):
    """Todas las formas normalizadas que identifican a un departamento (para reconocerlo en un texto)."""
    return [nombre for nombre in _POR_LARGO if _NOMBRES[nombre] == departamento]
