"""HU12: POST /api/ia/interpretar-busqueda (búsqueda asistida por IA en lenguaje natural)."""
import time
from collections import defaultdict, deque

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from database import db
from models.servicio_models import Servicio
from models.usuario_models import Enfermero, Usuario
from routes.usuario_routes import consulta_enfermeros_visibles, zonas_con_enfermeros
from services.ia_busqueda import MAX_TEXTO, es_franja, interpretar, normalizar

ia_bp = Blueprint('ia_bp', __name__)
LIMITE_POR_MINUTO = 10
LIMITE_POR_DIA = 60
_uso = defaultdict(deque)  # usuario -> momentos de sus últimos pedidos


def _limite_superado(usuario_id):
    ahora = time.time()
    pedidos = _uso[usuario_id]
    while pedidos and ahora - pedidos[0] > 86400:
        pedidos.popleft()
    ultimo_minuto = sum(1 for momento in pedidos if ahora - momento < 60)
    if ultimo_minuto >= LIMITE_POR_MINUTO or len(pedidos) >= LIMITE_POR_DIA:
        return True
    pedidos.append(ahora)
    return False


def _valores_permitidos():
    """Solo valores que existen en el sistema: la IA no puede inventar filtros."""
    visibles = consulta_enfermeros_visibles()
    # "Pediatria" y "Pediatría" son la misma: queda una sola, preferentemente la escrita con tilde.
    por_clave = {}
    for (especialidad,) in visibles.with_entities(Enfermero.especialidad):
        especialidad = ' '.join((especialidad or '').split())
        if especialidad:
            clave = normalizar(especialidad)
            if clave not in por_clave or not especialidad.isascii():
                por_clave[clave] = especialidad
    especialidades = sorted(por_clave.values())
    # Departamentos, los mismos del filtro de la cartilla.
    ciudades = zonas_con_enfermeros()
    servicios = [s for (s,) in db.session.query(Servicio.tipoServicio).order_by(Servicio.tipoServicio)]
    return {'especialidades': especialidades, 'ciudades': ciudades, 'servicios': servicios}


@ia_bp.post('/ia/interpretar-busqueda')
@jwt_required()
def interpretarBusqueda():
    try:
        usuario = db.session.get(Usuario, int(get_jwt_identity()))
    except (TypeError, ValueError):
        usuario = None
    if not usuario:
        return jsonify(error='La sesión no corresponde a un usuario existente'), 401
    if usuario.rol != 'paciente':
        return jsonify(error='La búsqueda asistida está disponible para pacientes'), 403

    datos = request.get_json(silent=True)
    texto = datos.get('texto') if isinstance(datos, dict) else None
    if not isinstance(texto, str) or not texto.strip():
        return jsonify(error='Contanos qué necesitás para poder buscar'), 400
    texto = texto.strip()
    if len(texto) > MAX_TEXTO:
        return jsonify(error=f'Escribí hasta {MAX_TEXTO} caracteres'), 400
    if _limite_superado(usuario.id):
        return jsonify(error='Hiciste muchas búsquedas seguidas. Esperá un momento y probá de nuevo.'), 429

    inicio = time.perf_counter()
    filtros, fuente = interpretar(texto, _valores_permitidos())
    # Nunca se registra el texto: solo el proveedor usado y el tiempo de respuesta.
    current_app.logger.info('IA búsqueda: fuente=%s ms=%d', fuente, (time.perf_counter() - inicio) * 1000)
    # "A la tarde" es una parte del día: la cartilla busca a quien atienda en algún momento de esa franja.
    horario_parcial = bool(filtros.get('hora_desde')) and es_franja(texto)
    return jsonify(filtros=filtros, fuente=fuente, horarioParcial=horario_parcial), 200
