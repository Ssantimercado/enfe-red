
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
import { MAPA_ATRIBUCION, MAPA_TILES_URL, RUTAS_URL } from './mapaConfig';

const DEFAULT_CENTER = [-32.8895, -68.8458]; // Mendoza capital

const nurseIcon = new L.DivIcon({
  className: 'enfermero-marker',
  html: '<span>✚</span>',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36],
});

const patientIcon = new L.DivIcon({
  className: 'paciente-marker',
  html: '<span>●</span>',
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

function FitLocations({ positions }) {
  const map = useMap();

  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(L.latLngBounds(positions), {
        padding: [40, 40],
        maxZoom: 14,
      });
    } else if (positions.length === 1) {
      map.setView(positions[0], 14);
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
    if (!RUTAS_URL || !origen || !destino) {
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
          `${RUTAS_URL}/${coordenadas}` +
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
  personas,
  tipoPersona = 'enfermero',
  selectedId,
  onSelect,
  volverA = '/cartilla',
}) {
  const mostrandoPacientes = tipoPersona === 'paciente';
  const [userPosition, setUserPosition] = useState(null);
  const [locationState, setLocationState] = useState('idle');
  const [locationError, setLocationError] = useState('');

  const navigate = useNavigate();

  const selected = personas.find(
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
      personas
        .map((persona) => ({
          persona,
          position: coordinatesOf(persona),
        }))
        .filter((item) => item.position),
    [personas]
  );
  const markerPositions = useMemo(
    () => markers.map((item) => item.position),
    [markers]
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
      className={`mapa-enfermeros ${mostrandoPacientes ? 'mapa-pacientes' : ''}`}
      aria-label={mostrandoPacientes ? 'Mapa de pacientes asignados' : 'Mapa de enfermeros'}
      style={{ position: 'relative' }}
    >
      <div className="mapa-toolbar">
        <div>
          <h2>{mostrandoPacientes ? 'Ubicaciones compartidas' : 'Enfermeros cercanos'}</h2>
          <p>{mostrandoPacientes
            ? `${markers.length} paciente${markers.length === 1 ? '' : 's'} compartió su ubicación`
            : `${markers.length} profesional${markers.length === 1 ? '' : 'es'} con ubicación disponible`}
          </p>
        </div>

        <button
          type="button"
          onClick={locateUser}
          disabled={locationState === 'loading'}
        >
          {locationState === 'loading'
            ? 'Buscando ubicación…'
            : mostrandoPacientes
              ? 'Usar mi ubicación actual'
              : 'Usar mi ubicación'}
        </button>
      </div>

      {selectedPosition && RUTAS_URL && (
        <div className="mapa-route-summary">
          <h3><span aria-hidden="true">🚗</span> Mejor ruta por calles</h3>
          <p>
            Desde tu ubicación actual hasta{' '}
            {mostrandoPacientes ? 'el paciente' : 'el profesional'}.
          </p>
          {!userPosition && (
            <p>Usá el botón para calcular el recorrido, el tiempo y la distancia.</p>
          )}
          {loadingRoute && <p role="status">Calculando recorrido…</p>}
          {!loadingRoute && ruta && (
            <p className="mapa-route-details">
              {ruta.distancia.toFixed(1)} km · aprox.{' '}
              {Math.max(1, Math.ceil(ruta.tiempo / 60))} min
            </p>
          )}
          {!loadingRoute && routeError && (
            <p className="mapa-route-error" role="alert">{routeError}</p>
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
          attribution={MAPA_ATRIBUCION}
          url={MAPA_TILES_URL}
        />

        <FlyToSelected
          position={selectedPosition || userPosition}
        />

        {mostrandoPacientes && (
          <FitLocations positions={markerPositions} />
        )}

        {/* Ajustar la vista al recorrido completo */}
        {ruta && <FitRoute positions={ruta.positions} />}

        {/* Marcador de la ubicación actual del usuario */}
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

        {/* Los marcadores de pacientes solo se reciben del endpoint autorizado para el enfermero. */}
        {markers.map(({ persona, position }) => {
          const id = persona.usuario_id ?? persona.id;

          return (
            <Marker
              key={id}
              position={position}
              icon={mostrandoPacientes ? patientIcon : nurseIcon}
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
                    {persona.nombre} {persona.apellido}
                  </strong>

                  <p
                    style={{
                      margin: '4px 0 10px 0',
                      color: '#64748b',
                      fontSize: '13px',
                    }}
                  >
                    {mostrandoPacientes
                      ? `${persona.solicitudes_activas} solicitud${persona.solicitudes_activas === 1 ? '' : 'es'} activa${persona.solicitudes_activas === 1 ? '' : 's'}`
                      : persona.especialidad || 'Enfermería general'}
                  </p>

                  {!mostrandoPacientes && <button
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
                  </button>}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {markers.length < personas.length && (
        <p className="mapa-nota">
          {mostrandoPacientes
            ? 'Algunos pacientes todavía no eligieron compartir una ubicación y no aparecen en el mapa.'
            : 'Algunos profesionales no tienen coordenadas cargadas y no pueden mostrarse en el mapa.'}
        </p>
      )}
    </section>
  );
}
