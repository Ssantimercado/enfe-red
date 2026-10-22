import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export function cerrarSesion() {
  ['token', 'rol', 'usuario'].forEach((key) => localStorage.removeItem(key));
}

export function sesionActual() {
  try {
    const token = localStorage.getItem('token');
    if (!token || token.split('.').length !== 3) return null;
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
    );
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now())
      return null;
    if (!['paciente', 'enfermero', 'administrador'].includes(payload.rol)) return null;
    return payload;
  } catch {
    return null;
  }
}

function revisarSesion(status) {
  if (status === 401) {
    cerrarSesion();
    window.location.replace('/login?sesion=expirada');
  }
}

export async function apiFetch(url, options) {
  const response = await fetch(url, options);
  revisarSesion(response.status);
  return response;
}

export const api = axios.create({ baseURL: API_URL });
api.interceptors.response.use(
  (response) => response,
  (error) => {
    revisarSesion(error.response?.status);
    return Promise.reject(error);
  },
);

// Respuestas JSON para los formularios del rediseño; comparte el control de sesión.
export async function requestApi(path, { body, headers, ...options } = {}) {
  let response;
  try {
    response = await apiFetch(`${API_URL}/api${path}`, {
      ...options,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(localStorage.getItem('token')
          ? { Authorization: `Bearer ${localStorage.getItem('token')}` }
          : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('No podemos conectar con el servidor. Intentá nuevamente.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.error || 'No pudimos completar la solicitud. Intentá nuevamente.',
    );
    // Permite distinguir errores permanentes (403/404) de conflictos (409).
    error.status = response.status;
    throw error;
  }
  return data;
}

export const DAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
];
export const formatPrice = (value) =>
  Number(value) > 0
    ? `$${Number(value).toLocaleString('es-AR')}`
    : 'A consultar';

// wa.me pide el número internacional sin "+": en Argentina los celulares van como 54 9 + área + número,
// sin el 0 del área ni el 15.
export function enlaceWhatsapp(telefono, mensaje = 'Hola, te escribo desde Enfered por tus servicios de enfermería.') {
  let digitos = String(telefono || '').replace(/\D/g, '');
  if (digitos.startsWith('54')) digitos = digitos.slice(2);
  if (digitos.startsWith('9')) digitos = digitos.slice(1);
  digitos = digitos.replace(/^0/, '');
  if (digitos.length === 12) {
    const quince = [2, 3, 4].find((i) => digitos.slice(i, i + 2) === '15');
    if (quince !== undefined) digitos = digitos.slice(0, quince) + digitos.slice(quince + 2);
  }
  if (digitos.length !== 10) return null;
  return `https://wa.me/549${digitos}?text=${encodeURIComponent(mensaje)}`;
}
