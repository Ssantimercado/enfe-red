import { useCallback, useEffect, useRef, useState } from 'react';
import { requestApi } from '../api';
import { RUTAS_URL } from './mapaConfig';

// Dirección escrita <-> punto del mapa. Lo resuelve el servidor (Nominatim, de OpenStreetMap).
export const buscarDireccion = (direccion, signal) =>
  requestApi(`/geocodificar?direccion=${encodeURIComponent(direccion)}`, { signal });
export const direccionDe = ([lat, lng], signal) => requestApi(`/geocodificar/inversa?lat=${lat}&lng=${lng}`, { signal });

// Se espera a que la persona deje de escribir: no se busca en cada letra (y Nominatim pide pocos pedidos).
export const ESPERA_DIRECCION_MS = 1200;
const ESPERA_RUTA_MS = 6000;

// Mientras `activo`, busca `texto` en el mapa al terminar de escribir y avisa con alEncontrar([lat, lng], lugar).
// `pendiente` vale mientras falta la respuesta; `cancelar()` la descarta (por ejemplo, si la persona tocó el mapa).
export function useBuscarDireccion(texto, activo, alEncontrar) {
  const [estado, setEstado] = useState({ fase: 'idle', mensaje: '' });
  const ultimo = useRef(alEncontrar);
  const detener = useRef(null);
  useEffect(() => {
    ultimo.current = alEncontrar;
  });
  useEffect(() => {
    const limpio = String(texto || '').trim();
    if (!activo || limpio.length < 4) {
      setEstado({ fase: 'idle', mensaje: '' });
      return undefined;
    }
    const controller = new AbortController();
    setEstado({ fase: 'esperando', mensaje: '' });
    const timer = window.setTimeout(async () => {
      setEstado({ fase: 'buscando', mensaje: 'Buscando la dirección en el mapa…' });
      try {
        const lugar = await buscarDireccion(limpio, controller.signal);
        if (controller.signal.aborted) return;
        if (!Number.isFinite(lugar?.latitud) || !Number.isFinite(lugar?.longitud)) throw new Error('Respuesta inválida');
        ultimo.current?.([lugar.latitud, lugar.longitud], lugar);
        setEstado({
          fase: 'ok',
          mensaje: `Ubicamos la dirección en el mapa${lugar.descripcion ? ` (${lugar.descripcion})` : ''}. Si el punto no es exacto, tocá el lugar correcto.`,
        });
      } catch (error) {
        if (controller.signal.aborted || error.name === 'AbortError') return;
        setEstado({
          fase: error.status === 404 ? 'no' : 'error',
          mensaje: error.status === 404 || error.status === 503
            ? error.message
            : 'No pudimos buscar la dirección en este momento. Marcá el lugar tocando el mapa.',
        });
      }
    }, ESPERA_DIRECCION_MS);
    detener.current = () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    return () => detener.current?.();
  }, [texto, activo]);
  const cancelar = useCallback(() => {
    detener.current?.();
    setEstado(actual => (actual.fase === 'esperando' || actual.fase === 'buscando' ? { fase: 'idle', mensaje: '' } : actual));
  }, []);
  return { ...estado, pendiente: estado.fase === 'esperando' || estado.fase === 'buscando', cancelar };
}

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
  // Número del último pedido: una respuesta de un pedido anterior o cancelado no pisa nada.
  const pedido = useRef(0);

  // onExito([lat, lng], precisionEnMetros) es opcional: se llama solo si la ubicación llegó bien.
  const ubicar = useCallback((onExito) => {
    const numero = ++pedido.current;
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
        if (numero !== pedido.current) return;
        const punto = [coords.latitude, coords.longitude];
        setPosicion(punto);
        setEstado('ready');
        if (typeof onExito === 'function') onExito(punto, coords.accuracy);
      },
      (fallo) => {
        if (numero !== pedido.current) return;
        setEstado('error');
        setError(MENSAJES_GEOLOCALIZACION[fallo.code] || 'No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  const cancelar = useCallback(() => {
    pedido.current += 1;
    setEstado(actual => (actual === 'loading' ? 'idle' : actual));
  }, []);

  return { posicion, estado, error, ubicar, cancelar };
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
    // Si el servicio de rutas no contesta, se corta y queda la distancia en línea recta.
    let porTiempo = false;
    const limite = window.setTimeout(() => {
      porTiempo = true;
      controller.abort();
    }, ESPERA_RUTA_MS);

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
        if (porTiempo) {
          setRouteError('El servicio de rutas tardó demasiado.');
          setLoadingRoute(false);
        } else if (error.name !== 'AbortError') {
          console.error('Error al calcular la ruta:', error);
          setRouteError(error.message || 'No se pudo calcular la ruta. Intentá nuevamente.');
          setRuta(null);
        }
      } finally {
        window.clearTimeout(limite);
        if (!controller.signal.aborted) setLoadingRoute(false);
      }
    }

    obtenerRuta();
    return () => {
      window.clearTimeout(limite);
      controller.abort();
    };
  }, [origen, destino]);

  return { ruta, loadingRoute, routeError };
}
