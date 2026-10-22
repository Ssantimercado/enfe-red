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
  if (String(url).includes('/admin/metricas')) {
    return response({
      total_usuarios: 12,
      pacientes: 8,
      enfermeros: 4,
      usuarios_suspendidos: 1,
      matriculas_pendientes: 2,
      total_solicitudes: 15,
    });
  }
  if (String(url).includes('/admin/usuarios')) {
    return response({ usuarios: [], total_resultados: 0, total_paginas: 0 });
  }
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

// Ley 25.326: consentimiento expreso al registrarse, páginas legales y aviso de almacenamiento.
test('el registro exige aceptar términos y privacidad y envía la aceptación', async () => {
  await mount('/registro');
  await type(document.querySelector('input[name="nombre"]'), 'Ana Pérez');
  await type(document.querySelector('input[name="email"]'), 'ana@test.local');
  await type(document.querySelector('input[name="password"]'), 'clave-segura');
  const casilla = document.querySelector('input[name="aceptaTerminos"]');
  assert.equal(casilla.required, true);
  assert.ok(document.querySelector('.consentimiento a[href="/terminos"]'));
  assert.ok(document.querySelector('.consentimiento a[href="/privacidad"]'));
  assert.match(document.querySelector('.consentimiento').textContent, /datos de salud/);
  await submitForm();
  assert.match(document.querySelector('[role="alert"]').textContent, /Términos y condiciones/);
  assert.equal(requests.some((r) => r.url.endsWith('/registro')), false);
  await click(casilla);
  await submitForm();
  const registro = requests.find((r) => r.url.endsWith('/registro'));
  assert.equal(JSON.parse(registro.options.body).aceptaTerminos, true);
});

test('las páginas legales son públicas e incluyen las leyendas de la Ley 25.326', async () => {
  await mount('/privacidad');
  assert.match(document.querySelector('h1').textContent, /Política de privacidad/);
  assert.match(document.body.textContent, /AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA/);
  assert.match(document.body.textContent, /artículo 14, inciso 3/);
  assert.match(document.body.textContent, /no usa cookies publicitarias/);
  await click(link('Términos y condiciones'));
  assert.equal(window.location.pathname, '/terminos');
  assert.match(document.body.textContent, /no es un servicio de emergencias/);
});

