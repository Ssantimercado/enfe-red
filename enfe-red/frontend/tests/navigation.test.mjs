import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import React, { act } from 'react';
import axios from 'axios';

const originalAdapter = axios.defaults.adapter;
let solicitudRequests = [];
let solicitudHandler;
axios.defaults.adapter = async config => {
  solicitudRequests.push(config);
  const { data, status = 200 } = await solicitudHandler(config);
  const result = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) throw new axios.AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, result);
  return result;
};

const dom = new JSDOM('<div id="root"></div>', {
  url: 'http://localhost:5173',
});
for (const key of [
  'window',
  'document',
  'localStorage',
  'HTMLElement',
  'Element',
  'SVGElement',
  'Node',
  'MouseEvent',
]) {
  globalThis[key] = dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// React DOM debe detectar el DOM antes de inicializar sus eventos de formulario.
const { createRoot } = await import('react-dom/client');
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = function () {};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; };
let App, root;
const profile = {
  id: 1,
  nombre: 'Ana',
  apellido: 'Perez',
  email: 'ana@test.local',
  matricula: 'MAT-1',
  rol: 'enfermero',
};
let requests = [];

function session(rol = 'paciente', exp = Math.floor(Date.now() / 1000) + 600) {
  localStorage.setItem(
    'token',
    'header.' +
      Buffer.from(JSON.stringify({ sub: '1', rol, exp })).toString(
        'base64url',
      ) +
      '.signature',
  );
  localStorage.setItem('rol', rol);
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function button(text) {
  const found = [...document.querySelectorAll('button')].find((element) =>
    (element.getAttribute('aria-label') || element.textContent)
      .toLowerCase()
      .includes(text.toLowerCase()),
  );
  assert.ok(found, `No se encontró el botón ${text}`);
  return found;
}

function link(text) {
  const found = [...document.querySelectorAll('a')].find((element) =>
    element.textContent.toLowerCase().includes(text.toLowerCase()),
  );
  assert.ok(found, `No se encontró el enlace ${text}`);
  return found;
}

async function click(element) {
  await act(async () =>
    element.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
}

async function type(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function typeTextArea(element, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    ).set.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function submitForm() {
  await act(async () => document.querySelector('form').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true }),
  ));
}

async function mount(path, state = null) {
  window.history.replaceState(state, '', path);
  root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(App)));
}

before(async () => {
  await build({
    entryPoints: { app: 'src/App.jsx', api: 'src/api.js' },
    outdir: '.test-build',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    splitting: true,
    packages: 'external',
    jsx: 'automatic',
    loader: { '.png': 'file', '.webp': 'file' },
    define: { 'import.meta.env.VITE_API_URL': 'undefined' },
  });
  App = (await import(pathToFileURL(resolve('.test-build/app.mjs')))).default;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  localStorage.clear();
  requests = [];
  solicitudRequests = [];
  solicitudHandler = undefined;
});

after(() => { axios.defaults.adapter = originalAdapter; dom.window.close(); });

globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), options });
  if (String(url).includes('/horarios')) return response([]);
  if (String(url).includes('/buscar'))
    return response({ enfermeros: [], total_resultados: 0, total_paginas: 0 });
  if (String(url).endsWith('/enfermeros')) return response([]);
  return response(profile);
};

test('login permite navegar a recuperación y volver', async () => {
  await mount('/login');
  await click(link('Olvidaste'));
  assert.equal(window.location.pathname, '/recuperar-password');
  await click(link('Volver a iniciar sesión'));
  assert.equal(window.location.pathname, '/login');
});

test('la entrada es pública y permite ir al login sin consultar datos privados', async () => {
  await mount('/');
  assert.equal(window.location.pathname, '/');
  assert.match(
    document.querySelector('h1').textContent,
    /El cuidado que necesitás/,
  );
  assert.equal(requests.length, 0);
  await click(link('Iniciar sesión'));
  assert.equal(window.location.pathname, '/login');
});

