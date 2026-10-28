import { useEffect, useMemo } from 'react';
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAPA_ATRIBUCION, MAPA_TILES_URL } from './mapaConfig';
import { distanciaLineal, useMiUbicacion, useRutaReal } from './useUbicacion';

// Encuadra el lugar de atención, o el recorrido completo cuando ya se conoce.
function Encuadrar({ puntos }) {
  const map = useMap();
  useEffect(() => {
    if (puntos.length > 1) map.fitBounds(L.latLngBounds(puntos), { padding: [36, 36], maxZoom: 16 });
  }, [map, puntos]);
  return null;
}

const minutos = (segundos) => Math.max(1, Math.ceil(segundos / 60));
const km = (valor) => valor.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Para el enfermero: dónde lo espera el paciente, a qué distancia está y cómo llegar.
export default function UbicacionAtencion({ ubicacion, direccion, paciente }) {
  const lat = ubicacion?.latitud;
  const lng = ubicacion?.longitud;
  const destino = useMemo(() => (lat != null && lng != null ? [lat, lng] : null), [lat, lng]);
  const { posicion, estado, error, ubicar } = useMiUbicacion();
  const { ruta, loadingRoute, routeError } = useRutaReal(posicion, destino);
  const puntos = useMemo(
    () => ruta?.positions || (posicion && destino ? [posicion, destino] : []),
    [ruta, posicion, destino],
  );
  const enPestana = <span className="sr-only"> (se abre en otra pestaña)</span>;

  // Pedidos anteriores a la ubicación obligatoria: solo queda la dirección escrita.
  if (!destino) {
    return (
      <div className="ubicacion-atencion">
        <p className="notice notice-info">
          El paciente todavía no marcó el lugar en el mapa. Podés pedirle por el chat que lo marque desde Mis
          solicitudes; cuando lo haga, te avisamos y aparece acá. La dirección es: <strong>{direccion}</strong>.
        </p>
        <a
          className="button button-secondary"
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion || '')}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Buscar la dirección en Google Maps{enPestana}
        </a>
      </div>
    );
  }

  const lineal = posicion ? distanciaLineal(posicion, destino) : null;
  return (
    <section className="ubicacion-atencion" aria-label={`Lugar de atención${paciente ? ` de ${paciente}` : ''}`}>
      <p className="ubicacion-atencion-direccion">
        <strong>Lugar de atención:</strong> {direccion}
      </p>
      <MapContainer center={destino} zoom={15} className="ubicacion-atencion-mapa" scrollWheelZoom={false}>
        <TileLayer attribution={MAPA_ATRIBUCION} url={MAPA_TILES_URL} />
        <Encuadrar puntos={puntos} />
        <CircleMarker
          center={destino}
          radius={11}
          pathOptions={{ color: '#a52e3b', fillColor: '#d94b5a', fillOpacity: 0.9 }}
        >
          <Popup>Lugar de atención{paciente ? ` de ${paciente}` : ''}</Popup>
        </CircleMarker>
        {posicion && (
          <CircleMarker
            center={posicion}
            radius={9}
            pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 1 }}
          >
            <Popup>Estás acá</Popup>
          </CircleMarker>
        )}
        {ruta && <Polyline positions={ruta.positions} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.9 }} />}
      </MapContainer>

      <div aria-live="polite">
        {loadingRoute && <p>Calculando el recorrido…</p>}
        {!loadingRoute && ruta && (
          <p className="mapa-route-details">
            Estás a {km(ruta.distancia)} km · unos {minutos(ruta.tiempo)} min en auto
          </p>
        )}
        {!loadingRoute && !ruta && lineal != null && (
          <p className="mapa-route-details">Estás a unos {km(lineal)} km en línea recta</p>
        )}
        {routeError && <p className="mapa-route-error">No pudimos calcular el recorrido por calles. Abrí Google Maps para navegar.</p>}
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}

      <div className="solicitud-card-actions">
        <button className="button button-secondary" type="button" onClick={() => ubicar()} disabled={estado === 'loading'}>
          {estado === 'loading' ? 'Buscando dónde estás…' : posicion ? 'Actualizar desde donde estoy' : 'Ver cómo llegar desde donde estoy'}
        </button>
        <a
          className="button button-secondary"
          href={`https://www.google.com/maps/dir/?api=1&destination=${destino[0]},${destino[1]}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Abrir en Google Maps{enPestana}
        </a>
      </div>
    </section>
  );
}
