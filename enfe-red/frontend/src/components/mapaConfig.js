// Servidores del mapa configurables por entorno: los públicos de OpenStreetMap y OSRM
// son de prueba y limitan el tráfico, así que en producción conviene usar uno propio o contratado.
export const MAPA_TILES_URL =
  import.meta.env?.VITE_MAPA_TILES_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
export const MAPA_ATRIBUCION =
  import.meta.env?.VITE_MAPA_ATRIBUCION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
// Definida como cadena vacía desactiva el cálculo de rutas por calles.
export const RUTAS_URL = (
  import.meta.env?.VITE_RUTAS_URL ?? 'https://router.project-osrm.org/route/v1/driving'
).replace(/\/$/, '');