test('el acceso profesional de la landing selecciona ese rol en el registro', async () => {
  await mount('/');
  await click(link('Crear perfil profesional'));
  assert.equal(window.location.pathname, '/registro');
  assert.equal(
    document.querySelector('input[name="rol"]:checked').value,
    'enfermero',
  );
});

test('la landing sigue accesible con sesión y permite volver al espacio personal', async () => {
  session();
  await mount('/');
  assert.equal(window.location.pathname, '/');
  await click(link('Mi espacio'));
  assert.equal(window.location.pathname, '/home');
});

test('una URL desconocida vuelve al login sin sesión', async () => {
  await mount('/no-existe');
  assert.equal(window.location.pathname, '/login');
});

test('una URL desconocida vuelve al panel con sesión válida', async () => {
  session();
  await mount('/no-existe');
  assert.equal(window.location.pathname, '/home');
});

test('un token vencido se limpia y muestra el aviso de sesión', async () => {
  session('paciente', Math.floor(Date.now() / 1000) - 1);
  await mount('/perfil-paciente');
  assert.equal(window.location.pathname, '/login');
  assert.equal(localStorage.getItem('token'), null);
  assert.match(document.body.textContent, /Tu sesión terminó/);
});

test('un paciente no entra al editor profesional cambiando la URL', async () => {
  session();
  await mount('/perfil-enfermero');
  assert.equal(window.location.pathname, '/home');
  assert.ok(document.querySelector('nav a[href="/cartilla"]'));
});

test('el enfermero ve pacientes con solicitudes activas en lugar de la lista de profesionales', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  let urlSolicitudes;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/pacientes/solicitudes-activas')) {
      urlSolicitudes = String(url);
      return response({
        pacientes: [{
          id: 91,
          idPaciente: 31,
          nombre: 'Ana',
          apellido: 'Paciente',
          solicitudes_activas: 2,
          latitud: -32.89,
          longitud: -68.84,
        }],
        total_resultados: 1,
        total_paginas: 1,
      });
    }
    return original(url, options);
  };
  try {
    await mount('/cartilla');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.match(urlSolicitudes, /\/api\/pacientes\/solicitudes-activas/);
    assert.match(document.querySelector('h1').textContent, /Tus pacientes/);
    assert.match(document.body.textContent, /Ana Paciente/);
    assert.match(document.body.textContent, /2 solicitudes activas/);
    assert.doesNotMatch(document.body.textContent, /Todos los profesionales|Especialidad/);
    assert.ok(document.querySelector('a[href="/solicitudes-enfermero"]'));
  } finally {
    globalThis.fetch = original;
  }
});

for (const [rol, path] of [
  ['paciente', '/perfil-paciente'],
  ['enfermero', '/perfil-enfermero'],
]) {
  test(`cancelar edición de ${rol} descarta el borrador`, async () => {
    session(rol);
    await mount(path);
    await click(button('Editar'));
    await type(document.querySelector('input[name="nombre"]'), 'Borrador');
    assert.equal(
      document.querySelector('input[name="nombre"]').value,
      'Borrador',
    );
    await click(button('Cancelar'));
    await click(button('Editar'));
    assert.equal(document.querySelector('input[name="nombre"]').value, 'Ana');
  });
}

