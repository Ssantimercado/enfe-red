import { useRef } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function SelectOnMap({ onChange }) {
  useMapEvents({ click: ({ latlng }) => onChange(latlng.lat, latlng.lng) });
  return null;
}

export default function LocationPicker({
  latitude,
  longitude,
  onChange,
  helpText = 'Marcá tu zona de atención haciendo clic en el mapa. También podés moverlo con las flechas y elegir el centro. Este punto se publica en tu perfil.',
}) {
  const map = useRef(null);
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <SelectOnMap onChange={onChange} />
        {selected && (
          <CircleMarker
            center={position}
            radius={9}
            pathOptions={{ color: '#137e75', fillOpacity: 0.8 }}
          />
        )}
      </MapContainer>
      <button
        type="button"
        className="button button-secondary"
        onClick={() => {
          const center = map.current?.getCenter();
          if (center) onChange(center.lat, center.lng);
        }}
      >
        Elegir el centro del mapa
      </button>
    </div>
  );
}
