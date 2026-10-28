import { useEffect, useMemo } from 'react';
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
import { fechaLegible } from '../fechas';
import { MAPA_ATRIBUCION, MAPA_TILES_URL } from './mapaConfig';
import { distanciaLineal, useMiUbicacion, useRutaReal } from './useUbicacion';

const km = (valor) => valor.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const enlaceGoogleMaps = ([lat, lng]) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
const textoTurno = (turno) => turno && `${turno.estado === 'Pendiente' ? 'Pedido pendiente' : 'Turno aceptado'}: ${fechaLegible(turno.fecha, turno.hora)}`;

const DEFAULT_CENTER = [-32.8895, -68.8458]; // Mendoza capital
// El backend publica la ubicación del profesional redondeada a unos 1 km: el círculo muestra esa zona.
const RADIO_ZONA_METROS = 700;

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

// Con la ubicación redondeada, dos profesionales de la misma zona caen en el mismo punto y el de abajo
// no se puede tocar. Se reparten en un círculo chico alrededor de ese punto (solo para mostrarlos).
const SEPARACION_GRADOS = 0.0025; // unos 250 m
function separarRepetidos(items) {
  const grupos = new Map();
  items.forEach((item) => {
    const clave = item.position.map((valor) => valor.toFixed(5)).join(',');
    grupos.set(clave, [...(grupos.get(clave) || []), item]);
  });
  return [...grupos.values()].flatMap((grupo) => grupo.map((item, indice) => {
    if (grupo.length === 1) return item;
    const angulo = (2 * Math.PI * indice) / grupo.length;
    const [lat, lng] = item.position;
    // original: el círculo de la zona sigue en el punto publicado; solo el marcador se corre.
    return {
      ...item,
      original: item.position,
      position: [lat + SEPARACION_GRADOS * Math.sin(angulo), lng + SEPARACION_GRADOS * Math.cos(angulo)],
    };
  }));
}