test('el error de guardado del profesional aparece en pantalla', async () => {
  session('enfermero');
  await mount('/perfil-enfermero');
  await click(button('Editar'));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) =>
      options?.method === 'PUT'
        ? response({ error: 'La matrícula ya está registrada' }, 409)
        : original(url, options);
    await click(button('Guardar'));
    assert.match(
      document.querySelector('[role="alert"]').textContent,
      /matrícula ya está registrada/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('el perfil público excluye horarios pausados y conserva el retorno con filtros', async () => {
  session();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) =>
    String(url).endsWith('/usuarios/1')
      ? response({
          ...profile,
          verificado: true,
          horarios: [
            {
              id: 1,
              dia_semana: 'Lunes',
              estado: 'Disponible',
              hora_inicio: '08:00',
              hora_fin: '12:00',
            },
            {
              id: 2,
              dia_semana: 'Martes',
              estado: 'En Pausa / No disponible',
              hora_inicio: '08:00',
              hora_fin: '12:00',
            },
            {
              id: 3,
              dia_semana: 'Viernes',
              estado: 'Ocupado / Reservado',
              hora_inicio: '08:00',
              hora_fin: '12:00',
            },
          ],
        })
      : original(url, options);
  try {
    await mount('/perfil/1', {
      usr: { volverA: '/cartilla?precio_min=650&page=2&q=Ana' },
    });
    assert.match(document.body.textContent, /Matrícula verificada/);
    const profileHero = document.querySelector('.profile-hero');
    const serviceLink = link('Solicitar servicio');
    assert.equal(serviceLink.parentElement, profileHero);
    assert.equal(profileHero.lastElementChild, serviceLink);
    assert.match(document.body.textContent, /Lunes/);
    assert.doesNotMatch(document.body.textContent, /Martes|Viernes/);
    await click(link('Volver a los profesionales'));
    assert.equal(window.location.search, '?precio_min=650&page=2&q=Ana');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    const request = requests.find((entry) => entry.url.includes('/buscar'));
    assert.ok(request);
    assert.equal(new URL(request.url).searchParams.get('precio_min'), '650');
    assert.equal(new URL(request.url).searchParams.get('page'), '2');
  } finally {
    globalThis.fetch = original;
  }
});

test('el perfil muestra cuando la matrícula todavía no está verificada', async () => {
  session();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) =>
    String(url).endsWith('/usuarios/1')
      ? response({ ...profile, verificado: false })
      : original(url, options);
  try {
    await mount('/perfil/1');
    assert.match(document.body.textContent, /Verificación pendiente/);
    assert.match(document.body.textContent, /Pendiente de verificación/);
  } finally {
    globalThis.fetch = original;
  }
});

for (const [rol, ruta, etiqueta, persona] of [
  ['enfermero', '/perfil-enfermero', 'Ver historial de pacientes', 'Paciente anterior'],
  ['paciente', '/perfil-paciente', 'Ver historial de enfermeros', 'Enfermera anterior'],
]) {
  test(`${rol} puede consultar el historial de servicios desde su perfil`, async () => {
    session(rol);
    const original = globalThis.fetch;
    let historialUrl;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/usuarios/1/historial')) {
        historialUrl = String(url);
        return response([{
          idSolicitud: 45,
          fecha: '2020-02-03',
          hora: '10:30',
          estado: 'Aceptada',
          servicio: { tipoServicio: 'Curaciones' },
          paciente: { nombre: 'Paciente', apellido: 'anterior' },
          enfermero: { nombre: 'Enfermera', apellido: 'anterior' },
        }]);
      }
      return original(url, options);
    };
    try {
      await mount(ruta);
      await click(button(etiqueta));
      assert.equal(historialUrl, 'http://localhost:5000/api/usuarios/1/historial');
      assert.match(document.body.textContent, new RegExp(persona));
      assert.match(document.body.textContent, /Curaciones/);
      assert.match(document.body.textContent, /03\/02\/2020/);
    } finally {
      globalThis.fetch = original;
    }
  });
}

test('cerrar sesión elimina también los datos del usuario', async () => {
  session();
  localStorage.setItem('usuario', '{"nombre":"Ana"}');
  await mount('/home');
  await click(button('Cerrar Sesión'));
  assert.equal(window.location.pathname, '/login');
  assert.equal(localStorage.length, 0);
});

