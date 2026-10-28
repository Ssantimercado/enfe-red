import { useEffect, useRef, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MAPA_ATRIBUCION, MAPA_TILES_URL } from './mapaConfig';
import { useMiUbicacion } from './useUbicacion';

function SelectOnMap({ onChange }) {
  useMapEvents({ click: ({ latlng }) => onChange(latlng.lat, latlng.lng) });
  return null;
}

// Si el punto elegido quedó fuera de la vista (por ejemplo, con "Usar mi ubicación actual"), el mapa va hasta él.
function SeguirPunto({ position }) {
  const map = useMap();
  const [lat, lng] = position || [];
  useEffect(() => {
    if (lat == null || lng == null) return;
    if (!map.getBounds().contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }, [map, lat, lng]);
  return null;
}

export default function LocationPicker({
  latitude,
  longitude,
  onChange,
  helpText = 'Marcá tu zona de atención tocando el mapa. También podés moverlo con las flechas y elegir el centro. Este punto se publica en tu perfil.',
  conMiUbicacion = false,
}) {
  const map = useRef(null);
  const { estado, error, ubicar } = useMiUbicacion();
  const [aviso, setAviso] = useState('');
  // Si la persona toca el mapa mientras se busca la ubicación, gana el toque: el GPS que llega tarde no lo pisa.
  const pedido = useRef(0);
  const elegir = (lat, lng) => {
    pedido.current += 1;
    setAviso('');
    onChange(lat, lng);
  };
  const usarMiUbicacion = () => {
    const numero = ++pedido.current;
    ubicar(([lat, lng], precision) => {
      if (pedido.current !== numero) return;
      onChange(lat, lng);
      // Se acerca hasta la calle para que la persona confirme que el punto es donde está.
      map.current?.setView([lat, lng], 17);
      setAviso(precision > 100
        ? `La ubicación del navegador es aproximada (unos ${Math.round(precision)} m). Revisá que el punto esté donde te atienden; si no, tocá el mapa.`
        : '');
    });
  };
  const selected = latitude != null && longitude != null;
  const position = selected ? [latitude, longitude] : [-32.8895, -68.8458];
  return (
    <div className="location-picker">
      <p id="location-help">{helpText}</p>
      <MapContainer
        ref={map}
        center={position}
        zoom={selected ? 14 : 11}
        className="location-picker-map"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution={MAPA_ATRIBUCION}
          url={MAPA_TILES_URL}
        />
        <SelectOnMap onChange={elegir} />
        <SeguirPunto position={selected ? position : null} />
        {selected && (
          <CircleMarker
            center={position}
            radius={9}
            pathOptions={{ color: '#127a71', fillOpacity: 0.8 }}
          />
        )}
      </MapContainer>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          const center = map.current?.getCenter();
          if (center) elegir(center.lat, center.lng);
        }}
      >
        Elegir el centro del mapa
      </button>
      {conMiUbicacion && (
        <button type="button" className="button button-secondary" onClick={usarMiUbicacion} disabled={estado === 'loading'}>
          {estado === 'loading' ? 'Buscando tu ubicación…' : 'Usar mi ubicación actual'}
        </button>
      )}
      {aviso && <p className="notice notice-info" role="status">{aviso}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </div>
  );
}
