import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api', timeout: 15000 });
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${localStorage.getItem('token')}`;
  return config;
});

export const obtenerProfesional = (id, signal) => api.get(`/usuarios/${id}`, { signal }).then(r => r.data);
export const crearSolicitud = (datos) => api.post('/solicitudes', datos).then(r => r.data);
export const obtenerSolicitud = (id, signal) => api.get(`/solicitudes/${id}`, { signal }).then(r => r.data);
export const cancelarSolicitud = (id) => api.put(`/solicitudes/${id}/cancelar`).then(r => r.data);
export function errorSolicitud(error) {
  if (error.response?.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
  if (error.response?.status === 404) return 'No se encontró el recurso o esta función todavía no está disponible en el servidor.';
  return error.response?.data?.error || 'No se pudo completar la operación. Revisá tu conexión e intentá nuevamente.';
}