test('el enfermero puede calificar un paciente desde el historial', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  let payload;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/usuarios/1/historial')) {
      return response([{
        idSolicitud: 45,
        fecha: '2020-02-03',
        hora: '10:30',
        estado: 'Aceptada',
        servicio: { tipoServicio: 'Curaciones' },
        paciente: { nombre: 'Paciente', apellido: 'anterior' },
        enfermero: { nombre: 'Enfermera', apellido: 'actual' },
        calificaciones: [],
      }]);
    }
    if (String(url).endsWith('/solicitudes/45/calificaciones')) {
      payload = JSON.parse(options.body);
      return response({
        mensaje: 'Calificación guardada',
        calificacion: {
          idCalificacion: 3,
          idSolicitud: 45,
          idUsuarioAutor: 1,
          idUsuarioCalificado: 2,
          ...payload,
        },
      }, 201);
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-enfermero');
    await click(button('Ver historial de pacientes'));
    await click(button('Calificar paciente'));
    await click(document.querySelector('input[type="radio"][value="4"]'));
    await typeTextArea(document.querySelector('.service-rating-form textarea'), 'Muy buena comunicación.');
    await act(async () => document.querySelector('.service-rating-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    ));
    assert.deepEqual(payload, {
      estrellas: 4,
      comentario: 'Muy buena comunicación.',
    });
    assert.match(document.body.textContent, /Tu calificación:/);
    assert.match(document.body.textContent, /Muy buena comunicación/);
    assert.match(document.body.textContent, /Tu calificación se guardó correctamente/);
  } finally {
    globalThis.fetch = original;
  }
});

test('un perfil con solo nombre puede guardar el teléfono sin exigir apellido', async () => {
  session();
  const original = globalThis.fetch;
  let payload;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') {
      payload = JSON.parse(options.body);
      return response({ ...profile, ...payload });
    }
    return response({ ...profile, apellido: '' });
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Editar datos'));
    assert.equal(document.querySelector('input[name="apellido"]').required, false);
    await type(document.querySelector('input[name="telefono"]'), '2615551234');
    assert.equal(document.querySelector('form').checkValidity(), true);
    await submitForm();
    assert.equal(payload.apellido, '');
    assert.equal(payload.telefono, '2615551234');
    assert.match(document.body.textContent, /Tus cambios se guardaron/);
  } finally { globalThis.fetch = original; }
});

test('el paciente puede habilitar el punto del mapa para el enfermero asignado', async () => {
  session('paciente');
  const original = globalThis.fetch;
  let payload;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/perfil/paciente')) {
      if (options?.method === 'PUT') {
        payload = JSON.parse(options.body);
        return response({ ...profile, id: 9, ...payload });
      }
      return response({
        ...profile,
        id: 9,
        latitud: -32.89,
        longitud: -68.84,
        ubicacion_compartida: false,
      });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Editar datos'));
    const sharing = document.querySelector('.location-sharing input');
    assert.equal(sharing.disabled, false);
    await click(sharing);
    await submitForm();
    assert.equal(payload.latitud, -32.89);
    assert.equal(payload.longitud, -68.84);
    assert.equal(payload.ubicacion_compartida, true);
    assert.match(document.body.textContent, /Con enfermeros que tengan una solicitud activa/);
  } finally {
    globalThis.fetch = original;
  }
});

test('cambiar ciudad descarta el punto anterior antes de guardar', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  let payload;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') {
      payload = JSON.parse(options.body);
      return response({ ...profile, ...payload });
    }
    return String(url).endsWith('/horarios') ? response([]) : response({
      ...profile, ciudad: 'Mendoza', direccion: 'Vieja 123', latitud: -32.89, longitud: -68.84,
    });
  };
  try {
    await mount('/perfil-enfermero');
    await click(button('Editar datos'));
    assert.match(document.body.textContent, /Hay un punto seleccionado/);
    await type(document.querySelector('input[name="ciudad"]'), 'Córdoba');
    assert.match(document.body.textContent, /Sin punto seleccionado/);
    await submitForm();
    assert.equal(payload.ciudad, 'Córdoba');
    assert.equal(payload.latitud, null);
    assert.equal(payload.longitud, null);
  } finally { globalThis.fetch = original; }
});

test('guardar otros datos conserva el punto y permite quitarlo explícitamente', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      return response({ ...profile, ...payload });
    }
    return String(url).endsWith('/horarios') ? response([]) : response({
      ...profile, latitud: -32.89, longitud: -68.84,
    });
  };
  try {
    await mount('/perfil-enfermero');
    await click(button('Editar datos'));
    await type(document.querySelector('input[name="telefono"]'), '1234');
    await submitForm();
    assert.equal(payloads[0].latitud, -32.89);
    assert.equal(payloads[0].longitud, -68.84);
    await click(button('Editar datos'));
    await click(button('Quitar ubicación'));
    await submitForm();
    assert.equal(payloads[1].latitud, null);
    assert.equal(payloads[1].longitud, null);
  } finally { globalThis.fetch = original; }
});

