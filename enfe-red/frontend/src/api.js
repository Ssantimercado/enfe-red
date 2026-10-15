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
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
    if (!['paciente', 'enfermero'].includes(payload.rol)) return null;
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
api.interceptors.response.use((response) => response, (error) => {
  revisarSesion(error.response?.status);
  return Promise.reject(error);
});