export default function MapaEnfermeros({
  personas,
  tipoPersona = 'enfermero',
  selectedId,
  onSelect,
  volverA = '/cartilla',
}) {
  const mostrandoPacientes = tipoPersona === 'paciente';
  const {
    posicion: userPosition,
    estado: locationState,
    error: locationError,
    ubicar: locateUser,
  } = useMiUbicacion();

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
    () => separarRepetidos(
      personas
        .map((persona) => ({
          persona,
          position: coordinatesOf(persona),
        }))
        .filter((item) => item.position)
    ),
    [personas]
  );
  const markerPositions = useMemo(
    () => markers.map((item) => item.position),
    [markers]
  );

  // Recorrido desde la ubicación de quien mira hasta el elegido: el enfermero va al lugar de atención del
  // paciente, y el paciente ve la ruta estimada hasta la zona del profesional (como en el Incremento 3).
  const { ruta, loadingRoute, routeError } = useRutaReal(userPosition, selectedPosition);
  const cantidad = `${markers.length} profesional${markers.length === 1 ? '' : 'es'}`;
  // Sin servicio de rutas (o si falla) se muestra al menos la distancia en línea recta.
  const lineal = userPosition && selectedPosition ? distanciaLineal(userPosition, selectedPosition) : null;
  const nombreElegido = selected ? [selected.nombre, selected.apellido].filter(Boolean).join(' ') : '';
  const minutosRuta = ruta ? Math.max(1, Math.ceil(ruta.tiempo / 60)) : null;

  // Al tocar a alguien se muestra el recorrido: si todavía no se sabe dónde está quien mira, se le pregunta.
  function elegir(id) {
    onSelect?.(id);
    if (!userPosition && locationState !== 'loading') locateUser();
  }

  return (
    <section
      className={`mapa-enfermeros ${mostrandoPacientes ? 'mapa-pacientes' : ''}`}
      aria-label={mostrandoPacientes ? 'Mapa de pacientes asignados' : 'Mapa de enfermeros cerca de tu zona'}
      style={{ position: 'relative' }}
    >
      <div className="mapa-toolbar">
        <div>
          <h2>{mostrandoPacientes ? 'Tus pacientes en el mapa' : 'Enfermeros cerca de tu zona'}</h2>
          <p>{mostrandoPacientes
            ? `${markers.length === 1 ? '1 paciente' : `${markers.length} pacientes`} con turno pendiente o aceptado. Tocá uno para ver el recorrido, la distancia y cómo llegar.`
            : `${markers.length === 1 ? 'Hay 1 profesional' : `Hay ${cantidad}`} en el mapa. Cada círculo es la zona donde atiende, no su domicilio. Tocá uno para ver la ruta estimada y su perfil.`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => locateUser()}
          disabled={locationState === 'loading'}
        >
          {locationState === 'loading'
            ? 'Buscando ubicación…'
            : mostrandoPacientes
              ? 'Usar mi ubicación actual'
              : 'Mostrar dónde estoy'}
        </button>
      </div>

      {mostrandoPacientes && selectedPosition && (
        <div className="mapa-route-summary">
          <h3><span aria-hidden="true">🚗</span> Cómo llegar a {nombreElegido || 'el paciente'}</h3>
          {selected?.turno && (
            <p>{textoTurno(selected.turno)} · {selected.turno.direccionAtencion}</p>
          )}
          {!userPosition && (
            <p>Usá el botón “Usar mi ubicación actual” para ver el recorrido, la distancia y el tiempo.</p>
          )}
          <div aria-live="polite">
            {loadingRoute && <p>Calculando recorrido…</p>}
            {!loadingRoute && ruta && (
              <p className="mapa-route-details">
                Estás a {km(ruta.distancia)} km · unos {minutosRuta} min en auto
              </p>
            )}
            {!loadingRoute && !ruta && lineal != null && (
              <p className="mapa-route-details">Estás a unos {km(lineal)} km en línea recta</p>
            )}
          </div>
          {!loadingRoute && routeError && (
            <p className="mapa-route-error">No pudimos calcular el recorrido por calles. Abrí Google Maps para navegar.</p>
          )}
          <a
            className="button button-primary"
            href={enlaceGoogleMaps(selectedPosition)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir en Google Maps<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </div>
      )}

      {!mostrandoPacientes && selectedPosition && (
        <div className="mapa-route-summary">
          <h3><span aria-hidden="true">🚗</span> Mejor ruta estimada</h3>
          <p>Desde tu ubicación hasta la zona de {nombreElegido || 'el profesional'}.</p>
          {!userPosition && (
            <p>Usá el botón “Mostrar dónde estoy” para ver el recorrido, la distancia y el tiempo.</p>
          )}
          <div aria-live="polite">
            {loadingRoute && <p>Calculando recorrido…</p>}
            {!loadingRoute && ruta && (
              <p className="mapa-route-details">{km(ruta.distancia)} km · aprox. {minutosRuta} min</p>
            )}
            {!loadingRoute && !ruta && lineal != null && (
              <p className="mapa-route-details">A unos {km(lineal)} km en línea recta</p>
            )}
          </div>
          {!loadingRoute && routeError && (
            <p className="mapa-route-error">No pudimos calcular el recorrido por calles.</p>
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

        {/* Zona aproximada de cada profesional: solo de fondo, el que se toca es el marcador. */}
        {!mostrandoPacientes && markers.map(({ persona, position, original }) => (
          <Circle
            key={`zona-${persona.usuario_id ?? persona.id}`}
            center={original || position}
            radius={RADIO_ZONA_METROS}
            interactive={false}
            pathOptions={{ color: '#127a71', weight: 1, fillColor: '#127a71', fillOpacity: 0.12 }}
          />
        ))}

        {/* Los marcadores de pacientes solo se reciben del endpoint autorizado para el enfermero. */}
        {markers.map(({ persona, position }) => {
          const id = persona.usuario_id ?? persona.id;

          return (
            <Marker
              key={id}
              position={position}
              icon={mostrandoPacientes ? patientIcon : nurseIcon}
              title={[`${persona.nombre || ''} ${persona.apellido || ''}`.trim(), mostrandoPacientes && textoTurno(persona.turno)]
                .filter(Boolean).join(' · ')}
              eventHandlers={{
                click: () => elegir(id),
              }}
            >
              {/* Para un paciente, nombre, turno, recorrido y Google Maps están en el resumen de arriba: sin globo, que
                  además quedaba cortado al encuadrar el recorrido. */}
              {!mostrandoPacientes && <Popup>
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
                      color: '#546878',
                      fontSize: '14px',
                    }}
                  >
                    {[
                      persona.especialidad || 'Enfermería general',
                      persona.distancia_km != null ? `a unos ${persona.distancia_km} km` : null,
                      'Atiende por esta zona',
                    ].filter(Boolean).join(' · ')}
                  </p>

                  <button
                    type="button"
                    onClick={() => navigate(`/perfil/${id}`, { state: { volverA } })}
                    style={{
                      width: '100%',
                      minHeight: '44px',
                      padding: '8px 12px',
                      backgroundColor: '#11658f',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 'bold',
                      fontSize: '14px',
                    }}
                  >
                    Ver perfil completo
                  </button>
                </div>
              </Popup>}
            </Marker>
          );
        })}
      </MapContainer>

      {(mostrandoPacientes
        // Solo cuentan los turnos en curso: los pacientes con turnos cerrados no tienen por qué estar en el mapa.
        ? personas.some((persona) => persona.solicitudes_activas > 0 && !coordinatesOf(persona))
        : markers.length < personas.length) && (
        <p className="mapa-nota">
          {mostrandoPacientes
            ? 'Algunos pacientes no tienen el lugar de atención marcado (pedidos anteriores al mapa) y no aparecen. Su dirección está en Solicitudes.'
            : 'Algunos profesionales no cargaron su zona de atención y no aparecen en el mapa.'}
        </p>
      )}
    </section>
  );
}
