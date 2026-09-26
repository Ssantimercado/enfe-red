import { useEffect, useMemo, useState } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [-34.6037, -58.3816];

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
    if (position) map.flyTo(position, Math.max(map.getZoom(), 14), { duration: 0.7 });
  }, [map, position]);
  return null;
}

function coordinatesOf(enfermero) {
  const lat = Number(enfermero.latitud ?? enfermero.latitude ?? enfermero.lat);
  const lng = Number(enfermero.longitud ?? enfermero.longitude ?? enfermero.lng ?? enfermero.lon);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lat, lng]
    : null;
}

export default function MapaEnfermeros({ enfermeros, selectedId, onSelect }) {
  const [userPosition, setUserPosition] = useState(null);
  const [locationState, setLocationState] = useState('idle');
  const [locationError, setLocationError] = useState('');
  const selected = enfermeros.find((item) => String(item.usuario_id ?? item.id) === String(selectedId));
  const selectedPosition = selected ? coordinatesOf(selected) : null;
  const center = userPosition || selectedPosition || DEFAULT_CENTER;

  const markers = useMemo(
    () => enfermeros.map((enfermero) => ({ enfermero, position: coordinatesOf(enfermero) })).filter((item) => item.position),
    [enfermeros],
  );

  const locateUser = () => {
    if (!navigator.geolocation) {
      setLocationState('error');
      setLocationError('Este navegador no permite obtener tu ubicación.');
      return;
    }
    if (!window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      setLocationState('error');
      setLocationError('La ubicación solo funciona en localhost o mediante HTTPS.');
      return;
    }
    setLocationState('loading');
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUserPosition([coords.latitude, coords.longitude]);
        setLocationState('ready');
      },
      (error) => {
        setLocationState('error');
        const messages = {
          1: 'Permití el acceso a tu ubicación en el navegador y volvé a intentarlo.',
          2: 'El dispositivo no pudo determinar tu ubicación. Verificá que la ubicación de Windows esté activa.',
          3: 'La búsqueda de ubicación tardó demasiado. Intentá nuevamente.',
        };
        setLocationError(messages[error.code] || 'No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <section className="mapa-enfermeros" aria-label="Mapa de enfermeros">
      <div className="mapa-toolbar">
        <div>
          <h2>Enfermeros cercanos</h2>
          <p>{markers.length} profesional{markers.length === 1 ? '' : 'es'} con ubicación disponible</p>
        </div>
        <button type="button" onClick={locateUser} disabled={locationState === 'loading'}>
          {locationState === 'loading' ? 'Buscando ubicación…' : 'Usar mi ubicación'}
        </button>
      </div>
      {locationError && <p className="mapa-error" role="alert">{locationError}</p>}
      <MapContainer center={center} zoom={userPosition || selectedPosition ? 13 : 11} className="mapa-leaflet" scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FlyToSelected position={selectedPosition || userPosition} />
        {userPosition && <><CircleMarker center={userPosition} radius={9} pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 1 }}><Popup>Tu ubicación</Popup></CircleMarker><Circle center={userPosition} radius={500} pathOptions={{ color: '#2563eb', fillOpacity: 0.05 }} /></>}
        {markers.map(({ enfermero, position }) => {
          const id = enfermero.usuario_id ?? enfermero.id;
          return <Marker key={id} position={position} icon={nurseIcon} eventHandlers={{ click: () => onSelect?.(id) }}><Popup><strong>{enfermero.nombre} {enfermero.apellido}</strong><br />{enfermero.especialidad || 'Enfermería general'}{enfermero.distancia_km != null && <><br />{Number(enfermero.distancia_km).toFixed(1)} km</>}</Popup></Marker>;
        })}
      </MapContainer>
      {markers.length < enfermeros.length && <p className="mapa-nota">Algunos profesionales no tienen coordenadas cargadas y no pueden mostrarse en el mapa.</p>}
    </section>
  );
}
