// En producción, sin VITE_API_URL se usa el mismo dominio del sitio: nunca localhost,
// que en el celular de una persona apuntaría a su propio teléfono.
function resolverApiUrl() {
  const configurada = import.meta.env?.VITE_API_URL;
  if (configurada) return configurada.replace(/\/$/, '');
  if (import.meta.env?.PROD) {
    console.warn('Falta VITE_API_URL: la API se va a buscar en el mismo dominio del sitio.');
    return window.location.origin;
  }
  return 'http://localhost:5000';
}

export const API_URL = resolverApiUrl();
export const MENSAJE_SIN_CONEXION = 'No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.';
const ESPERA_MAXIMA_MS = 20000;

export function cerrarSesion() {
  ['token', 'refresh_token', 'rol', 'usuario'].forEach((key) => localStorage.removeItem(key));
}

export function guardarSesion({ token, refresh_token: refreshToken, rol, usuario }) {
  cerrarSesion();
  localStorage.setItem('token', token);
  if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
  localStorage.setItem('rol', rol || 'paciente');
  if (usuario) localStorage.setItem('usuario', JSON.stringify(usuario));
}

function leerToken(token) {
  try {
    if (!token || token.split('.').length !== 3) return null;
    const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
  } catch {
    return null;
  }
}

export function sesionActual() {
  const payload = leerToken(localStorage.getItem('token'));
  if (!payload) return null;
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= Date.now()) return null;
  if (!['paciente', 'enfermero', 'administrador'].includes(payload.rol)) return null;
  return payload;
}

// Con el token de acceso vencido todavía se puede renovar si el de renovación sigue vigente.
export function puedeRenovarSesion() {
  const payload = leerToken(localStorage.getItem('refresh_token'));
  return Boolean(payload && (!Number.isFinite(payload.exp) || payload.exp * 1000 > Date.now()));
}

const esCuentaInactiva = (mensaje) => /no está activa/i.test(mensaje || '');

// App registra la navegación del router para no recargar la página al cerrar la sesión.
const recargarEnLogin = (destino) => window.location.replace(destino);
let navegarAlLogin = recargarEnLogin;
export function registrarNavegacion(navegar) {
  navegarAlLogin = navegar || recargarEnLogin;
}

// Solo rutas de Enfered: evita que un enlace armado mande a la persona a otro sitio después de entrar.
// El navegador lee "/\\otro.com" como "//otro.com", así que también se rechazan la barra invertida
// y los caracteres de control, y se confirma que la dirección resultante sea de este mismo sitio.
export function rutaInterna(ruta) {
  if (typeof ruta !== 'string' || !ruta.startsWith('/') || ruta.startsWith('//')) return null;
  if ([...ruta].some((letra) => letra === '\\' || letra.charCodeAt(0) < 32 || letra.charCodeAt(0) === 127)) return null;
  try {
    const url = new URL(ruta, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    const limpia = `${url.pathname}${url.search}${url.hash}`;
    return limpia.startsWith('/login') ? null : limpia;
  } catch {
    return null;
  }
}

export function rutaDeLogin(motivo = 'expirada', volver) {
  const parametros = new URLSearchParams();
  const ruta = rutaInterna(volver ?? `${window.location.pathname}${window.location.search}`);
  if (ruta) parametros.set('volver', ruta);
  parametros.set('motivo', motivo);
  return `/login?${parametros}`;
}

export function cerrarSesionForzada(mensaje) {
  cerrarSesion();
  navegarAlLogin(rutaDeLogin(esCuentaInactiva(mensaje) ? 'suspendida' : 'expirada'));
}

// Varias pantallas pueden recibir un 401 a la vez: todas esperan la misma renovación.
let renovacionEnCurso = null;
export function renovarSesion() {
  if (!renovacionEnCurso) {
    renovacionEnCurso = (async () => {
      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) return { ok: false };
      let response;
      try {
        response = await fetch(`${API_URL}/api/token/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${refreshToken}` },
        });
      } catch {
        // Sin conexión no se cierra la sesión: puede volver a intentarse.
        return { ok: false, sinConexion: true };
      }
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.token) {
        localStorage.setItem('token', data.token);
        return { ok: true };
      }
      return { ok: false, sinConexion: response.status >= 500, mensaje: data.error };
    })().finally(() => {
      renovacionEnCurso = null;
    });
  }
  return renovacionEnCurso;
}

// Decide qué hacer con un 401 de una petición que llevaba token: true = reintentar.
export async function resolverNoAutorizado(tokenUsado, mensaje) {
  if (esCuentaInactiva(mensaje)) {
    cerrarSesionForzada(mensaje);
    return false;
  }
  // Otra petición ya renovó el token mientras esta esperaba respuesta.
  if (localStorage.getItem('token') && tokenUsado !== localStorage.getItem('token')) return true;
  const renovacion = await renovarSesion();
  if (renovacion.ok) return true;
  if (renovacion.sinConexion) {
    const error = new Error(MENSAJE_SIN_CONEXION);
    error.status = 401;
    throw error;
  }
  cerrarSesionForzada(renovacion.mensaje || mensaje);
  return false;
}

async function enviar(url, { signal, ...options }) {
  const controller = new AbortController();
  let porTiempo = false;
  const timer = window.setTimeout(() => {
    porTiempo = true;
    controller.abort();
  }, ESPERA_MAXIMA_MS);
  const cancelar = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', cancelar);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (signal?.aborted && !porTiempo) throw error;
    throw new Error(MENSAJE_SIN_CONEXION);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', cancelar);
  }
}

// Respuestas JSON para los formularios del rediseño; comparte el control de sesión.
// sesion: false es para el login y otras rutas públicas: un 401 ahí no cierra ninguna sesión.
export async function requestApi(path, { body, headers, sesion = true, ...options } = {}, reintento = false) {
  const token = sesion ? localStorage.getItem('token') : null;
  const { response, data } = await enviar(`${API_URL}/api${path}`, {
    ...options,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 401 && token && !reintento) {
    if (await resolverNoAutorizado(token, data.error)) {
      return requestApi(path, { body, headers, sesion, ...options }, true);
    }
  } else if (response.status === 401 && token) {
    cerrarSesionForzada(data.error);
  }
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
