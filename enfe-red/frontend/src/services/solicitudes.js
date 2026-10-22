import axios from 'axios';
import { API_URL, MENSAJE_SIN_CONEXION, cerrarSesionForzada, resolverNoAutorizado } from '../api';

const api = axios.create({ baseURL: `${API_URL}/api`, timeout: 20000 });
api.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${localStorage.getItem('token')}`;
  return config;
});
// Misma renovación de sesión que requestApi: un solo intento y después se reintenta el pedido.
api.interceptors.response.use(response => response, async error => {
  const { config, response } = error;
  if (response?.status !== 401 || !config) return Promise.reject(error);
  if (config.reintentoSesion) {
    cerrarSesionForzada(response.data?.error);
    return Promise.reject(error);
  }
  const tokenUsado = String(config.headers?.Authorization || '').replace(/^Bearer /, '');
  if (await resolverNoAutorizado(tokenUsado, response.data?.error)) {
    return api({ ...config, reintentoSesion: true });
  }
  return Promise.reject(error);
});

export const obtenerProfesional = (id, signal) => api.get(`/usuarios/${id}`, { signal }).then(r => r.data);
export const obtenerServicios = (signal) => api.get('/servicios', { signal }).then(r => r.data);
export const crearSolicitud = (datos) => api.post('/solicitudes', datos).then(r => r.data);
export const obtenerSolicitud = (id, signal) => api.get(`/solicitudes/${id}`, { signal }).then(r => r.data);
export const cancelarSolicitud = (id) => api.put(`/solicitudes/${id}/cancelar`).then(r => r.data);
// El paciente cambia día u hora de un turno Pendiente o Aceptado (vuelve a quedar Pendiente).
export const reprogramarSolicitud = (id, { fecha, hora }) => api.put(`/solicitudes/${id}/reprogramar`, { fecha, hora }).then(r => r.data);
// El enfermero cancela un turno ya aceptado; el motivo le llega al paciente.
export const cancelarTurnoEnfermero = (id, motivo) => api.put(`/solicitudes/${id}/cancelar-enfermero`, { motivo }).then(r => r.data);
export const obtenerSolicitudesEnfermero =(id, signal) => api.get(`/solicitudes/enfermero/${id}`, { signal }).then(r => r.data);
// Manda el día y la hora que ve el enfermero: si el paciente los cambió, el servidor responde 409 con la solicitud nueva.
export const aceptarSolicitud = (id, { fecha, hora } = {}) => api.put(`/solicitudes/${id}/aceptar`, fecha && hora ? { fecha, hora } : undefined).then(r => r.data);
export const rechazarSolicitud = (id) => api.put(`/solicitudes/${id}/rechazar`).then(r => r.data);
// SCRUM-59.3: el enfermero marca como realizada una atención aceptada cuyo turno ya pasó.
export const finalizarSolicitud = (id) => api.put(`/solicitudes/${id}/finalizar`).then(r => r.data);
// SCRUM-58.3: todas las solicitudes del paciente, en cualquier estado.
export const obtenerSolicitudesPaciente = (id, signal) => api.get(`/solicitudes/paciente/${id}`, { params: { todas: 1 }, signal }).then(r => r.data);
export function errorSolicitud(error) {
  if (error.response?.status === 401) return error.response.data?.error || 'Tu sesión venció. Volvé a iniciar sesión.';
  // Sin respuesta del servidor: se cortó la conexión o pasaron los 20 segundos de espera.
  if (error.message === MENSAJE_SIN_CONEXION || ['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'].includes(error.code)) return MENSAJE_SIN_CONEXION;
  if (error.response?.status === 404) return error.response.data?.error || 'No encontramos lo que buscabas. Puede que ya no esté disponible.';
  return error.response?.data?.error || 'No se pudo completar la operación. Revisá tu conexión e intentá nuevamente.';
}
