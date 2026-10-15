
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [-32.8895, -68.8458]; // Mendoza capital

const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

const nurseIcon = new L.DivIcon({
  className: 'enfermero-marker',
  html: '<span>✚</span>',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});

function FlyToSelected({ position }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, Math.max(map.getZoom(), 14), {
        duration: 0.7,
      });
    }
  }, [map, position]);

  return null;
}

// Ajusta el mapa para mostrar el recorrido completo.
function FitRoute({ positions }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 1) {
      const bounds = L.latLngBounds(positions);

      map.fitBounds(bounds, {
        padding: [50, 50],
        maxZoom: 16,
        animate: true,
      });
    }
  }, [map, positions]);

  return null;
}

function coordinatesOf(enfermero) {
  const lat = Number(
    enfermero.latitud ?? enfermero.latitude ?? enfermero.lat
  );

  const lng = Number(
    enfermero.longitud ??
      enfermero.longitude ??
      enfermero.lng ??
      enfermero.lon
  );

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
    ? [lat, lng]
    : null;
}

// Calcula la ruta REAL mediante las calles de OpenStreetMap.
function useRutaReal(origen, destino) {
  const [ruta, setRuta] = useState(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [routeError, setRouteError] = useState('');

  useEffect(() => {
    if (!origen || !destino) {
      setRuta(null);
      setLoadingRoute(false);
      setRouteError('');
      return;
    }

    const controller = new AbortController();

    async function obtenerRuta() {
      setLoadingRoute(true);
      setRuta(null);
      setRouteError('');

      try {
        // OSRM requiere longitud,latitud (no latitud,longitud).
        const coordenadas = [
          `${origen[1]},${origen[0]}`,
          `${destino[1]},${destino[0]}`,
        ].join(';');

        const url =
          `${OSRM_URL}/${coordenadas}` +
          '?overview=full&geometries=geojson&steps=true';

        const response = await fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('No se pudo consultar el servicio de rutas.');
        }

        const data = await response.json();

        if (
          data.code !== 'Ok' ||
          !data.routes ||
          data.routes.length === 0
        ) {
          throw new Error(
            'No se encontró una ruta por calles entre ambas ubicaciones.'
          );
        }

        // OSRM devuelve [longitud, latitud].
        // Leaflet necesita [latitud, longitud].
        const rutaElegida = data.routes[0];

        const positions = rutaElegida.geometry.coordinates.map(
          ([lng, lat]) => [lat, lng]
        );

        setRuta({
          positions,
          distancia: rutaElegida.distance / 1000,
          tiempo: rutaElegida.duration,
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Error al calcular la ruta:', error);
          setRouteError(
            error.message ||
              'No se pudo calcular la ruta. Intentá nuevamente.'
          );
          setRuta(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoadingRoute(false);
        }
      }
    }

    obtenerRuta();

    return () => {
      controller.abort();
    };
  }, [origen, destino]);

  return { ruta, loadingRoute, routeError };
}

export default function MapaEnfermeros({
  enfermeros,
  selectedId,
  onSelect,
  volverA = '/cartilla',
}) {
  const [userPosition, setUserPosition] = useState(null);
  const [locationState, setLocationState] = useState('idle');
  const [locationError, setLocationError] = useState('');

  const navigate = useNavigate();

  const selected = enfermeros.find(
    (item) =>
      String(item.usuario_id ?? item.id) === String(selectedId)
  );

  const selectedPosition = useMemo(
    () => (selected ? coordinatesOf(selected) : null),
    [selected]
  );

  const center =
    userPosition || selectedPosition || DEFAULT_CENTER;

  const markers = useMemo(
    () =>
      enfermeros
        .map((enfermero) => ({
          enfermero,
          position: coordinatesOf(enfermero),
        }))
        .filter((item) => item.position),
    [enfermeros]
  );

  // La distancia y el tiempo ahora provienen de la ruta real.
  const { ruta, loadingRoute, routeError } = useRutaReal(
    userPosition,
    selectedPosition
  );

  const locateUser = () => {
    if (!navigator.geolocation) {
      setLocationState('error');
      setLocationError(
        'Este navegador no permite obtener tu ubicación.'
      );
      return;
    }

    if (
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setLocationState('error');
      setLocationError(
        'La ubicación solo funciona en localhost o mediante HTTPS.'
      );
      return;
    }

    setLocationState('loading');
    setLocationError('');

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserPosition([
          coords.latitude,
          coords.longitude,
        ]);
        setLocationState('ready');
      },
      (error) => {
        setLocationState('error');

        const messages = {
          1: 'Permití el acceso a tu ubicación en el navegador y volvé a intentarlo.',
          2: 'El dispositivo no pudo determinar tu ubicación.',
          3: 'La búsqueda de ubicación tardó demasiado.',
        };

        setLocationError(
          messages[error.code] ||
            'No se pudo obtener tu ubicación.'
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  return (
    <section
      className="mapa-enfermeros"
      aria-label="Mapa de enfermeros"
      style={{ position: 'relative' }}
    >
      <div className="mapa-toolbar">
        <div>
          <h2>Enfermeros cercanos</h2>
          <p>
            {markers.length} profesional
            {markers.length === 1 ? '' : 'es'} con ubicación
            disponible
          </p>
        </div>

        <button
          type="button"
          onClick={locateUser}
          disabled={locationState === 'loading'}
        >
          {locationState === 'loading'
            ? 'Buscando ubicación…'
            : 'Usar mi ubicación'}
        </button>
      </div>

      {/* Panel de información de la ruta real */}
      {userPosition && selectedPosition && (
        <div
          style={{
            position: 'absolute',
            top: '80px',
            right: '20px',
            zIndex: 1000,
            backgroundColor: 'white',
            padding: '12px 18px',
            borderRadius: '10px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            border: '1px solid #e2e8f0',
            fontFamily: "'Segoe UI', Roboto, sans-serif",
            maxWidth: '280px',
          }}
        >
          <h4
            style={{
              margin: '0 0 5px 0',
              color: '#1e293b',
              fontSize: '14px',
            }}
          >
            🚗 Mejor ruta por calles
          </h4>

          {loadingRoute && (
            <p style={{ margin: 0, color: '#64748b' }}>
              Calculando recorrido…
            </p>
          )}

          {!loadingRoute && ruta && (
            <p
              style={{
                margin: 0,
                color: '#0284c7',
                fontWeight: 'bold',
                fontSize: '15px',
              }}
            >
              {ruta.distancia.toFixed(1)} km · aprox.{' '}
              {Math.max(1, Math.ceil(ruta.tiempo / 60))} min
            </p>
          )}

          {!loadingRoute && routeError && (
            <p
              role="alert"
              style={{
                margin: 0,
                color: '#dc2626',
                fontSize: '13px',
              }}
            >
              {routeError}
            </p>
          )}
        </div>
      )}

      {locationError && (
        <p className="mapa-error" role="alert">
          {locationError}
        </p>
      )}

      <MapContainer
        center={center}
        zoom={userPosition || selectedPosition ? 13 : 11}
        className="mapa-leaflet"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FlyToSelected
          position={selectedPosition || userPosition}
        />

        {/* Ajustar la vista al recorrido completo */}
        {ruta && <FitRoute positions={ruta.positions} />}

        {/* Marcador de la ubicación del usuario */}
        {userPosition && (
          <>
            <CircleMarker
              center={userPosition}
              radius={9}
              pathOptions={{
                color: '#2563eb',
                fillColor: '#60a5fa',
                fillOpacity: 1,
              }}
            >
              <Popup>Tu ubicación</Popup>
            </CircleMarker>

            <Circle
              center={userPosition}
              radius={500}
              pathOptions={{
                color: '#2563eb',
                fillOpacity: 0.05,
              }}
            />
          </>
        )}

        {/* Recorrido real: sigue las calles, no una línea recta */}
        {ruta && (
          <Polyline
            positions={ruta.positions}
            pathOptions={{
              color: '#2563eb',
              weight: 5,
              opacity: 0.9,
            }}
          />
        )}

        {/* Marcadores de los enfermeros */}
        {markers.map(({ enfermero, position }) => {
          const id = enfermero.usuario_id ?? enfermero.id;

          return (
            <Marker
              key={id}
              position={position}
              icon={nurseIcon}
              eventHandlers={{
                click: () => onSelect?.(id),
              }}
            >
              <Popup>
                <div
                  style={{
                    fontFamily: "'Segoe UI', Roboto, sans-serif",
                    textAlign: 'center',
                    minWidth: '160px',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '15px',
                      color: '#1e293b',
                    }}
                  >
                    {enfermero.nombre} {enfermero.apellido}
                  </strong>

                  <p
                    style={{
                      margin: '4px 0 10px 0',
                      color: '#64748b',
                      fontSize: '13px',
                    }}
                  >
                    {enfermero.especialidad ||
                      'Enfermería general'}
                  </p>

                  <button
                    type="button"
                    onClick={() => navigate(`/perfil/${id}`, { state: { volverA } })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      backgroundColor: '#3498db',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '13px',
                      boxShadow:
                        '0 2px 4px rgba(52, 152, 219, 0.2)',
                    }}
                  >
                    Ver Perfil Completo
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {markers.length < enfermeros.length && (
        <p className="mapa-nota">
          Algunos profesionales no tienen coordenadas cargadas
          y no pueden mostrarse en el mapa.
        </p>
      )}
    </section>
  );
}
