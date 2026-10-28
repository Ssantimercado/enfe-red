import { useCallback, useEffect, useState } from 'react';
import { RUTAS_URL } from './mapaConfig';

const MENSAJES_GEOLOCALIZACION = {
  1: 'Permití el acceso a tu ubicación en el navegador y volvé a intentarlo.',
  2: 'El dispositivo no pudo determinar tu ubicación.',
  3: 'La búsqueda de ubicación tardó demasiado.',
};

// Ubicación actual del navegador, a pedido (nunca se pide sola al abrir la pantalla).
export function useMiUbicacion() {
  const [posicion, setPosicion] = useState(null);
  const [estado, setEstado] = useState('idle');
  const [error, setError] = useState('');

  // onExito([lat, lng], precisionEnMetros) es opcional: se llama solo si la ubicación llegó bien.
  const ubicar = useCallback((onExito) => {
    if (!navigator.geolocation) {
      setEstado('error');
      setError('Este navegador no permite obtener tu ubicación.');
      return;
    }
    if (
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setEstado('error');
      setError('La ubicación solo funciona en localhost o mediante HTTPS.');
      return;
    }
    setEstado('loading');
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const punto = [coords.latitude, coords.longitude];
        setPosicion(punto);
        setEstado('ready');
        if (typeof onExito === 'function') onExito(punto, coords.accuracy);
      },
      (fallo) => {
        setEstado('error');
        setError(MENSAJES_GEOLOCALIZACION[fallo.code] || 'No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  return { posicion, estado, error, ubicar };
}

// Distancia en línea recta (km): respaldo cuando no hay servicio de rutas por calles.
export function distanciaLineal([lat1, lng1], [lat2, lng2]) {
  const rad = (grados) => (grados * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calcula la ruta REAL mediante las calles de OpenStreetMap.
export function useRutaReal(origen, destino) {
  const [ruta, setRuta] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState('');

  useEffect(() => {
    if (!RUTAS_URL || !origen || !destino) {
      setRuta(null);
      setLoadingRoute(false);
      setRouteError('');
      return undefined;
    }

    const controller = new AbortController();

    async function obtenerRuta() {
      setLoadingRoute(true);
      setRuta(null);
      setRouteError('');

      try {
        // OSRM requiere longitud,latitud (no latitud,longitud).
        const coordenadas = [`${origen[1]},${origen[0]}`, `${destino[1]},${destino[0]}`].join(';');
        const url = `${RUTAS_URL}/${coordenadas}?overview=full&geometries=geojson`;
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('No se pudo consultar el servicio de rutas.');

        const data = await response.json();
        if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
          throw new Error('No se encontró una ruta por calles entre ambas ubicaciones.');
        }

        // OSRM devuelve [longitud, latitud]. Leaflet necesita [latitud, longitud].
        const rutaElegida = data.routes[0];
        setRuta({
          positions: rutaElegida.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distancia: rutaElegida.distance / 1000,
          tiempo: rutaElegida.duration,
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error al calcular la ruta:', error);
          setRouteError(error.message || 'No se pudo calcular la ruta. Intentá nuevamente.');
          setRuta(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingRoute(false);
      }
    }

    obtenerRuta();
    return () => controller.abort();
  }, [origen, destino]);

  return { ruta, loadingRoute, routeError };
}