test('la recuperación permite solicitar otro código y cambiar correo sin salir', async () => {
  const original = globalThis.fetch;
  const recoveryRequests = [];
  globalThis.fetch = async (url, options) => {
    recoveryRequests.push({ url: String(url), body: JSON.parse(options.body) });
    return String(url).endsWith('/reset-password')
      ? response({ error: 'Código incorrecto o vencido' }, 400) : response({ mensaje: 'Solicitud procesada' });
  };
  try {
    await mount('/recuperar-password');
    await type(document.querySelector('input[type="email"]'), 'ana@test.local');
    await submitForm();
    assert.equal(document.querySelector('input[type="email"]').readOnly, true);
    await type(document.querySelector('input[autocomplete="one-time-code"]'), '000000');
    await type(document.querySelector('input[type="password"]'), 'nueva');
    await submitForm();
    assert.match(document.body.textContent, /Código incorrecto o vencido/);
    await click(button('Solicitar otro código'));
    assert.equal(document.querySelector('input[autocomplete="one-time-code"]').value, '');
    assert.equal(document.querySelector('input[type="password"]').value, '');
    assert.equal(recoveryRequests.filter((entry) => entry.url.endsWith('/recuperar-password')).length, 2);
    assert.equal(document.querySelector('[role="alert"]'), null);
    await click(button('Cambiar correo'));
    assert.equal(document.querySelector('input[type="email"]').readOnly, false);
    assert.equal(document.querySelector('input[autocomplete="one-time-code"]'), null);
    await type(document.querySelector('input[type="email"]'), 'otro@test.local');
    await submitForm();
    assert.equal(recoveryRequests.at(-1).body.email, 'otro@test.local');
  } finally { globalThis.fetch = original; }
});

test('Mi disponibilidad navega y desplaza a la sección cargada de horarios', async () => {
  session('enfermero');
  const original = window.HTMLElement.prototype.scrollIntoView;
  const scrolled = [];
  window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.id); };
  try {
    await mount('/home');
    await click(link('Mi disponibilidad'));
    assert.equal(window.location.pathname, '/perfil-enfermero');
    assert.equal(window.location.hash, '#horarios');
    assert.ok(scrolled.includes('horarios'));
  } finally { window.HTMLElement.prototype.scrollIntoView = original; }
});

test('permite editar una franja existente y ampliar su horario', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  const schedule = {
    id: 44,
    dia_semana: 'Sábado',
    hora_inicio: '08:00',
    hora_fin: '16:00',
    estado: 'Disponible',
  };
  let update;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/perfil/enfermero/horarios/44')) {
      update = { method: options.method, body: JSON.parse(options.body) };
      return response({
        mensaje: 'Horario guardado con éxito',
        disponibilidad: { ...schedule, hora_fin: '22:00' },
      });
    }
    if (String(url).endsWith('/perfil/enfermero/horarios'))
      return response([schedule]);
    return response(profile);
  };
  try {
    await mount('/perfil-enfermero');
    await click(button('Editar horario de Sábado'));
    assert.equal(document.querySelector('.schedule-form h3').textContent, 'Editar horario');
    assert.equal(document.querySelector('input[name="hora_fin"]').value, '16:00');
    await click(button('Cancelar edición'));
    await click(button('Editar horario de Sábado'));
    await type(document.querySelector('input[name="hora_fin"]'), '22:00');
    await act(async () => document.querySelector('.schedule-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    ));
    assert.deepEqual(update, {
      method: 'PUT',
      body: {
        dia_semana: 'Sábado',
        hora_inicio: '08:00',
        hora_fin: '22:00',
        estado: 'Disponible',
      },
    });
    assert.match(document.body.textContent, /08:00 – 22:00/);
    assert.match(document.body.textContent, /Horario guardado con éxito/);
  } finally { globalThis.fetch = original; }
});

