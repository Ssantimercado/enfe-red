"""Ubicar en el mapa una dirección escrita, y escribir la dirección de un punto (HU16)."""
import math

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required

from services.geocodificacion import MAX_DIRECCION, ErrorGeocodificacion, buscar_direccion, direccion_de

mapa_bp = Blueprint('mapa_bp', __name__)
SIN_SERVICIO = 'No pudimos buscar la dirección en este momento. Marcá el lugar tocando el mapa.'


@mapa_bp.get('/geocodificar')
@jwt_required()
def geocodificar():
    """?direccion=Belgrano 50, Godoy Cruz -> {latitud, longitud, descripcion}."""
    texto = (request.args.get('direccion') or '').strip()
    if not texto or len(texto) > MAX_DIRECCION:
        return jsonify({'error': f'Escribí una dirección de hasta {MAX_DIRECCION} caracteres'}), 400
    try:
        lugar = buscar_direccion(texto)
    except ErrorGeocodificacion:
        current_app.logger.warning('El servicio de direcciones no respondió')
        return jsonify({'error': SIN_SERVICIO}), 503
    if not lugar:
        return jsonify({'error': 'No encontramos esa dirección en el mapa. Revisala o marcá el lugar tocando el mapa.'}), 404
    return jsonify(lugar), 200


@mapa_bp.get('/geocodificar/inversa')
@jwt_required()
def geocodificar_inversa():
    """?lat=-32.89&lng=-68.84 -> {direccion}: para completar la dirección al usar la ubicación actual."""
    try:
        latitud = float(request.args.get('lat', ''))
        longitud = float(request.args.get('lng', ''))
    except ValueError:
        return jsonify({'error': 'Indicá lat y lng numéricas'}), 400
    if not (math.isfinite(latitud) and math.isfinite(longitud)) or abs(latitud) > 90 or abs(longitud) > 180:
        return jsonify({'error': 'Indicá lat y lng numéricas'}), 400
    try:
        direccion = direccion_de(latitud, longitud)
    except ErrorGeocodificacion:
        current_app.logger.warning('El servicio de direcciones no respondió')
        return jsonify({'error': SIN_SERVICIO}), 503
    if not direccion:
        return jsonify({'error': 'No encontramos una dirección para ese punto. Escribila vos.'}), 404
    return jsonify({'direccion': direccion}), 200
