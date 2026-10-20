import axios from 'axios';
import { API_URL, cerrarSesion } from '../api';

const api = axios.create({ baseURL: `${API_URL.replace(/\/$/, '')}/api`, timeout: 15000 });
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${localStorage.getItem('token')}`;
  return config;
});
api.interceptors.response.use(response => response, error => {
  if (error.response?.status === 401) {
    cerrarSesion();
    window.location.replace('/login?sesion=expirada');
  }
  return Promise.reject(error);
});

export const obtenerProfesional = (id, signal) => api.get(`/usuarios/${id}`, { signal }).then(r => r.data);
export const obtenerServicios = (signal) => api.get('/servicios', { signal }).then(r => r.data);
export const crearSolicitud = (datos) => api.post('/solicitudes', datos).then(r => r.data);
export const obtenerSolicitud = (id, signal) => api.get(`/solicitudes/${id}`, { signal }).then(r => r.data);
export const cancelarSolicitud = (id) => api.put(`/solicitudes/${id}/cancelar`).then(r => r.data);
export const obtenerSolicitudesEnfermero = (id, signal) => api.get(`/solicitudes/enfermero/${id}`, { signal }).then(r => r.data);
export const aceptarSolicitud = (id) => api.put(`/solicitudes/${id}/aceptar`).then(r => r.data);
export const rechazarSolicitud = (id) => api.put(`/solicitudes/${id}/rechazar`).then(r => r.data);
// SCRUM-59.3: el enfermero marca como realizada una atención aceptada cuyo turno ya pasó.
export const finalizarSolicitud = (id) => api.put(`/solicitudes/${id}/finalizar`).then(r => r.data);
// SCRUM-58.3: todas las solicitudes del paciente, en cualquier estado.
export const obtenerSolicitudesPaciente = (id, signal) => api.get(`/solicitudes/paciente/${id}`, { params: { todas: 1 }, signal }).then(r => r.data);
export function errorSolicitud(error) {
  if (error.response?.status === 401) return 'Tu sesión venció. Volvé a iniciar sesión.';
  if (error.response?.status === 404) return 'No se encontró el recurso o esta función todavía no está disponible en el servidor.';
  return error.response?.data?.error || 'No se pudo completar la operación. Revisá tu conexión e intentá nuevamente.';
}