const comprobante = {
  idSolicitud: 15, estado: 'Pendiente', fecha: '2099-12-10', hora: '14:30',
  direccionAtencion: 'San Martín 123', enfermero: { nombre: 'Laura', apellido: 'Gómez' },
  servicio: { idServicio: 301, tipoServicio: 'Curaciones', precioEstimado: '8500.50' },
};
function solicitudesAPI({
  catalogo = [comprobante.servicio],
  crearError = false,
  cancelarError = false,
  solicitudesEnfermero = [],
} = {}) {
  solicitudHandler = async config => {
    assert.match(config.headers.Authorization, /^Bearer /);
    if (config.url === '/usuarios/21') return { data: { id: 21, enfermero_id: 201, nombre: 'Laura', rol: 'enfermero', verificado: true, disponible: true } };
    if (config.url === '/servicios') return { data: catalogo };
    if (config.url === '/solicitudes/enfermero/201') return { data: solicitudesEnfermero };
    if (config.url === '/solicitudes/15/aceptar') return {
      data: { mensaje: 'Solicitud aceptada', solicitud: { ...comprobante, estado: 'Aceptada' } },
    };
    if (config.url === '/solicitudes/16/rechazar') return {
      data: { mensaje: 'Solicitud rechazada', solicitud: { ...comprobante, idSolicitud: 16, estado: 'Rechazada' } },
    };
    if (config.url === '/solicitudes' && config.method === 'post') return crearError
      ? { status: 409, data: { error: 'Ese horario ya tiene una solicitud activa.' } }
      : { status: 201, data: { mensaje: 'Solicitud creada', solicitud: comprobante } };
    if (config.url === '/solicitudes/15') return { data: comprobante };
    if (config.url === '/solicitudes/15/cancelar') return cancelarError
      ? { status: 409, data: { error: 'No se puede cancelar este turno.' } }
      : { data: { mensaje: 'Solicitud cancelada', solicitud: { ...comprobante, estado: 'Cancelada' } } };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
}
async function completarSolicitud(direccion = 'San Martín 123') {
  const select = document.querySelector('select[name="idServicio"]');
  await act(async () => {
    select.value = '301';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await type(document.querySelector('input[name="fecha"]'), '2099-12-10');
  await type(document.querySelector('input[name="hora"]'), '14:30');
  await type(document.querySelector('input[name="direccionAtencion"]'), direccion);
}

test('la solicitud muestra confirmación verde y permite abrir el comprobante', async () => {
  session();
  solicitudesAPI();
  await mount('/perfil/21/solicitar');
  assert.ok(solicitudRequests.some(r => r.url === '/servicios'));
  assert.equal(document.querySelector('select[name="idServicio"]').disabled, false);
  assert.equal(document.querySelector('input[name="direccionAtencion"]').maxLength, 200);
  await completarSolicitud();
  await submitForm();
  const posts = solicitudRequests.filter(r => r.method === 'post');
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].data), {
    idServicio: 301, idEnfermero: 201, fecha: '2099-12-10', hora: '14:30', direccionAtencion: 'San Martín 123',
  });
  assert.equal(window.location.pathname, '/perfil/21/solicitar');
  assert.match(document.querySelector('.solicitud-success strong').textContent, /¡Solicitud creada!/);
  assert.match(document.querySelector('.solicitud-success').getAttribute('class'), /notice-success/);
  await click(link('Ver comprobante'));
  assert.equal(window.location.pathname, '/solicitudes/15');
  assert.match(document.body.textContent, /Comprobante de solicitud/);
  assert.match(document.body.textContent, /Laura Gómez/);
  assert.match(document.body.textContent, /Pendiente/);
  assert.ok(solicitudRequests.some(r => r.url === '/solicitudes/15' && r.method === 'get'));
});

test('los servicios sin tarifa aparecen como A consultar en el selector', async () => {
  session();
  solicitudesAPI({
    catalogo: [{
      idServicio: 302,
      tipoServicio: 'Cuidados Intensivos',
      precioEstimado: null,
    }],
  });
  await mount('/perfil/21/solicitar');
  assert.match(
    document.querySelector('select[name="idServicio"]').textContent,
    /Cuidados Intensivos · A consultar/,
  );
});