test('el aviso de cookies se cierra y no vuelve a aparecer', async () => {
  await mount('/');
  assert.ok(document.querySelector('.aviso-cookies'));
  await click(button('Entendido'));
  assert.equal(document.querySelector('.aviso-cookies'), null);
  await act(async () => root.unmount());
  root = null;
  await mount('/');
  assert.equal(document.querySelector('.aviso-cookies'), null);
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

test('el administrador entra al panel y carga las métricas', async () => {
  session('administrador');
  await mount('/admin');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  assert.match(document.querySelector('h1').textContent, /Panel de administración/);
  assert.match(document.body.textContent, /12/);
  assert.match(document.body.textContent, /Matrículas pendientes/);
  assert.ok(document.querySelector('a[href="/admin/usuarios"]'));
  assert.ok(requests.some((entry) => entry.url.includes('/api/admin/metricas')));
});

test('paciente y enfermero no pueden entrar a las vistas administrativas', async () => {
  session('enfermero');
  await mount('/admin');
  assert.equal(window.location.pathname, '/home');
  assert.doesNotMatch(document.body.textContent, /Panel de administración/);
});

test('el administrador puede suspender y reactivar cuentas desde la lista', async () => {
  session('administrador');
  const original = globalThis.fetch;
  let suspendido = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/admin/usuarios/') && options.method === 'PUT') {
      suspendido = JSON.parse(options.body).suspendido;
      return response({
        usuario: {
          id: 2,
          nombre: 'Ana',
          apellido: 'Paciente',
          email: 'ana@test.local',
          rol: 'paciente',
          suspendido,
        },
      });
    }
    return response({
      usuarios: [{
        id: 2,
        nombre: 'Ana',
        apellido: 'Paciente',
        email: 'ana@test.local',
        rol: 'paciente',
        suspendido,
      }],
      total_resultados: 1,
      total_paginas: 1,
    });
  };
  try {
    await mount('/admin/usuarios');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.match(document.body.textContent, /Ana Paciente/);
    await click(button('Suspender'));
    assert.match(document.querySelector('dialog').textContent, /perderá el acceso/);
    await click(button('Cancelar'));
    assert.equal(suspendido, false);
    await click(button('Suspender'));
    await click(button('Sí, suspender'));
    assert.equal(suspendido, true);
    assert.match(document.body.textContent, /Reactivar/);
    assert.match(document.body.textContent, /Ana Paciente suspendido/);
    await click(button('Reactivar'));
    await click(button('Sí, reactivar'));
    assert.equal(suspendido, false);
    assert.match(document.body.textContent, /Ana Paciente reactivado/);
  } finally {
    globalThis.fetch = original;
  }
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

test('el enfermero ve pacientes que enviaron solicitudes en lugar de la lista de profesionales', async () => {
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
          solicitudes: 2,
          solicitudes_activas: 0,
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
    assert.match(document.body.textContent, /2 solicitudes enviadas/);
    assert.doesNotMatch(document.body.textContent, /Todos los profesionales|Especialidad/);
    assert.ok(document.querySelector('a[href="/solicitudes-enfermero"]'));
  } finally {
    globalThis.fetch = original;
  }
});

test('la cartilla filtra profesionales por un rango horario', async () => {
  session();
  await mount('/cartilla');
  assert.doesNotMatch(document.body.textContent, /Solo disponibles|No disponibles/);
  const desde = document.querySelector('input[aria-label="Horario desde"]');
  const hasta = document.querySelector('input[aria-label="Horario hasta"]');
  assert.ok(desde);
  assert.ok(hasta);
  await type(desde, '08:00');
  assert.match(document.querySelector('[role="alert"]').textContent, /Completá las horas/);
  await type(hasta, '16:00');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
  const search = requests
    .filter((entry) => entry.url.includes('/buscar'))
    .at(-1);
  assert.ok(search);
  assert.equal(new URL(search.url).searchParams.get('hora_desde'), '08:00');
  assert.equal(new URL(search.url).searchParams.get('hora_hasta'), '16:00');
});

test('las tarjetas de la cartilla muestran el promedio y la cantidad de reseñas', async () => {
  session();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => (String(url).includes('/buscar')
    ? response({
      enfermeros: [
        { ...profile, id: 1, usuario_id: 1, especialidad: 'Pediatría', disponible: true, puntuacion: 4.5, cantidadResenas: 2 },
        { ...profile, id: 2, usuario_id: 2, nombre: 'Nora', especialidad: 'General', disponible: true, puntuacion: null, cantidadResenas: 0 },
      ],
      total_resultados: 2,
      total_paginas: 1,
    })
    : original(url, options));
  try {
    await mount('/cartilla');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
    const cards = document.querySelectorAll('.professional-card');
    assert.equal(cards.length, 2);
    assert.match(cards[0].textContent, /4,5 \(2 reseñas\)/);
    assert.doesNotMatch(cards[1].textContent, /reseña/);
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

test('el enfermero ve la reseña del paciente pero no califica al paciente (Reseña 0..1)', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, options = {}) => {
    llamadas.push(String(url));
    if (String(url).endsWith('/usuarios/1/historial')) {
      return response([
        {
          idSolicitud: 45, fecha: '2020-02-03', hora: '10:30', estado: 'Realizada',
          servicio: { tipoServicio: 'Curaciones' }, paciente: { nombre: 'Paciente', apellido: 'anterior' },
          calificaciones: [{ idCalificacion: 3, idSolicitud: 45, idUsuarioAutor: 7, estrellas: 4, comentario: 'Muy amable.' }],
        },
        {
          idSolicitud: 46, fecha: '2020-02-01', hora: '09:00', estado: 'Realizada',
          servicio: { tipoServicio: 'Inyecciones' }, paciente: { nombre: 'Otro' }, calificaciones: [],
        },
      ]);
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-enfermero');
    await click(button('Ver historial de pacientes'));
    assert.match(document.body.textContent, /Reseña del paciente:/);
    assert.match(document.body.textContent, /Muy amable\./);
    assert.match(document.body.textContent, /El paciente todavía no dejó una reseña/);
    assert.equal([...document.querySelectorAll('button')].some((b) => /Calificar/.test(b.textContent)), false);
    assert.equal(llamadas.some((u) => u.includes('/calificaciones')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('el paciente publica la reseña del enfermero en POST /resenas', async () => {
  session('paciente');
  const original = globalThis.fetch;
  let resenaUrl;
  let payload;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/usuarios/1/historial')) {
      return response([{
        idSolicitud: 48, fecha: '2020-02-03', hora: '10:30', estado: 'Realizada',
        servicio: { tipoServicio: 'Curaciones' }, enfermero: { nombre: 'Laura', apellido: 'Gómez' }, calificaciones: [],
      }]);
    }
    if (String(url).endsWith('/resenas') && options.method === 'POST') {
      resenaUrl = String(url);
      payload = JSON.parse(options.body);
      return response({
        mensaje: 'Reseña publicada',
        resena: { idResena: 12, idSolicitud: 48, puntuacion: 5, comentario: payload.comentario, fecha: '2026-10-21T12:00:00Z', paciente: 'Ana P.' },
        calificacionPromedio: 5,
        cantidadResenas: 1,
      }, 201);
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Ver historial'));
    await click(button('Calificar enfermero'));
    const modal = document.querySelector('dialog.rating-dialog');
    assert.match(modal.textContent, /Laura Gómez · Curaciones/);
    await click(modal.querySelector('input[type="radio"][value="5"]'));
    await typeTextArea(modal.querySelector('textarea'), 'Muy puntual.');
    await act(async () => modal.querySelector('form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    ));
    assert.equal(resenaUrl, 'http://localhost:5000/api/resenas');
    assert.deepEqual(payload, { idSolicitud: 48, puntuacion: 5, comentario: 'Muy puntual.' });
    assert.equal(requests.some((entry) => entry.url.includes('/calificaciones')), false);
    assert.equal(document.querySelector('dialog.rating-dialog'), null);
    assert.match(document.body.textContent, /Tu calificación:/);
    assert.match(document.body.textContent, /Muy puntual\./);
    assert.equal([...document.querySelectorAll('button')].some((b) => /Calificar/.test(b.textContent)), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('el modal de calificación se cierra sin enviar y vuelve a abrirse vacío', async () => {
  session('paciente');
  const original = globalThis.fetch;
  let enviada = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/usuarios/1/historial')) {
      return response([{
        idSolicitud: 47, fecha: '2020-02-03', hora: '10:30', estado: 'Realizada',
        servicio: { tipoServicio: 'Curaciones' }, enfermero: { nombre: 'Laura' }, calificaciones: [],
      }]);
    }
    if (String(url).includes('/calificaciones')) enviada = true;
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Ver historial'));
    await click(button('Calificar enfermero'));
    let modal = document.querySelector('dialog.rating-dialog');
    assert.equal(modal.open, true);
    const enviar = [...modal.querySelectorAll('button')].find((b) => b.type === 'submit');
    assert.equal(enviar.disabled, true);
    await click(modal.querySelector('input[type="radio"][value="2"]'));
    await typeTextArea(modal.querySelector('textarea'), 'Borrador');
    assert.equal(enviar.disabled, false);
    await act(async () => modal.dispatchEvent(new window.Event('cancel', { cancelable: true })));
    assert.equal(document.querySelector('dialog.rating-dialog'), null);
    await click(button('Calificar enfermero'));
    modal = document.querySelector('dialog.rating-dialog');
    assert.equal(modal.querySelector('textarea').value, '');
    assert.equal(modal.querySelector('input[type="radio"]:checked'), null);
    await click(button('Cancelar'));
    assert.equal(document.querySelector('dialog.rating-dialog'), null);
    assert.equal(enviada, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('el perfil público muestra las reseñas y el promedio del profesional', async () => {
  session();
  const original = globalThis.fetch;
  let resenasUrl;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/usuarios/1')) {
      return response({ ...profile, enfermero_id: 7, verificado: true, disponible: true });
    }
    if (String(url).endsWith('/enfermeros/7/resenas')) {
      resenasUrl = String(url);
      return response({
        idEnfermero: 7,
        calificacionPromedio: 4.5,
        cantidadResenas: 2,
        resenas: [
          { idResena: 9, idSolicitud: 3, puntuacion: 5, comentario: 'Muy puntual.', fecha: '2026-10-20T12:00:00Z', paciente: 'Juan P.' },
          { idResena: 8, idSolicitud: 2, puntuacion: 4, comentario: 'Muy amable.', fecha: null, paciente: 'Marta G.' },
        ],
      });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil/1');
    assert.equal(resenasUrl, 'http://localhost:5000/api/enfermeros/7/resenas');
    const panel = document.querySelector('.profile-reviews');
    assert.match(panel.textContent, /Reseñas de pacientes/);
    assert.match(panel.textContent, /4,5/);
    assert.match(panel.textContent, /2 reseñas/);
    assert.match(panel.textContent, /Juan P\..*Muy puntual\./);
    assert.match(panel.textContent, /Marta G\..*Muy amable\./);
    assert.equal(panel.querySelectorAll('li').length, 2);
    assert.ok(panel.querySelector('[aria-label="5,0 de 5 estrellas"]'));
  } finally {
    globalThis.fetch = original;
  }
});

test('las reseñas del perfil muestran el vacío y permiten reintentar tras un error', async () => {
  session();
  const original = globalThis.fetch;
  let intentos = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/usuarios/1')) return response({ ...profile, enfermero_id: 7 });
    if (String(url).endsWith('/enfermeros/7/resenas')) {
      intentos += 1;
      return intentos === 1
        ? response({ error: 'Enfermero no encontrado' }, 404)
        : response({ idEnfermero: 7, calificacionPromedio: null, cantidadResenas: 0, resenas: [] });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil/1');
    const panel = () => document.querySelector('.profile-reviews');
    assert.match(panel().textContent, /Enfermero no encontrado/);
    await click(button('Reintentar'));
    assert.equal(intentos, 2);
    assert.match(panel().textContent, /Todavía no tiene reseñas/);
    assert.equal(panel().querySelector('[role="alert"]'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('un perfil sin ID profesional no consulta reseñas', async () => {
  session();
  await mount('/perfil/1');
  assert.equal(document.querySelector('.profile-reviews'), null);
  assert.equal(requests.some((entry) => entry.url.includes('/resenas')), false);
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
  assert.equal(document.querySelector('input[name="fecha"]').lang, 'es-AR');
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

test('el historial filtra por fecha y estado y permite limpiar los filtros', async () => {
  session('paciente');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/usuarios/1/historial')) {
      return response([
        { idSolicitud: 3, fecha: '2026-09-20', hora: '10:00', estado: 'Realizada', servicio: { tipoServicio: 'Curaciones' }, enfermero: { nombre: 'Lucia', apellido: 'Gomez' } },
        { idSolicitud: 2, fecha: '2026-08-10', hora: '09:00', estado: 'Cancelada', servicio: { tipoServicio: 'Inyectables' }, enfermero: { nombre: 'Marta', apellido: 'Diaz' } },
        { idSolicitud: 1, fecha: '2026-07-01', hora: '08:00', estado: 'Realizada', servicio: { tipoServicio: 'Control' }, enfermero: { nombre: 'Juan', apellido: 'Sosa' } },
      ]);
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Ver historial de enfermeros'));
    const estado = document.querySelector('#historial-estado');
    assert.deepEqual([...estado.options].map((option) => option.value), ['', 'Cancelada', 'Realizada']);
    await act(async () => {
      estado.value = 'Realizada';
      estado.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.match(document.body.textContent, /2 de 3 servicios/);
    assert.doesNotMatch(document.body.textContent, /Marta/);
    await type(document.querySelector('[aria-label="Fecha desde"]'), '2026-09-01');
    assert.match(document.body.textContent, /1 de 3 servicios/);
    assert.match(document.body.textContent, /Lucia/);
    assert.doesNotMatch(document.body.textContent, /Juan/);
    await type(document.querySelector('[aria-label="Fecha hasta"]'), '2026-08-01');
    assert.match(document.body.textContent, /no puede ser posterior/);
    await type(document.querySelector('[aria-label="Fecha desde"]'), '2026-10-01');
    await type(document.querySelector('[aria-label="Fecha hasta"]'), '2026-10-05');
    assert.match(document.body.textContent, /Ningún servicio coincide/);
    await click(button('Limpiar filtros'));
    assert.match(document.body.textContent, /3 servicios/);
    assert.match(document.body.textContent, /Marta/);
  } finally {
    globalThis.fetch = original;
  }
});

test('la campana no aparece mientras no exista el endpoint de notificaciones', async () => {
  session('paciente');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/notificaciones/')) return response({ error: 'Not Found' }, 404);
    return original(url, options);
  };
  try {
    await mount('/home');
    assert.equal(document.querySelector('.notification-trigger'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('la campana cuenta las no leídas y marca una como leída con el PUT', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/notificaciones/1')) {
      llamadas.push(['GET', ruta]);
      return response([
        { idNotificacion: 7, mensaje: 'Aceptaron tu turno', leida: false, fechaHora: '2026-10-18T13:00:00Z' },
        { idNotificacion: 8, mensaje: 'Tenés un mensaje nuevo', leida: false, fechaHora: '2026-10-18T14:00:00Z' },
        { idNotificacion: 6, mensaje: 'Turno rechazado', leida: true, fechaHora: '2026-10-17T10:00:00Z' },
      ]);
    }
    if (ruta.endsWith('/notificaciones/7/leer')) {
      llamadas.push([options.method, ruta, options.headers?.Authorization]);
      return response({ mensaje: 'Notificación leída' });
    }
    return original(url, options);
  };
  try {
    await mount('/home');
    const campana = button('Notificaciones');
    assert.equal(campana.getAttribute('aria-label'), 'Notificaciones, 2 sin leer');
    assert.equal(document.querySelector('.notification-count').textContent, '2');
    await click(campana);
    assert.equal(campana.getAttribute('aria-expanded'), 'true');
    assert.match(document.body.textContent, /Turno rechazado/);
    await click(button('Aceptaron tu turno'));
    assert.deepEqual(llamadas.at(-1), [
      'PUT',
      'http://localhost:5000/api/notificaciones/7/leer',
      `Bearer ${localStorage.getItem('token')}`,
    ]);
    assert.equal(document.querySelector('.notification-count').textContent, '1');
    assert.equal(campana.getAttribute('aria-label'), 'Notificaciones, 1 sin leer');
    await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })));
    assert.equal(document.querySelector('.notification-panel'), null);
  } finally {
    globalThis.fetch = original;
  }
});

// SCRUM-63 (Santiago): chat asociado al servicio con polling cada 3 segundos.
async function conChat(mensajesServidor, prueba, { estado = 'Aceptada', envio, estadoServidor, errorGet } = {}) {
  solicitudHandler = async config => {
    if (config.url === '/solicitudes/15') return { data: { ...comprobante, estado } };
    if (config.url === '/solicitudes/enfermero/201') return {
      data: [{ ...comprobante, estado, paciente: { nombre: 'Ana', apellido: 'Prueba' } }],
    };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;
  const intervalos = new Map();
  const chat = [];
  // JSDOM informa la pestaña como oculta; el chat pausa el polling en ese caso.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.setInterval = (callback, ms) => {
    const id = intervalos.size + 1;
    intervalos.set(id, { callback, ms });
    return id;
  };
  window.clearInterval = id => intervalos.delete(id);
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/perfil/enfermero')) return response({ ...profile, idEnfermero: 201 });
    if (ruta.endsWith('/api/solicitudes/15')) {
      chat.push({ method: 'GET', ruta: 'solicitud' });
      return response({ ...comprobante, estado: estadoServidor || estado });
    }
    if (!ruta.endsWith('/solicitudes/15/mensajes')) return original(url, options);
    chat.push({ method: options.method || 'GET', body: options.body });
    if (options.method === 'POST') return envio ? envio(JSON.parse(options.body)) : response({}, 500);
    if (errorGet) return response({ error: 'No tenés acceso a los mensajes de esta solicitud' }, errorGet);
    return response(mensajesServidor());
  };
  const poll = async () => {
    for (const { callback } of intervalos.values()) await act(async () => callback());
  };
  try {
    await prueba({ chat, intervalos, poll });
  } finally {
    globalThis.fetch = original;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    delete document.hidden;
  }
}

const mensajeChat = (idMensaje, idEmisor, contenido) => ({
  idMensaje, idSolicitud: 15, idEmisor, contenido, fechaHora: '2026-10-15T20:30:00.000000Z',
});

test('el paciente chatea en una solicitud aceptada y el polling no duplica mensajes', async () => {
  session();
  let servidor = [mensajeChat(1, 21, 'Hola, llego a las 14:30.')];
  await conChat(() => servidor, async ({ chat, intervalos, poll }) => {
    await mount('/solicitudes/15');
    assert.match(document.body.textContent, /Mensajes del servicio/);
    assert.match(document.body.textContent, /con Laura Gómez/);
    assert.equal(document.querySelectorAll('.chat-mensaje.recibido').length, 1);
    assert.equal([...intervalos.values()][0].ms, 3000);

    await typeTextArea(document.querySelector('.chat-formulario textarea'), '  Perfecto, te espero.  ');
    await submitForm();
    const post = chat.find(llamada => llamada.method === 'POST');
    assert.deepEqual(JSON.parse(post.body), { contenido: 'Perfecto, te espero.' });
    assert.equal(document.querySelector('.chat-formulario textarea').value, '');
    assert.equal(document.querySelectorAll('.chat-mensaje.propio').length, 1);

    // El polling trae el mismo mensaje propio más uno nuevo: no se duplica.
    servidor = [...servidor, mensajeChat(2, 1, 'Perfecto, te espero.'), mensajeChat(3, 21, 'Gracias.')];
    await poll();
    assert.equal(document.querySelectorAll('.chat-mensaje').length, 3);
    assert.match(document.querySelector('.chat-mensajes').lastElementChild.textContent, /Gracias\./);
  }, { envio: datos => response(mensajeChat(2, 1, datos.contenido), 201) });
});

test('un envío rechazado conserva el texto y muestra el error del servidor', async () => {
  session();
  await conChat(() => [], async () => {
    await mount('/solicitudes/15');
    assert.match(document.body.textContent, /Todavía no hay mensajes/);
    await typeTextArea(document.querySelector('.chat-formulario textarea'), 'Hola');
    await submitForm();
    assert.match(document.querySelector('.chat-formulario [role="alert"]').textContent, /Aceptada/);
    assert.equal(document.querySelector('.chat-formulario textarea').value, 'Hola');
  }, {
    envio: () => response({ error: 'Solo podés enviar mensajes cuando la solicitud está Aceptada' }, 409),
  });
});

test('si la solicitud se canceló mientras chateaba, el 409 cierra el chat y actualiza el comprobante', async () => {
  session();
  await conChat(() => [], async ({ chat, intervalos }) => {
    await mount('/solicitudes/15');
    assert.equal(intervalos.size, 1);
    await typeTextArea(document.querySelector('.chat-formulario textarea'), '¿Seguís viniendo?');
    await submitForm();
    assert.ok(chat.some(llamada => llamada.ruta === 'solicitud'));
    assert.equal(document.querySelector('.chat-formulario'), null);
    assert.match(document.querySelector('.chat-servicio [role="alert"]').textContent, /pasó a Cancelada/);
    assert.match(document.body.textContent, /La conversación quedó cerrada/);
    assert.match(document.body.textContent, /Estado: Cancelada/);
    assert.equal(intervalos.size, 0);
  }, {
    estadoServidor: 'Cancelada',
    envio: () => response({ error: 'Solo podés enviar mensajes cuando la solicitud está Aceptada' }, 409),
  });
});

test('un 403 al leer mensajes detiene el polling y muestra el error', async () => {
  session();
  await conChat(() => [], async ({ chat, intervalos, poll }) => {
    await mount('/solicitudes/15');
    assert.match(document.querySelector('.chat-servicio [role="alert"]').textContent, /No tenés acceso/);
    assert.equal(intervalos.size, 0);
    await poll();
    assert.equal(chat.filter(llamada => llamada.method === 'GET' && !llamada.ruta).length, 1);
    assert.equal(document.querySelector('.chat-formulario'), null);
  }, { errorGet: 403 });
});

test('el campo conserva el foco al enviar y Enter no envía mientras se compone un acento', async () => {
  session();
  await conChat(() => [], async ({ chat }) => {
    await mount('/solicitudes/15');
    const campo = document.querySelector('.chat-formulario textarea');
    assert.equal(campo.disabled, false);
    await typeTextArea(campo, 'Hola');
    const enter = (isComposing) => act(async () => {
      const evento = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      Object.defineProperty(evento, 'isComposing', { value: isComposing });
      campo.dispatchEvent(evento);
    });
    await enter(true);
    assert.equal(chat.some(llamada => llamada.method === 'POST'), false);
    await enter(false);
    assert.equal(chat.filter(llamada => llamada.method === 'POST').length, 1);
    assert.equal(document.activeElement, document.querySelector('.chat-formulario textarea'));
  }, { envio: datos => response(mensajeChat(9, 1, datos.contenido), 201) });
});

test('una solicitud realizada muestra el chat solo para leer y sin polling', async () => {
  session();
  await conChat(() => [mensajeChat(1, 1, 'Gracias por la atención.')], async ({ intervalos }) => {
    await mount('/solicitudes/15');
    assert.match(document.body.textContent, /La conversación quedó cerrada/);
    assert.equal(document.querySelectorAll('.chat-mensaje.propio').length, 1);
    assert.equal(document.querySelector('.chat-formulario'), null);
    assert.equal(intervalos.size, 0);
  }, { estado: 'Realizada' });
});

test('un pedido pendiente todavía no muestra el chat', async () => {
  session();
  await conChat(() => [], async ({ chat }) => {
    await mount('/solicitudes/15');
    assert.match(document.body.textContent, /Comprobante de solicitud/);
    assert.equal(document.querySelector('.chat-servicio'), null);
    assert.equal(chat.length, 0);
  }, { estado: 'Pendiente' });
});

test('el enfermero abre los mensajes de una solicitud aceptada y el polling se detiene al cerrarlos', async () => {
  session('enfermero');
  await conChat(() => [mensajeChat(1, 1, '¿Tocás el timbre del 2B?')], async ({ chat, intervalos }) => {
    await mount('/solicitudes-enfermero');
    assert.equal(document.querySelector('.chat-servicio'), null);
    await click(button('Ver mensajes'));
    assert.equal(button('Ocultar mensajes').getAttribute('aria-expanded'), 'true');
    assert.match(document.body.textContent, /con Ana Prueba/);
    assert.match(document.querySelector('.chat-mensajes').textContent, /timbre del 2B/);
    assert.equal(chat.filter(llamada => llamada.method === 'GET').length, 1);
    assert.equal(intervalos.size, 1);
    await click(button('Ocultar mensajes'));
    assert.equal(document.querySelector('.chat-servicio'), null);
    assert.equal(intervalos.size, 0);
  });
});

// SCRUM-59.3 y HU11: marcar como realizado habilita la calificación.
test('el enfermero marca como realizado un turno pasado y no uno futuro', async () => {
  session('enfermero');
  const pasada = { ...comprobante, idSolicitud: 21, estado: 'Aceptada', fecha: '2020-05-04', paciente: { nombre: 'Ana' } };
  const futura = { ...comprobante, idSolicitud: 22, estado: 'Aceptada', fecha: '2099-05-04', paciente: { nombre: 'Mario' } };
  solicitudHandler = async config => {
    if (config.url === '/solicitudes/enfermero/201') return { data: [pasada, futura] };
    if (config.url === '/solicitudes/21/finalizar' && config.method === 'put') {
      return { data: { mensaje: 'Servicio marcado como realizado', solicitud: { ...pasada, estado: 'Realizada' } } };
    }
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).endsWith('/perfil/enfermero')
    ? response({ ...profile, idEnfermero: 201 })
    : original(url, options));
  try {
    await mount('/solicitudes-enfermero');
    const botones = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Marcar como realizado');
    assert.equal(botones.length, 1);
    assert.match(document.body.textContent, /después del turno/);
    await click(botones[0]);
    assert.ok(solicitudRequests.some(r => r.url === '/solicitudes/21/finalizar' && r.method === 'put'));
    assert.match(document.body.textContent, /Servicio marcado como realizado/);
    assert.match(document.querySelectorAll('.solicitud-card')[0].textContent, /Realizada/);
    assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Marcar como realizado'), false);
  } finally { globalThis.fetch = original; }
});

test('el historial muestra solicitudes cerradas y solo ofrece calificar las realizadas', async () => {
  session('paciente');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).endsWith('/usuarios/1/historial')
    ? response([
      { idSolicitud: 46, fecha: '2020-02-03', hora: '10:30', estado: 'Rechazada',
        servicio: { tipoServicio: 'Curaciones' }, enfermero: { nombre: 'Laura' }, calificaciones: [] },
      { idSolicitud: 47, fecha: '2020-02-02', hora: '10:30', estado: 'Cancelada',
        servicio: { tipoServicio: 'Curaciones' }, enfermero: { nombre: 'Laura' }, calificaciones: [] },
      { idSolicitud: 48, fecha: '2020-02-01', hora: '10:30', estado: 'Realizada',
        servicio: { tipoServicio: 'Curaciones' }, enfermero: { nombre: 'Laura' }, calificaciones: [] },
    ])
    : original(url, options));
  try {
    await mount('/perfil-paciente');
    await click(button('Ver historial'));
    assert.match(document.body.textContent, /realizados, rechazados o cancelados/);
    const botones = [...document.querySelectorAll('button')].filter((b) => /Calificar enfermero/.test(b.textContent));
    assert.equal(botones.length, 1);
  } finally { globalThis.fetch = original; }
});

test('el enfermero asignado abre el comprobante con los datos del paciente', async () => {
  session('enfermero');
  solicitudHandler = async config => {
    if (config.url === '/solicitudes/15') return { data: { ...comprobante, paciente: { nombre: 'Ana', apellido: 'Prueba' } } };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  await mount('/solicitudes/15');
  assert.equal(window.location.pathname, '/solicitudes/15');
  assert.match(document.body.textContent, /Comprobante de solicitud/);
  assert.match(document.querySelector('.solicitud-summary').textContent, /PacienteAna Prueba/);
  assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Cancelar solicitud'), false);
  assert.ok(document.querySelector('a[href="/solicitudes-enfermero"]'));
});

// SCRUM-58.3: el paciente consulta el estado de todas sus solicitudes.
test('Mis solicitudes muestra estados, enlaza al comprobante y permite cancelar desde la tarjeta', async () => {
  session('paciente');
  const items = [
    { ...comprobante, idSolicitud: 31, estado: 'Pendiente' },
    { ...comprobante, idSolicitud: 32, estado: 'Aceptada' },
    { ...comprobante, idSolicitud: 33, estado: 'Rechazada', fecha: '2026-01-02' },
    { ...comprobante, idSolicitud: 34, estado: 'Realizada', fecha: '2026-02-02' },
  ];
  solicitudHandler = async config => {
    if (config.url === '/solicitudes/paciente/101') {
      assert.equal(config.params?.todas, 1);
      return { data: items };
    }
    if (config.url === '/solicitudes/31/cancelar') return { data: { mensaje: 'Solicitud cancelada', solicitud: { ...items[0], estado: 'Cancelada' } } };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).endsWith('/perfil/paciente')
    ? response({ idPaciente: 101, nombre: 'Ana' })
    : original(url, options));
  try {
    await mount('/home');
    await click(link('Mis solicitudes'));
    assert.equal(window.location.pathname, '/mis-solicitudes');
    assert.match(document.body.textContent, /En curso \(2\)/);
    assert.match(document.body.textContent, /Anteriores \(2\)/);
    const estados = [...document.querySelectorAll('.solicitud-status')].map(e => e.textContent);
    assert.deepEqual(estados, ['Pendiente', 'Aceptada', 'Realizada', 'Rechazada']);
    assert.ok(document.querySelector('a[href="/solicitudes/32"]').textContent.includes('mensajes'));
    assert.equal([...document.querySelectorAll('button')].filter(b => b.textContent === 'Cancelar solicitud').length, 2);
    await click(button('Cancelar solicitud'));
    await click(button('Sí, cancelar'));
    assert.ok(solicitudRequests.some(r => r.url === '/solicitudes/31/cancelar'));
    assert.match(document.body.textContent, /En curso \(1\)/);
    assert.match(document.body.textContent, /Anteriores \(3\)/);
  } finally { globalThis.fetch = original; }
});

// HU3: "El sistema muestra enfermeros cercanos": la cartilla ordena por la ubicación del paciente.
test('ordenar por cercanía envía la ubicación aproximada y permite limitar la distancia', async () => {
  session('paciente');
  const original = globalThis.fetch;
  const busquedas = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/enfermeros/buscar')) {
      busquedas.push(new URL(String(url)).searchParams);
      return response({ enfermeros: [{ id: 2, usuario_id: 2, nombre: 'Laura', distancia_km: 3.4 }], total_resultados: 1, total_paginas: 1 });
    }
    return original(url, options);
  };
  Object.defineProperty(globalThis.navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok) => ok({ coords: { latitude: -32.889512, longitude: -68.845812 } }) },
  });
  try {
    await mount('/cartilla');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    await click(button('Ordenar por cercanía'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    const ultima = busquedas.at(-1);
    assert.equal(ultima.get('lat'), '-32.890');
    assert.equal(ultima.get('lng'), '-68.846');
    assert.match(document.body.textContent, /más cercanos a tu ubicación/);
    assert.match(document.body.textContent, /A 3\.4\s*km/);
    const radio = document.querySelector('.nearby-radius select');
    await act(async () => {
      radio.value = '10';
      radio.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.equal(busquedas.at(-1).get('radio_km'), '10');
    await click(button('Quitar orden por cercanía'));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.equal(busquedas.at(-1).get('lat'), null);
  } finally {
    globalThis.fetch = original;
    delete globalThis.navigator.geolocation;
  }
});

// HU12: búsqueda asistida en lenguaje natural.
test('la búsqueda asistida convierte el pedido en filtros editables', async () => {
  session('paciente');
  const original = globalThis.fetch;
  const busquedas = [];
  let pedido;
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/ia/interpretar-busqueda')) {
      pedido = JSON.parse(options.body);
      return response({
        fuente: 'gemini',
        filtros: { especialidad: 'Geriatría', ciudad: 'Godoy Cruz', dia_semana: 'Martes',
          hora_desde: '14:00', hora_hasta: '18:00', servicio: 'Inyecciones', aclaracion: null },
      });
    }
    if (ruta.includes('/enfermeros/buscar')) {
      busquedas.push(new URL(ruta).searchParams);
      return response({ enfermeros: [], total_resultados: 0, total_paginas: 0 });
    }
    return original(url, options);
  };
  try {
    await mount('/cartilla');
    const campo = document.querySelector('#busqueda-asistida');
    await typeTextArea(campo, 'insulina para mi mamá los martes a la tarde en Godoy Cruz');
    await act(async () => campo.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.equal(pedido.texto, 'insulina para mi mamá los martes a la tarde en Godoy Cruz');
    const ultima = busquedas.at(-1);
    assert.deepEqual(
      ['especialidad', 'ciudad', 'dia_semana', 'hora_desde', 'hora_hasta'].map((k) => ultima.get(k)),
      ['Geriatría', 'Godoy Cruz', 'Martes', '14:00', '18:00'],
    );
    assert.match(document.body.textContent, /elegí el servicio Inyecciones/);
    assert.match(document.body.textContent, /Interpretado con inteligencia artificial/);
    assert.ok(button('Quitar filtro Godoy Cruz'));
  } finally {
    globalThis.fetch = original;
  }
});

test('la búsqueda asistida avisa ante una urgencia y si falla deja los filtros manuales', async () => {
  session('paciente');
  const original = globalThis.fetch;
  let falla = false;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/ia/interpretar-busqueda')) {
      if (falla) return response({ error: 'Hiciste muchas búsquedas seguidas.' }, 429);
      return response({ fuente: 'reglas', filtros: { aclaracion: 'Si es una urgencia, llamá al 107 o al servicio de emergencias de tu zona.' } });
    }
    return original(url, options);
  };
  try {
    await mount('/cartilla');
    const campo = document.querySelector('#busqueda-asistida');
    const enviar = () => act(async () => campo.closest('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
    await typeTextArea(campo, 'es urgente, se desmayó');
    await enviar();
    assert.match(document.body.textContent, /llamá al 107/);
    assert.match(document.body.textContent, /No encontramos datos para filtrar/);
    falla = true;
    await enviar();
    assert.match(document.querySelector('.assisted-search [role="alert"]').textContent, /Podés usar los filtros de abajo/);
  } finally {
    globalThis.fetch = original;
  }
});

test('el contacto con el profesional abre WhatsApp con el número en formato internacional', async () => {
  const { enlaceWhatsapp } = await import(pathToFileURL(resolve('.test-build/api.mjs')));
  for (const telefono of ['2615551234', '0261 15 555-1234', '+54 9 261 555 1234', '11 15 5555 1234']) {
    assert.match(enlaceWhatsapp(telefono), /^https:\/\/wa\.me\/549(2615551234|1155551234)\?text=Hola/);
  }
  assert.equal(enlaceWhatsapp('1234'), null);
  assert.equal(enlaceWhatsapp(''), null);
});
