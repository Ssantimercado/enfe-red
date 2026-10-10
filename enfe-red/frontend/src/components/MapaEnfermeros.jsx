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

// Función para calcular distancia (Haversine) y tiempo estimado urbano
function calcularRutaInfo(pos1, pos2) {
  if (!pos1 || !pos2) return null;
  const [lat1, lon1] = pos1;
  const [lat2, lon2] = pos2;
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanciaKm = R * c;
  
  // Promedio velocidad urbana estimada: 30 km/h -> minutos = (distancia / 30) * 60
  const minutosEstimados = Math.round((distanciaKm / 30) * 60);

  return {
    distancia: distanciaKm.toFixed(1),
    tiempo: minutosEstimados < 1 ? 1 : minutosEstimados
  };
}

export default function MapaEnfermeros({ enfermeros, selectedId, onSelect }) {
  const [userPosition, setUserPosition] = useState(null);
  const [locationState, setLocationState] = useState('idle');
  const [locationError, setLocationError] = useState('');
  
  const navigate = useNavigate();

  const selected = enfermeros.find((item) => String(item.usuario_id ?? item.id) === String(selectedId));
  const selectedPosition = selected ? coordinatesOf(selected) : null;
  const center = userPosition || selectedPosition || DEFAULT_CENTER;

  const markers = useMemo(
    () => enfermeros.map((enfermero) => ({ enfermero, position: coordinatesOf(enfermero) })).filter((item) => item.position),
    [enfermeros],
  );

  // Información de ruta si el usuario tiene su ubicación y seleccionó un enfermero
  const infoRuta = userPosition && selectedPosition ? calcularRutaInfo(userPosition, selectedPosition) : null;

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
          2: 'El dispositivo no pudo determinar tu ubicación.',
          3: 'La búsqueda de ubicación tardó demasiado.',
        };
        setLocationError(messages[error.code] || 'No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  return (
    <section className="mapa-enfermeros" aria-label="Mapa de enfermeros" style={{ position: 'relative' }}>
      <div className="mapa-toolbar">
        <div>
          <h2>Enfermeros cercanos</h2>
          <p>{markers.length} profesional{markers.length === 1 ? '' : 'es'} con ubicación disponible</p>
        </div>
        <button type="button" onClick={locateUser} disabled={locationState === 'loading'}>
          {locationState === 'loading' ? 'Buscando ubicación…' : 'Usar mi ubicación'}
        </button>
      </div>

      {/* Panel flotante de distancia y tiempo si hay ruta activa */}
      {infoRuta && (
        <div style={{
          position: 'absolute', top: '80px', right: '20px', zIndex: 1000,
          backgroundColor: 'white', padding: '12px 18px', borderRadius: '10px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)', border: '1px solid #e2e8f0',
          fontFamily: "'Segoe UI', Roboto, sans-serif"
        }}>
          <h4 style={{ margin: '0 0 5px 0', color: '#1e293b', fontSize: '14px' }}>🚗 Mejor Ruta Estimada</h4>
          <p style={{ margin: 0, color: '#0284c7', fontWeight: 'bold', fontSize: '15px' }}>
            {infoRuta.distancia} km • aprox. {infoRuta.tiempo} min
          </p>
        </div>
      )}

      {locationError && <p className="mapa-error" role="alert">{locationError}</p>}
      
      <MapContainer center={center} zoom={userPosition || selectedPosition ? 13 : 11} className="mapa-leaflet" scrollWheelZoom>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <FlyToSelected position={selectedPosition || userPosition} />
        
        {/* Marcador de la ubicación del usuario */}
        {userPosition && (
          <>
            <CircleMarker center={userPosition} radius={9} pathOptions={{ color: '#2563eb', fillColor: '#60a5fa', fillOpacity: 1 }}>
              <Popup>Tu ubicación</Popup>
            </CircleMarker>
            <Circle center={userPosition} radius={500} pathOptions={{ color: '#2563eb', fillOpacity: 0.05 }} />
          </>
        )}

        {/* Línea de ruta entre el usuario y el enfermero seleccionado */}
        {userPosition && selectedPosition && (
          <Polyline positions={[userPosition, selectedPosition]} pathOptions={{ color: '#2563eb', weight: 4, dashArray: '6, 6' }} />
        )}

        {/* Marcadores de los enfermeros */}
        {markers.map(({ enfermero, position }) => {
          const id = enfermero.usuario_id ?? enfermero.id;
          return (
            <Marker 
              key={id} 
              position={position} 
              icon={nurseIcon} 
              eventHandlers={{ click: () => onSelect?.(id) }}
            >
              <Popup>
                <div style={{ fontFamily: "'Segoe UI', Roboto, sans-serif", textAlign: 'center', minWidth: '160px' }}>
                  <strong style={{ fontSize: '15px', color: '#1e293b' }}>{enfermero.nombre} {enfermero.apellido}</strong>
                  <p style={{ margin: '4px 0 10px 0', color: '#64748b', fontSize: '13px' }}>{enfermero.especialidad || 'Enfermería general'}</p>
                  
                  <button 
                    onClick={() => navigate(`/perfil/${id}`)}
                    style={{
                      width: '100%', padding: '8px 12px', backgroundColor: '#3498db', color: 'white',
                      border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px',
                      boxShadow: '0 2px 4px rgba(52, 152, 219, 0.2)'
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
      
      {markers.length < enfermeros.length && <p className="mapa-nota">Algunos profesionales no tienen coordenadas cargadas y no pueden mostrarse en el mapa.</p>}
    </section>
  );
}