test('el enfermero accede arriba a la derecha y acepta o rechaza pedidos pendientes', async () => {
  session('enfermero');
  solicitudesAPI({
    solicitudesEnfermero: [
      { ...comprobante, paciente: { nombre: 'Ana', apellido: 'Prueba' } },
      { ...comprobante, idSolicitud: 16, paciente: { nombre: 'Mario', apellido: 'López' } },
    ],
  });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return String(url).endsWith('/perfil/enfermero')
      ? response({ ...profile, idEnfermero: 201 })
      : response(profile);
  };
  try {
    await mount('/home');
    assert.ok(link('Solicitudes'));
    await click(link('Solicitudes'));
    assert.equal(window.location.pathname, '/solicitudes-enfermero');
    assert.match(document.body.textContent, /Ana Prueba/);
    assert.match(document.body.textContent, /Mario López/);
    await click(button('Aceptar solicitud'));
    assert.match(document.body.textContent, /Solicitud aceptada/);
    assert.match(document.body.textContent, /Aceptada/);
    await click(button('Rechazar'));
    assert.equal(document.querySelector('dialog').open, true);
    await click(button('Sí, rechazar'));
    assert.match(document.body.textContent, /Solicitud rechazada/);
    assert.equal(solicitudRequests.filter(r => r.method === 'put').length, 2);
  } finally { globalThis.fetch = original; }
});

test('catálogo vacío bloquea el envío', async () => {
  session(); solicitudesAPI({ catalogo: [] });
  await mount('/perfil/21/solicitar');
  assert.equal(document.querySelector('select[name="idServicio"]').disabled, true);
  assert.match(document.body.textContent, /no hay tipos de servicio cargados/);
  assert.equal(button('Enviar solicitud').disabled, true);
  await submitForm();
  assert.equal(solicitudRequests.some(r => r.method === 'post'), false);
});

test('dirección mayor a 200 no se envía aunque se fuerce el formulario', async () => {
  session(); solicitudesAPI(); await mount('/perfil/21/solicitar');
  await completarSolicitud('a'.repeat(201)); await submitForm();
  assert.match(document.querySelector('[role="alert"]').textContent, /200/);
  assert.equal(solicitudRequests.some(r => r.method === 'post'), false);
});

test('creación rechazada mantiene el formulario y permite reintentar', async () => {
  session(); solicitudesAPI({ crearError: true }); await mount('/perfil/21/solicitar');
  await completarSolicitud(); await submitForm();
  assert.equal(window.location.pathname, '/perfil/21/solicitar');
  assert.match(document.querySelector('[role="alert"]').textContent, /horario/);
  assert.equal(button('Enviar solicitud').disabled, false);
});

test('cancelación requiere confirmar y actualiza el comprobante tras el PUT', async () => {
  session(); solicitudesAPI(); await mount('/solicitudes/15');
  await click(button('Cancelar solicitud'));
  assert.equal(document.querySelector('dialog').open, true);
  await click(button('Conservar solicitud'));
  assert.equal(solicitudRequests.some(r => r.method === 'put'), false);
  await click(button('Cancelar solicitud'));
  await click(button('Sí, cancelar'));
  assert.equal(solicitudRequests.filter(r => r.method === 'put').length, 1);
  assert.match(document.body.textContent, /Estado: Cancelada/);
  assert.equal(document.querySelector('dialog'), null);
});

test('cancelación rechazada conserva estado y muestra el error', async () => {
  session(); solicitudesAPI({ cancelarError: true }); await mount('/solicitudes/15');
  await click(button('Cancelar solicitud')); await click(button('Sí, cancelar'));
  assert.match(document.body.textContent, /Estado: Pendiente/);
  assert.match(document.querySelector('dialog [role="alert"]').textContent, /No se puede cancelar/);
  assert.equal(document.querySelector('dialog').open, true);
  assert.equal(button('Sí, cancelar').disabled, false);
});
