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
    entryPoints: { app: 'src/App.jsx', api: 'src/api.js', fechas: 'src/fechas.js', perfil: 'src/components/perfilPendiente.js' },
    outdir: '.test-build',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    splitting: true,
    packages: 'external',
    jsx: 'automatic',
    loader: { '.png': 'file', '.webp': 'file' },
    // La hoja de estilos de Leaflet es de un paquete externo: en las pruebas alcanza con omitirla.
    plugins: [{
      name: 'css-de-paquetes',
      setup(compilacion) {
        compilacion.onResolve({ filter: /^leaflet\/.*\.css$/ }, () => ({ path: 'leaflet.css', namespace: 'vacio' }));
        compilacion.onLoad({ filter: /.*/, namespace: 'vacio' }, () => ({ contents: '', loader: 'css' }));
      },
    }],
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
  localStorage.setItem('refresh_token', 'renovacion');
  await mount('/home');
  // El botón dice "Salir" con texto visible, no solo un ícono.
  const salir = button('Salir');
  assert.equal(salir.textContent.trim(), 'Salir');
  assert.equal(document.querySelectorAll('.account-link').length, 0);
  assert.equal(document.querySelectorAll('header a[href="/perfil-paciente"]').length, 1);
  await click(salir);
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

test('el profesional denuncia una reseña de su perfil con un motivo', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  const denuncias = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/usuarios/1')) return response({ ...profile, enfermero_id: 7, verificado: true, disponible: true });
    if (ruta.endsWith('/enfermeros/7/resenas')) {
      return response({
        idEnfermero: 7,
        calificacionPromedio: 2,
        cantidadResenas: 3,
        resenas: [
          { idResena: 9, puntuacion: 1, comentario: 'Pésima, una inútil.', fecha: null, paciente: 'Juan P.', denunciada: false },
          { idResena: 8, puntuacion: 2, comentario: '', fecha: null, paciente: 'Marta G.', denunciada: true },
          { idResena: 10, puntuacion: 3, comentario: 'Regular.', fecha: null, paciente: 'Ana R.', denunciada: false },
        ],
      });
    }
    if (ruta.includes('/denunciar') && options.method === 'POST') {
      denuncias.push({ ruta, body: JSON.parse(options.body) });
      if (ruta.endsWith('/resenas/10/denunciar')) {
        return response({ error: 'Ya denunciaste esta reseña. El equipo de Enfered la va a revisar.' }, 409);
      }
      return response({ mensaje: 'Recibimos tu denuncia. El equipo de Enfered va a revisar la reseña.', idResena: 9, denunciada: true });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil/1');
    const items = () => [...document.querySelectorAll('.profile-reviews li')];
    assert.match(items()[1].textContent, /Denuncia enviada/);
    assert.equal(items()[1].querySelector('p:not(.field-hint)'), null);
    await click(items()[0].querySelector('button'));
    const dialogo = document.querySelector('dialog.admin-motivo-dialog');
    assert.equal(dialogo.open, true);
    await enviarFormulario(dialogo.querySelector('form'));
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /entre 5 y 300 caracteres/);
    await typeTextArea(dialogo.querySelector('textarea'), '  Me insulta y nunca la atendí.  ');
    await enviarFormulario(dialogo.querySelector('form'));
    await esperar(20);
    assert.deepEqual(denuncias[0], { ruta: 'http://localhost:5000/api/resenas/9/denunciar', body: { motivo: 'Me insulta y nunca la atendí.' } });
    assert.equal(dialogo.open, false);
    assert.match(items()[0].textContent, /Denuncia enviada/);
    assert.match(items()[0].textContent, /Recibimos tu denuncia/);
    // Ya denunciada desde otro lado: el 409 la deja marcada como enviada.
    await click(items()[2].querySelector('button'));
    await typeTextArea(dialogo.querySelector('textarea'), 'Es de otra persona.');
    await enviarFormulario(dialogo.querySelector('form'));
    await esperar(20);
    assert.equal(dialogo.open, false);
    assert.match(items()[2].textContent, /Ya denunciaste esta reseña/);
    assert.match(items()[2].textContent, /Denuncia enviada/);
  } finally {
    globalThis.fetch = original;
  }
});

test('quien no es el profesional calificado no ve el botón para denunciar', async () => {
  session();
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/usuarios/1')) return response({ ...profile, enfermero_id: 7 });
    if (String(url).endsWith('/enfermeros/7/resenas')) {
      return response({ idEnfermero: 7, calificacionPromedio: 1, cantidadResenas: 1,
        resenas: [{ idResena: 9, puntuacion: 1, comentario: 'Mala.', fecha: null, paciente: 'Juan P.' }] });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil/1');
    assert.equal(document.querySelector('.profile-reviews li button'), null);
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
    // Un número inválido no se envía: el cliente aplica la misma regla que el backend.
    await type(document.querySelector('input[name="telefono"]'), '1234');
    await submitForm();
    assert.equal(payloads.length, 0);
    assert.match(document.querySelector('[role="alert"]').textContent, /código de área, sin 0 ni 15/);
    assert.equal(document.querySelector('input[name="telefono"]').getAttribute('aria-invalid'), 'true');
    await type(document.querySelector('input[name="telefono"]'), '261 555 1234');
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
  // El perfil de prueba no tiene teléfono: el formulario lo pide y lo guarda antes de enviar.
  const telefono = document.querySelector('input[name="telefono"]');
  if (telefono) await type(telefono, '261 555 1234');
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
    // Manda el horario que vio: si el paciente lo cambió, el servidor no lo acepta a ciegas.
    const aceptar = solicitudRequests.find(r => r.url === '/solicitudes/15/aceptar');
    assert.deepEqual(JSON.parse(aceptar.data), { fecha: '2099-12-10', hora: '14:30' });
    await click(button('Rechazar'));
    assert.equal(document.querySelector('dialog').open, true);
    await click(button('Sí, rechazar'));
    assert.match(document.body.textContent, /Solicitud rechazada/);
    assert.equal(solicitudRequests.filter(r => r.method === 'put').length, 2);
  } finally { globalThis.fetch = original; }
});

test('si el paciente cambió el horario, aceptar muestra el nuevo en la tarjeta sin aceptarlo', async () => {
  session('enfermero');
  solicitudHandler = async (config) => {
    if (config.url === '/solicitudes/enfermero/201') {
      return { data: [{ ...comprobante, paciente: { nombre: 'Ana', apellido: 'Prueba' } }] };
    }
    if (config.url === '/solicitudes/15/aceptar') return { status: 409, data: {
      error: 'El paciente cambió el día o la hora de este turno. Revisá el horario nuevo antes de aceptarlo.',
      solicitud: { ...comprobante, fecha: '2099-12-12', hora: '18:00', paciente: { nombre: 'Ana', apellido: 'Prueba' } },
    } };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).endsWith('/perfil/enfermero')
    ? response({ ...profile, idEnfermero: 201 })
    : original(url, options));
  try {
    await mount('/solicitudes-enfermero');
    assert.match(document.body.textContent, /10 de diciembre de 2099/);
    await click(button('Aceptar solicitud'));
    assert.match(document.body.textContent, /El paciente cambió el día o la hora/);
    assert.match(document.body.textContent, /12 de diciembre de 2099/);
    assert.doesNotMatch(document.body.textContent, /10 de diciembre de 2099/);
    assert.match(document.body.textContent, /Pendiente/);
  } finally { globalThis.fetch = original; }
});

test('un profesional que ya no está en la cartilla muestra un enlace a la cartilla en vez de reintentar', async () => {
  session();
  solicitudHandler = async (config) => {
    if (config.url === '/usuarios/21') return { status: 404, data: { error: 'Usuario no encontrado' } };
    if (config.url === '/servicios') return { data: [comprobante.servicio] };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  await mount('/perfil/21/solicitar');
  assert.match(document.body.textContent, /Este profesional no está disponible en este momento\. Buscá otro en la cartilla\./);
  assert.ok(document.querySelector('a[href="/cartilla"]'));
  assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Reintentar carga'), false);
  assert.doesNotMatch(document.body.textContent, /No se encontró el recurso/);
});

test('dos franjas pegadas del mismo día ofrecen horarios que cruzan el borde', async () => {
  session();
  solicitudHandler = async (config) => {
    if (config.url === '/usuarios/21') return { data: {
      id: 21, enfermero_id: 201, nombre: 'Laura', apellido: 'Gómez', verificado: true, disponible: true,
      horarios: [
        { dia_semana: 'Jueves', hora_inicio: '12:00', hora_fin: '14:00', estado: 'Disponible' },
        { dia_semana: 'Jueves', hora_inicio: '10:00', hora_fin: '12:00', estado: 'Disponible' },
      ],
    } };
    if (config.url === '/servicios') return { data: [{ idServicio: 301, tipoServicio: 'Curaciones', precioEstimado: 100, duracionMinutos: 60 }] };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  await mount('/perfil/21/solicitar');
  assert.match(document.body.textContent, /Laura Gómez atiende: Jueves de 10:00 a 14:00\./);
  const select = document.querySelector('select[name="idServicio"]');
  await act(async () => {
    select.value = '301';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await type(document.querySelector('input[name="fecha"]'), '2099-12-10');
  const horarios = [...document.querySelectorAll('input[type="radio"][name="hora"]')].map((input) => input.value);
  assert.deepEqual(horarios, ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00']);
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

test('un turno que ya empezó no ofrece cancelar', async () => {
  session();
  solicitudHandler = async (config) => {
    if (config.url === '/solicitudes/15') return { data: { ...comprobante, estado: 'Aceptada', fecha: '2020-01-10', hora: '10:00' } };
    return { data: [] };
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).includes('/historial')
    ? response({ servicios: [], calificaciones: [] })
    : original(url, options));
  try {
    await mount('/solicitudes/15');
    assert.match(document.body.textContent, /Comprobante de solicitud/);
    assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Cancelar solicitud'), false);
  } finally { globalThis.fetch = original; }
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
      return response({ enfermeros: [{ id: 2, usuario_id: 2, nombre: 'Laura', distancia_km: 3 }], total_resultados: 1, total_paginas: 1 });
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
    assert.match(document.body.textContent, /A unos 3 km/);
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
    assert.match(document.querySelector('.assisted-search [role="alert"]').textContent, /Podés buscar con los filtros de la cartilla/);
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

// F1: sesión renovable, regreso al lugar después del login, avisos y título por pantalla.
function tokenDePrueba(payload) {
  return 'header.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.signature';
}
const enUnaHora = () => Math.floor(Date.now() / 1000) + 3600;

function sesionRenovable(rol = 'paciente', exp) {
  session(rol, exp);
  localStorage.setItem('refresh_token', tokenDePrueba({ sub: '1', type: 'refresh', exp: enUnaHora() }));
}

async function esperar(ms = 0) {
  await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
}

test('un 401 renueva el token una sola vez aunque haya varios pedidos y los reintenta', async () => {
  sesionRenovable();
  const viejo = localStorage.getItem('token');
  const nuevo = tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora(), n: 2 });
  const original = globalThis.fetch;
  const llamadas = [];
  let liberarRenovacion;
  const renovacionPedida = new Promise((resolve) => { liberarRenovacion = resolve; });
  let soltar;
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    llamadas.push([ruta, options.headers?.Authorization]);
    if (ruta.endsWith('/api/token/refresh')) {
      liberarRenovacion();
      await new Promise((resolve) => { soltar = resolve; });
      return response({ token: nuevo });
    }
    if (options.headers?.Authorization === `Bearer ${viejo}`)
      return response({ error: 'Tu sesión venció. Volvé a iniciar sesión.' }, 401);
    return response({ ruta });
  };
  try {
    const { requestApi } = await import(pathToFileURL(resolve('.test-build/api.mjs')));
    const pedidos = Promise.all([requestApi('/perfil/paciente'), requestApi('/notificaciones/1')]);
    await renovacionPedida;
    await new Promise((resolve) => setTimeout(resolve, 0));
    soltar();
    const [perfil, avisos] = await pedidos;
    assert.match(perfil.ruta, /\/perfil\/paciente$/);
    assert.match(avisos.ruta, /\/notificaciones\/1$/);
    const renovaciones = llamadas.filter(([ruta]) => ruta.endsWith('/api/token/refresh'));
    assert.equal(renovaciones.length, 1);
    assert.equal(renovaciones[0][1], `Bearer ${localStorage.getItem('refresh_token')}`);
    assert.equal(localStorage.getItem('token'), nuevo);
    assert.equal(llamadas.filter(([, auth]) => auth === `Bearer ${nuevo}`).length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('el cliente de solicitudes también renueva la sesión y reintenta el pedido', async () => {
  sesionRenovable();
  const viejo = localStorage.getItem('token');
  const nuevo = tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora(), n: 3 });
  solicitudHandler = async (config) => {
    if (config.headers.Authorization === `Bearer ${viejo}`)
      return { status: 401, data: { error: 'Tu sesión venció. Volvé a iniciar sesión.' } };
    if (config.url === '/solicitudes/paciente/101') return { data: [{ ...comprobante, idSolicitud: 41 }] };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  const renovaciones = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/api/token/refresh')) {
      renovaciones.push(options.headers.Authorization);
      return response({ token: nuevo });
    }
    if (ruta.endsWith('/perfil/paciente')) return response({ idPaciente: 101, nombre: 'Ana' });
    return original(url, options);
  };
  try {
    await mount('/mis-solicitudes');
    await esperar(20);
    assert.equal(window.location.pathname, '/mis-solicitudes');
    assert.equal(renovaciones.length, 1);
    assert.equal(solicitudRequests.at(-1).headers.Authorization, `Bearer ${nuevo}`);
    assert.ok(document.querySelector('a[href="/solicitudes/41"]'));
  } finally {
    globalThis.fetch = original;
  }
});

test('una cuenta suspendida vuelve al login con el motivo y la ruta para volver', async () => {
  sesionRenovable();
  const original = globalThis.fetch;
  const renovaciones = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/api/token/refresh')) renovaciones.push(ruta);
    if (ruta.endsWith('/perfil/paciente'))
      return response({ error: 'Tu cuenta no está activa. Si creés que es un error, contactá a soporte.' }, 401);
    return original(url, options);
  };
  try {
    await mount('/mis-solicitudes');
    await esperar(20);
    assert.equal(window.location.pathname, '/login');
    const parametros = new URLSearchParams(window.location.search);
    assert.equal(parametros.get('volver'), '/mis-solicitudes');
    assert.equal(parametros.get('motivo'), 'suspendida');
    assert.equal(renovaciones.length, 0);
    assert.equal(localStorage.getItem('token'), null);
    assert.equal(localStorage.getItem('refresh_token'), null);
    assert.match(document.querySelector('[role="alert"]').textContent, /Tu cuenta no está activa/);
  } finally {
    globalThis.fetch = original;
  }
});

test('con el acceso vencido se renueva la sesión antes de mostrar la pantalla', async () => {
  sesionRenovable('paciente', Math.floor(Date.now() / 1000) - 1);
  const nuevo = tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora(), n: 4 });
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).endsWith('/api/token/refresh')
    ? response({ token: nuevo })
    : original(url, options));
  try {
    await mount('/perfil-paciente');
    await esperar(20);
    assert.equal(window.location.pathname, '/perfil-paciente');
    assert.equal(localStorage.getItem('token'), nuevo);
  } finally {
    globalThis.fetch = original;
  }
});

test('si la renovación falla vuelve al login y después de entrar regresa a la misma pantalla', async () => {
  sesionRenovable('paciente', Math.floor(Date.now() / 1000) - 1);
  const original = globalThis.fetch;
  const login = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/api/token/refresh'))
      return response({ error: 'Tu sesión venció. Volvé a iniciar sesión.' }, 401);
    if (ruta.endsWith('/api/login')) {
      login.push(options);
      return response({
        token: tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora() }),
        refresh_token: 'renovacion-nueva',
        rol: 'paciente',
      });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente?seccion=datos');
    await esperar(20);
    assert.equal(window.location.pathname, '/login');
    const parametros = new URLSearchParams(window.location.search);
    assert.equal(parametros.get('volver'), '/perfil-paciente?seccion=datos');
    assert.equal(parametros.get('motivo'), 'expirada');
    assert.match(document.body.textContent, /Tu sesión terminó/);
    await type(document.querySelector('input[type="email"]'), 'ana@test.local');
    await type(document.querySelector('input[type="password"]'), 'clave-segura');
    await submitForm();
    await esperar(20);
    // El login no manda un token viejo y un 401 ahí no se toma como sesión vencida.
    assert.equal(login[0].headers.Authorization, undefined);
    assert.equal(window.location.pathname, '/perfil-paciente');
    assert.equal(window.location.search, '?seccion=datos');
    assert.equal(localStorage.getItem('refresh_token'), 'renovacion-nueva');
  } finally {
    globalThis.fetch = original;
  }
});

test('el login ignora un destino externo en volver y muestra el error de credenciales', async () => {
  const original = globalThis.fetch;
  let intentos = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).endsWith('/api/login')) return original(url, options);
    intentos += 1;
    if (intentos === 1) return response({ error: 'Credenciales incorrectas' }, 401);
    return response({ token: tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora() }), rol: 'paciente' });
  };
  try {
    await mount('/login?volver=//otro-sitio.example/robar');
    await type(document.querySelector('input[type="email"]'), 'ana@test.local');
    await type(document.querySelector('input[type="password"]'), 'clave-mal');
    await submitForm();
    await esperar();
    assert.equal(window.location.pathname, '/login');
    assert.match(document.querySelector('[role="alert"]').textContent, /Credenciales incorrectas/);
    await submitForm();
    await esperar();
    assert.equal(window.location.pathname, '/home');
  } finally {
    globalThis.fetch = original;
  }
});

test('volver solo acepta rutas de este sitio, aunque usen barra invertida o caracteres de control', async () => {
  const { rutaInterna, rutaDeLogin } = await import(pathToFileURL(resolve('.test-build/api.mjs')));
  assert.equal(rutaInterna('/mis-solicitudes?todas=1'), '/mis-solicitudes?todas=1');
  for (const ruta of ['//otro.example', '/\\otro.example', '/\\/otro.example', '/\totro', 'https://otro.example', '/login?x=1', null]) {
    assert.equal(rutaInterna(ruta), null, String(ruta));
  }
  assert.equal(new URLSearchParams(rutaDeLogin('expirada', '/\\otro.example').split('?')[1]).get('volver'), null);
  assert.equal(new URLSearchParams(rutaDeLogin('expirada', '/cartilla').split('?')[1]).get('volver'), '/cartilla');
});

test('el login con volver=/\\otro-sitio entra al inicio sin error', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).endsWith('/api/login')) return original(url, options);
    return response({ token: tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora() }), rol: 'paciente' });
  };
  try {
    await mount('/login?volver=/%5Cotro-sitio.example');
    await type(document.querySelector('input[type="email"]'), 'ana@test.local');
    await type(document.querySelector('input[type="password"]'), 'clave-bien');
    await submitForm();
    await esperar();
    assert.equal(window.location.pathname, '/home');
  } finally {
    globalThis.fetch = original;
  }
});

test('un servidor que no responde corta a los 20 segundos con un mensaje claro', async () => {
  const original = globalThis.fetch;
  const originalSetTimeout = window.setTimeout;
  let espera;
  window.setTimeout = (callback, ms, ...resto) => {
    if (ms === 20000) espera = ms;
    return originalSetTimeout(callback, ms === 20000 ? 0 : ms, ...resto);
  };
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new window.DOMException('Abortado', 'AbortError')));
  });
  try {
    const { requestApi } = await import(pathToFileURL(resolve('.test-build/api.mjs')));
    await assert.rejects(requestApi('/enfermeros'), {
      message: 'No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.',
    });
    assert.equal(espera, 20000);
    // Si quien llama cancela, se respeta su cancelación y no se muestra el aviso de conexión.
    const controller = new AbortController();
    const pedido = requestApi('/enfermeros', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pedido, { name: 'AbortError' });
  } finally {
    globalThis.fetch = original;
    window.setTimeout = originalSetTimeout;
  }
});

test('tocar una notificación de turno la marca leída y abre la solicitud', async () => {
  session('paciente');
  solicitudHandler = async (config) => {
    if (config.url === '/solicitudes/15') return { data: comprobante };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/notificaciones/1')) {
      return response([
        { idNotificacion: 9, tipo: 'reprogramada', idSolicitud: 15, mensaje: 'Cambiaron el horario del turno', leida: false, fechaHora: '2026-10-18T13:00:00Z' },
        { idNotificacion: 10, tipo: 'vencida', idSolicitud: 16, mensaje: 'Tu pedido no tuvo respuesta', leida: false, fechaHora: '2026-10-18T12:00:00Z' },
      ]);
    }
    if (ruta.includes('/notificaciones/')) {
      llamadas.push([options.method, ruta.replace('http://localhost:5000/api', '')]);
      return response({ mensaje: 'ok' });
    }
    return original(url, options);
  };
  try {
    await mount('/home');
    await click(button('Notificaciones'));
    assert.match(document.querySelector('.notification-panel').textContent, /Turno reprogramado/);
    assert.match(document.querySelector('.notification-panel').textContent, /Venció sin respuesta/);
    await click(button('Cambiaron el horario'));
    await esperar(20);
    assert.deepEqual(llamadas[0], ['PUT', '/notificaciones/9/leer']);
    assert.equal(window.location.pathname, '/solicitudes/15');
    assert.equal(document.querySelector('.notification-panel'), null);
    assert.equal(document.title, 'Comprobante de solicitud · Enfered');
    await click(button('Notificaciones'));
    await click(button('Marcar todas como leídas'));
    assert.deepEqual(llamadas.at(-1), ['PUT', '/notificaciones/leer-todas']);
    assert.equal(document.querySelector('.notification-count'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('la campana sigue visible si una consulta posterior falla', async () => {
  session('paciente');
  const original = globalThis.fetch;
  let consultas = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).endsWith('/notificaciones/1')) return original(url, options);
    consultas += 1;
    return consultas === 1
      ? response([{ idNotificacion: 3, mensaje: 'Aceptaron tu turno', leida: false, fechaHora: '2026-10-18T13:00:00Z' }])
      : response({ error: 'No se pudieron cargar las notificaciones' }, 500);
  };
  try {
    await mount('/home');
    await click(button('Notificaciones'));
    await esperar();
    assert.equal(consultas, 2);
    assert.ok(document.querySelector('.notification-trigger'));
    assert.match(document.querySelector('.notification-panel').textContent, /Aceptaron tu turno/);
    assert.match(document.querySelector('.notification-panel [role="alert"]').textContent, /No se pudieron cargar/);
  } finally {
    globalThis.fetch = original;
  }
});

test('cada pantalla tiene su título y al navegar el foco pasa al título principal', async () => {
  await mount('/privacidad');
  assert.equal(document.title, 'Política de privacidad · Enfered');
  await click(link('Términos y condiciones'));
  await esperar();
  assert.equal(document.title, 'Términos y condiciones · Enfered');
  assert.equal(document.activeElement.tagName, 'H1');
  assert.match(document.activeElement.textContent, /Términos y condiciones/);
});

// F2: fechas legibles, horarios al pedir turno, reprogramar, calificar y cancelar como enfermero.
function conPestanaVisible() {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  return () => { delete document.hidden; };
}
async function volverALaPestana() {
  await act(async () => document.dispatchEvent(new window.Event('visibilitychange')));
  await esperar();
}
async function enviarFormulario(form) {
  await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
}
const MENSAJE_TELEFONO = 'Escribí el teléfono con código de área, sin 0 ni 15. Por ejemplo: 261 555 1234.';

test('las fechas de turnos se leen en castellano y no se corren de día por la zona horaria', async () => {
  const { fechaLegible, diaDeLaSemana } = await import(pathToFileURL(resolve('.test-build/fechas.mjs')));
  const zonaOriginal = process.env.TZ;
  try {
    for (const zona of ['America/Argentina/Mendoza', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = zona;
      assert.equal(fechaLegible('2099-12-10'), 'jueves 10 de diciembre de 2099');
      assert.equal(fechaLegible('2099-12-10', '15:00'), 'jueves 10 de diciembre de 2099, 15:00 hs');
      assert.equal(diaDeLaSemana('2099-12-14'), 'Lunes');
    }
    const anio = new Date().getFullYear();
    assert.match(fechaLegible(`${anio}-03-02`, '09:30:00'), /^\S+ 2 de marzo, 09:30 hs$/);
  } finally {
    if (zonaOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = zonaOriginal;
  }
});

test('pedir turno muestra los horarios del día, precarga la dirección y guarda el teléfono antes de enviar', async () => {
  session();
  let intentos = 0;
  solicitudHandler = async (config) => {
    if (config.url === '/usuarios/21') return { data: {
      id: 21, enfermero_id: 201, nombre: 'Laura', apellido: 'Gómez', verificado: true, disponible: true,
      horarios: [
        { dia_semana: 'Jueves', hora_inicio: '08:00', hora_fin: '10:00', estado: 'Disponible' },
        { dia_semana: 'Lunes', hora_inicio: '08:00', hora_fin: '12:00', estado: 'Pausado' },
      ],
    } };
    if (config.url === '/servicios') return { data: [{ idServicio: 301, tipoServicio: 'Curaciones', precioEstimado: 100, duracionMinutos: 60 }] };
    if (config.url === '/solicitudes' && config.method === 'post') {
      intentos += 1;
      return intentos === 1
        ? { status: 409, data: { error: 'Ya tenés 5 solicitudes esperando respuesta. Esperá a que te respondan o cancelá alguna antes de pedir otra.' } }
        : { status: 201, data: { mensaje: 'Solicitud creada', solicitud: comprobante } };
    }
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  const perfilPuts = [];
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/perfil/paciente')) {
      if (options.method === 'PUT') {
        perfilPuts.push(JSON.parse(options.body));
        return response({ idPaciente: 101, telefono: '2615551234', direccion: 'Belgrano 50, Godoy Cruz' });
      }
      return response({ idPaciente: 101, direccion: 'Belgrano 50, Godoy Cruz', telefono: '' });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil/21/solicitar');
    assert.equal(document.querySelector('main main'), null);
    assert.doesNotMatch(document.body.textContent, /El servidor comprobará/);
    assert.equal(document.querySelector('input[name="direccionAtencion"]').value, 'Belgrano 50, Godoy Cruz');
    assert.match(document.body.textContent, /Laura Gómez atiende: Jueves de 08:00 a 10:00\./);
    const select = document.querySelector('select[name="idServicio"]');
    await act(async () => {
      select.value = '301';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.match(document.body.textContent, /El turno dura 1 hora/);
    await type(document.querySelector('input[name="fecha"]'), '2099-12-14');
    assert.match(document.body.textContent, /Elegiste el lunes 14 de diciembre de 2099/);
    assert.match(document.body.textContent, /no atiende los lunes/);
    assert.equal(document.querySelectorAll('input[name="hora"]').length, 0);
    await type(document.querySelector('input[name="fecha"]'), '2099-12-10');
    const horarios = [...document.querySelectorAll('input[type="radio"][name="hora"]')].map((input) => input.value);
    assert.deepEqual(horarios, ['08:00', '08:30', '09:00']);
    await click(document.querySelector('input[type="radio"][value="09:00"]'));
    assert.equal(document.querySelector('input[type="radio"][value="09:00"]').checked, true);

    await type(document.querySelector('input[name="telefono"]'), '123');
    await submitForm();
    assert.equal(document.querySelector('[role="alert"]').textContent, MENSAJE_TELEFONO);
    assert.equal(perfilPuts.length, 0);
    assert.equal(intentos, 0);

    await type(document.querySelector('input[name="telefono"]'), '0261 15 555-1234');
    await submitForm();
    assert.deepEqual(perfilPuts, [{ telefono: '0261 15 555-1234' }]);
    // El error del backend se muestra tal como llega.
    assert.equal(document.querySelector('[role="alert"]').textContent, 'Ya tenés 5 solicitudes esperando respuesta. Esperá a que te respondan o cancelá alguna antes de pedir otra.');
    assert.equal(document.querySelector('input[name="telefono"]'), null);

    await submitForm();
    assert.equal(perfilPuts.length, 1);
    const post = solicitudRequests.filter((r) => r.method === 'post').at(-1);
    assert.deepEqual(JSON.parse(post.data), {
      idServicio: 301, idEnfermero: 201, fecha: '2099-12-10', hora: '09:00', direccionAtencion: 'Belgrano 50, Godoy Cruz',
    });
    assert.match(document.querySelector('.solicitud-success').textContent, /¡Solicitud creada!/);
  } finally { globalThis.fetch = original; }
});

function conPaciente(handler, extra = () => null) {
  solicitudHandler = handler;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/perfil/paciente')) return response({ idPaciente: 101, nombre: 'Ana' });
    return (await extra(String(url), options)) || original(url, options);
  };
  return () => { globalThis.fetch = original; };
}

test('las tarjetas muestran Vencida, quién canceló y el motivo, WhatsApp en las aceptadas y la búsqueda de otro profesional', async () => {
  session('paciente');
  const items = [
    { ...comprobante, idSolicitud: 31, estado: 'Pendiente' },
    { ...comprobante, idSolicitud: 32, estado: 'Aceptada', contacto: { telefono: '2612222222', email: 'laura@test.local' } },
    { ...comprobante, idSolicitud: 33, estado: 'Vencida', fecha: '2026-01-02' },
    { ...comprobante, idSolicitud: 35, estado: 'Cancelada', fecha: '2026-01-05', canceladaPor: 'enfermero', motivoCancelacion: 'Tengo una urgencia familiar.' },
  ];
  const restaurar = conPaciente(async (config) => {
    if (config.url === '/solicitudes/paciente/101') return { data: items };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  });
  try {
    await mount('/mis-solicitudes');
    const tarjetas = [...document.querySelectorAll('.solicitud-card')];
    const de = (id) => tarjetas.find((tarjeta) => tarjeta.textContent.includes(`SOLICITUD #${id}`));
    assert.match(de(31).textContent, /jueves 10 de diciembre de 2099, 14:30 hs/);
    assert.match(de(33).querySelector('.solicitud-status.vencida').textContent, /Vencida/);
    assert.match(de(33).textContent, /Venció sin respuesta/);
    assert.match(de(35).textContent, /El profesional canceló el turno\./);
    assert.match(de(35).querySelector('.solicitud-motivo').textContent, /Motivo: Tengo una urgencia familiar\./);
    const whatsapp = [...de(32).querySelectorAll('a')].find((a) => a.textContent === 'Escribir por WhatsApp');
    assert.ok(whatsapp.href.startsWith('https://wa.me/5492612222222?text='));
    assert.match(decodeURIComponent(whatsapp.href), /turno de Curaciones del jueves 10 de diciembre de 2099, 14:30 hs/);
    assert.equal(de(31).querySelector('a[href^="https://wa.me"]'), null);
    for (const id of [33, 35]) assert.ok(de(id).querySelector('a[href="/cartilla"]').textContent.includes('Buscar otro profesional'));
    assert.equal(de(31).querySelector('a[href="/cartilla"]'), null);
  } finally { restaurar(); }
});

test('Mis solicitudes sin pedidos ofrece buscar otro profesional', async () => {
  session('paciente');
  const restaurar = conPaciente(async () => ({ data: [] }));
  try {
    await mount('/mis-solicitudes');
    assert.ok(document.querySelector('.empty-state a[href="/cartilla"]').textContent.includes('Buscar otro profesional'));
  } finally { restaurar(); }
});

test('el paciente reprograma un turno y la actualización automática no cierra el diálogo', async () => {
  session('paciente');
  const restaurarPestana = conPestanaVisible();
  let consultas = 0;
  const items = [
    { ...comprobante, idSolicitud: 31, estado: 'Pendiente' },
    { ...comprobante, idSolicitud: 32, estado: 'Aceptada' },
  ];
  const restaurar = conPaciente(async (config) => {
    if (config.url === '/solicitudes/paciente/101') {
      consultas += 1;
      return { data: consultas === 1 ? items : [items[0], { ...items[1], estado: 'Cancelada', canceladaPor: 'enfermero' }] };
    }
    if (config.url === '/solicitudes/31/reprogramar' && config.method === 'put') {
      const cuerpo = JSON.parse(config.data);
      return cuerpo.hora === '10:00'
        ? { status: 409, data: { error: 'Ese horario se superpone con otro turno que Laura Gómez ya tiene confirmado. Elegí otro horario.' } }
        : { data: { mensaje: 'Solicitud reprogramada', solicitud: { ...items[0], ...cuerpo } } };
    }
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  });
  try {
    await mount('/mis-solicitudes');
    assert.equal([...document.querySelectorAll('button')].filter((b) => b.textContent === 'Reprogramar').length, 2);
    await click(button('Reprogramar'));
    let dialogo = document.querySelector('.solicitud-dialogo');
    assert.equal(dialogo.open, true);
    assert.equal(dialogo.getAttribute('aria-labelledby'), 'reprogramar-31-titulo');
    assert.match(dialogo.textContent, /Ahora está pedido para el jueves 10 de diciembre de 2099, 14:30 hs/);
    assert.equal(dialogo.querySelector('input[name="fecha"]').value, '2099-12-10');
    await type(dialogo.querySelector('input[name="fecha"]'), '2099-12-14');

    // Al volver a la pestaña se refresca la lista sin perder lo que la persona estaba escribiendo.
    await volverALaPestana();
    assert.equal(consultas, 2);
    assert.match(document.body.textContent, /El profesional canceló el turno/);
    dialogo = document.querySelector('.solicitud-dialogo');
    assert.equal(dialogo.open, true);
    assert.equal(dialogo.querySelector('input[name="fecha"]').value, '2099-12-14');

    await type(dialogo.querySelector('input[name="hora"]'), '10:00');
    await enviarFormulario(dialogo.querySelector('form'));
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /se superpone con otro turno/);
    assert.equal(dialogo.open, true);

    await type(dialogo.querySelector('input[name="hora"]'), '09:00');
    await enviarFormulario(dialogo.querySelector('form'));
    const put = solicitudRequests.filter((r) => r.method === 'put').at(-1);
    assert.equal(put.url, '/solicitudes/31/reprogramar');
    assert.deepEqual(JSON.parse(put.data), { fecha: '2099-12-14', hora: '09:00' });
    assert.equal(document.querySelector('.solicitud-dialogo'), null);
    const tarjeta = document.querySelector('.solicitud-card');
    assert.match(tarjeta.textContent, /Listo: pediste el turno para el lunes 14 de diciembre de 2099, 09:00 hs/);
    assert.match(tarjeta.querySelector('.solicitud-summary').textContent, /lunes 14 de diciembre de 2099, 09:00 hs/);
  } finally { restaurar(); restaurarPestana(); }
});

test('el paciente califica desde la tarjeta y el comprobante sin escribir un comentario', async () => {
  session('paciente');
  const realizada = { ...comprobante, idSolicitud: 34, estado: 'Realizada', fecha: '2026-02-02' };
  const items = [realizada, { ...comprobante, idSolicitud: 36, estado: 'Realizada', fecha: '2026-03-03' }];
  let resena;
  const restaurar = conPaciente(async (config) => {
    if (config.url === '/solicitudes/paciente/101') return { data: items };
    if (config.url === '/solicitudes/34') return { data: realizada };
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  }, (url, options) => {
    if (url.endsWith('/usuarios/1/historial')) {
      return response([
        { ...items[1], calificaciones: [{ idCalificacion: 2, idSolicitud: 36, estrellas: 4, comentario: '' }] },
        { ...realizada, calificaciones: [] },
      ]);
    }
    if (url.endsWith('/resenas') && options.method === 'POST') {
      resena = JSON.parse(options.body);
      return response({ mensaje: 'Reseña publicada', resena: { idResena: 9, idSolicitud: 34, puntuacion: resena.puntuacion, comentario: '' } }, 201);
    }
    if (url.endsWith('/mensajes')) return response([]);
    return null;
  });
  try {
    await mount('/mis-solicitudes');
    await esperar();
    const calificar = () => [...document.querySelectorAll('button')].filter((b) => b.textContent === 'Calificar');
    assert.equal(calificar().length, 1);
    assert.equal(document.querySelectorAll('.solicitud-calificacion').length, 1);
    await click(calificar()[0]);
    const modal = document.querySelector('dialog.rating-dialog');
    assert.match(modal.textContent, /Comentario \(opcional/);
    assert.equal(modal.querySelector('textarea').required, false);
    await click(modal.querySelector('input[type="radio"][value="5"]'));
    const enviar = [...modal.querySelectorAll('button')].find((b) => b.type === 'submit');
    assert.equal(enviar.disabled, false);
    await enviarFormulario(modal.querySelector('form'));
    assert.deepEqual(resena, { idSolicitud: 34, puntuacion: 5, comentario: '' });
    assert.equal(document.querySelector('dialog.rating-dialog'), null);
    assert.match(document.body.textContent, /¡Gracias! Tu calificación se guardó\./);
    assert.equal(calificar().length, 0);
    assert.equal(document.querySelectorAll('.solicitud-calificacion').length, 2);
    await act(async () => root.unmount());

    await mount('/solicitudes/34');
    await esperar();
    assert.equal(document.querySelector('main main'), null);
    assert.match(document.body.textContent, /lunes 2 de febrero/);
    assert.equal(calificar().length, 1);
    await click(calificar()[0]);
    assert.equal(document.querySelector('dialog.rating-dialog').open, true);
  } finally { restaurar(); }
});

test('el enfermero ve primero las pendientes y cancela un turno aceptado con un motivo', async () => {
  session('enfermero');
  const restaurarPestana = conPestanaVisible();
  const aceptada = { ...comprobante, idSolicitud: 22, estado: 'Aceptada', paciente: { nombre: 'Mario', apellido: 'López', telefono: '2615551234' } };
  const pendiente = { ...comprobante, idSolicitud: 23, estado: 'Pendiente', fecha: '2099-12-20', paciente: { nombre: 'Ana' } };
  let consultas = 0;
  solicitudHandler = async (config) => {
    if (config.url === '/solicitudes/enfermero/201') { consultas += 1; return { data: [aceptada, pendiente] }; }
    if (config.url === '/solicitudes/22/cancelar-enfermero' && config.method === 'put') {
      const { motivo } = JSON.parse(config.data);
      return { data: { mensaje: 'Turno cancelado', solicitud: { ...aceptada, estado: 'Cancelada', canceladaPor: 'enfermero', motivoCancelacion: motivo } } };
    }
    throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => (String(url).endsWith('/perfil/enfermero')
    ? response({ ...profile, idEnfermero: 201 })
    : original(url, options));
  try {
    await mount('/solicitudes-enfermero');
    const tarjetas = () => [...document.querySelectorAll('.solicitud-card')];
    assert.match(tarjetas()[0].textContent, /SOLICITUD #23/);
    const whatsapp = tarjetas()[1].querySelector('a[href^="https://wa.me"]');
    assert.match(decodeURIComponent(whatsapp.href), /Curaciones del jueves 10 de diciembre de 2099, 14:30 hs/);
    assert.match(tarjetas()[1].textContent, /jueves 10 de diciembre de 2099, 14:30 hs/);

    await click(button('Cancelar turno'));
    const dialogo = document.querySelector('dialog[aria-labelledby="cancelar-turno-titulo"]');
    assert.equal(dialogo.open, true);
    assert.match(dialogo.textContent, /Mario López/);
    await typeTextArea(dialogo.querySelector('textarea'), ' no ');
    await enviarFormulario(dialogo.querySelector('form'));
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /entre 5 y 200 caracteres/);
    assert.equal(solicitudRequests.some((r) => r.method === 'put'), false);

    // La actualización automática no cierra el diálogo ni borra el motivo.
    await typeTextArea(dialogo.querySelector('textarea'), '  Tengo fiebre y no puedo atender.  ');
    await volverALaPestana();
    assert.equal(consultas, 2);
    assert.equal(dialogo.open, true);
    assert.equal(dialogo.querySelector('textarea').value, '  Tengo fiebre y no puedo atender.  ');

    await enviarFormulario(dialogo.querySelector('form'));
    const put = solicitudRequests.find((r) => r.method === 'put');
    assert.equal(put.url, '/solicitudes/22/cancelar-enfermero');
    assert.deepEqual(JSON.parse(put.data), { motivo: 'Tengo fiebre y no puedo atender.' });
    assert.equal(dialogo.open, false);
    const tarjeta = tarjetas().find((t) => t.textContent.includes('SOLICITUD #22'));
    assert.match(tarjeta.textContent, /Cancelaste este turno\./);
    assert.match(tarjeta.querySelector('.solicitud-motivo').textContent, /Motivo: Tengo fiebre y no puedo atender\./);
    // El aviso aparece en la tarjeta y recibe el foco (en el celular el de arriba no se ve).
    assert.equal(document.activeElement.id, 'aviso-solicitud-22');
    assert.match(document.activeElement.textContent, /Turno cancelado/);
    assert.equal([...tarjeta.querySelectorAll('button')].some((b) => b.textContent === 'Cancelar turno'), false);
  } finally { globalThis.fetch = original; restaurarPestana(); }
});

// F3: cartilla por zona, contacto por WhatsApp, Mi cuenta y completar el perfil.
async function elegir(select, valor) {
  await act(async () => {
    select.value = valor;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

test('la cartilla filtra por zona con las ciudades del backend', async () => {
  session('paciente');
  const original = globalThis.fetch;
  const busquedas = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/enfermeros/ciudades')) return response(['Godoy Cruz', 'Luján de Cuyo']);
    if (ruta.includes('/enfermeros/buscar')) {
      busquedas.push(new URL(ruta).searchParams);
      return response({ enfermeros: [], total_resultados: 0, total_paginas: 0 });
    }
    return original(url, options);
  };
  try {
    await mount('/cartilla');
    await esperar(300);
    const zona = document.querySelector('#desktop-ciudad');
    assert.ok(zona, 'Falta el filtro de zona');
    assert.equal(document.querySelector('label[for="desktop-ciudad"]').textContent, 'Zona');
    assert.deepEqual([...zona.options].map((opcion) => opcion.textContent), ['Todas las zonas', 'Godoy Cruz', 'Luján de Cuyo']);
    await elegir(zona, 'Luján de Cuyo');
    await esperar(300);
    assert.equal(busquedas.at(-1).get('ciudad'), 'Luján de Cuyo');
    assert.ok(button('Quitar filtro Luján de Cuyo'));
    // El filtro del celular usa la misma lista.
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    await click(button('Mostrar filtros'));
    assert.equal(document.querySelector('#mobile-ciudad').value, 'Luján de Cuyo');
    assert.equal(document.querySelector('#mobile-ciudad').options.length, 3);
  } finally {
    globalThis.fetch = original;
    delete window.matchMedia;
  }
});

test('el mapa pide todas las páginas del filtro y no solo la página visible', async () => {
  session('paciente');
  const original = globalThis.fetch;
  const busquedas = [];
  const enfermero = (id) => ({ id, usuario_id: id, nombre: `Persona ${id}`, latitud: -32.89, longitud: -68.84 });
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.includes('/enfermeros/buscar')) {
      const parametros = new URL(ruta).searchParams;
      busquedas.push(parametros);
      if (parametros.get('per_page') === '100') {
        return response({
          enfermeros: parametros.get('page') === '1' ? [enfermero(1), enfermero(2)] : [enfermero(3)],
          total_resultados: 3,
          total_paginas: 2,
        });
      }
      return response({ enfermeros: [enfermero(1)], total_resultados: 3, total_paginas: 3 });
    }
    return original(url, options);
  };
  try {
    await mount('/cartilla?ciudad=Godoy%20Cruz&page=2&vista=mapa');
    await esperar(400);
    const delMapa = busquedas.filter((parametros) => parametros.get('per_page') === '100');
    assert.deepEqual(delMapa.map((parametros) => parametros.get('page')), ['1', '2']);
    assert.ok(delMapa.every((parametros) => parametros.get('ciudad') === 'Godoy Cruz'));
    assert.ok(busquedas.some((parametros) => parametros.get('per_page') === '6' && parametros.get('page') === '2'));
    assert.match(document.body.textContent, /todos los profesionales de esta búsqueda/);
  } finally {
    globalThis.fetch = original;
  }
});

test('el perfil del profesional oculta el contacto hasta que acepta la solicitud', async () => {
  session('paciente');
  const original = globalThis.fetch;
  let publico = { ...profile, contacto_habilitado: false, email: 'laura@test.local', direccion: 'Calle 123' };
  globalThis.fetch = async (url, options) =>
    String(url).endsWith('/usuarios/1') ? response(publico) : original(url, options);
  try {
    await mount('/perfil/1');
    const panel = document.querySelector('.contact-panel');
    assert.match(panel.textContent, /Cuando el profesional acepte tu solicitud vas a poder escribirle por WhatsApp/);
    assert.equal(panel.querySelector('a[href^="https://wa.me"]'), null);
    assert.equal(panel.querySelector('a[href^="tel:"]'), null);
    assert.doesNotMatch(panel.textContent, /laura@test\.local|Calle 123/);
    assert.equal(panel.querySelector('a[href="/perfil/1/solicitar"]').textContent, 'Pedir un turno');
    await act(async () => root.unmount());
    publico = { ...publico, contacto_habilitado: true, telefono: '2615551234' };
    await mount('/perfil/1');
    const habilitado = document.querySelector('.contact-panel');
    assert.match(habilitado.querySelector('a[href^="https://wa.me"]').href, /^https:\/\/wa\.me\/5492615551234\?text=/);
    assert.match(habilitado.textContent, /Escribir por WhatsApp/);
    assert.equal(habilitado.querySelector('a[href^="tel:"]'), null);
    assert.doesNotMatch(habilitado.textContent, /laura@test\.local/);
  } finally {
    globalThis.fetch = original;
  }
});

test('el enfermero ve el estado de su matrícula y la pista del teléfono para WhatsApp', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) =>
    String(url).endsWith('/perfil/enfermero')
      ? response({ ...profile, estadoVerificacion: 'rechazada', motivoRechazo: 'El número no coincide con el colegio.' })
      : original(url, options);
  try {
    await mount('/perfil-enfermero');
    assert.match(document.body.textContent, /No pudimos verificar tu matrícula/);
    assert.match(document.body.textContent, /Motivo: El número no coincide con el colegio\./);
    await click(button('Editar datos'));
    const pista = document.getElementById(document.querySelector('input[name="telefono"]').getAttribute('aria-describedby'));
    assert.match(pista.textContent, /sin 0 ni 15\. Ej\.: 261 555 1234/);
    assert.match(pista.textContent, /te van a escribir por WhatsApp/);
  } finally {
    globalThis.fetch = original;
  }
});

test('Mi cuenta cambia la contraseña guardando los tokens nuevos y descarga los datos', async () => {
  session('paciente');
  const original = globalThis.fetch;
  const originalUrl = { crear: URL.createObjectURL, liberar: URL.revokeObjectURL };
  const descargas = [];
  let cambio;
  URL.createObjectURL = (archivo) => { descargas.push(archivo); return 'blob:datos'; };
  URL.revokeObjectURL = () => {};
  const clicks = [];
  const clickOriginal = window.HTMLAnchorElement.prototype.click;
  window.HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
  const nuevo = tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora(), n: 3 });
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/perfil/password')) {
      cambio = { method: options.method, body: JSON.parse(options.body) };
      return response({ mensaje: 'Contraseña actualizada', rol: 'paciente', token: nuevo, refresh_token: 'refresco-nuevo' });
    }
    if (ruta.endsWith('/cuenta/exportar')) return response({ cuenta: { email: 'ana@test.local' } });
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Cambiar contraseña'));
    const formulario = document.querySelector('.mi-cuenta-form');
    await type(formulario.querySelector('input[name="actual"]'), 'clave-vieja');
    await type(formulario.querySelector('input[name="nueva"]'), 'corta');
    await type(formulario.querySelector('input[name="repetida"]'), 'corta');
    assert.equal(formulario.querySelector('input[name="nueva"]').minLength, 8);
    const enviar = () => act(async () => document.querySelector('.mi-cuenta-form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    ));
    await enviar();
    assert.match(document.querySelector('.mi-cuenta [role="alert"]').textContent, /al menos 8 caracteres/);
    assert.equal(cambio, undefined);
    await type(formulario.querySelector('input[name="nueva"]'), 'clave-nueva-1');
    await type(formulario.querySelector('input[name="repetida"]'), 'clave-nueva-1');
    await enviar();
    assert.deepEqual(cambio, { method: 'PUT', body: { password_actual: 'clave-vieja', password_nueva: 'clave-nueva-1' } });
    assert.equal(localStorage.getItem('token'), nuevo);
    assert.equal(localStorage.getItem('refresh_token'), 'refresco-nuevo');
    assert.match(document.body.textContent, /Tu contraseña se cambió/);
    await click(button('Descargar mis datos'));
    assert.equal(descargas.length, 1);
    assert.equal(descargas[0].type, 'application/json');
    assert.deepEqual(clicks, ['enfered-mis-datos.json']);
    assert.match(document.body.textContent, /descargamos el archivo/);
  } finally {
    globalThis.fetch = original;
    URL.createObjectURL = originalUrl.crear;
    URL.revokeObjectURL = originalUrl.liberar;
    window.HTMLAnchorElement.prototype.click = clickOriginal;
  }
});

test('eliminar la cuenta pide la contraseña, confirma, cierra la sesión y vuelve a la landing', async () => {
  session('paciente');
  localStorage.setItem('refresh_token', 'refresco');
  const original = globalThis.fetch;
  let borrado;
  let falla = true;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/api/cuenta') && options.method === 'DELETE') {
      borrado = JSON.parse(options.body);
      if (falla) return response({ error: 'La contraseña no es correcta' }, 400);
      return response({ mensaje: 'Tu cuenta se eliminó. Gracias por haber usado Enfered.', solicitudesCanceladas: 1 });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-paciente');
    await click(button('Eliminar mi cuenta'));
    const dialogo = document.querySelector('dialog.cuenta-dialogo');
    assert.equal(dialogo.open, true);
    assert.match(document.getElementById(dialogo.getAttribute('aria-labelledby')).textContent, /eliminar tu cuenta/);
    assert.match(document.getElementById(dialogo.getAttribute('aria-describedby')).textContent, /información de salud/);
    const enviar = () => act(async () => dialogo.querySelector('form').dispatchEvent(
      new window.Event('submit', { bubbles: true, cancelable: true }),
    ));
    await enviar();
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /Escribí tu contraseña/);
    await type(dialogo.querySelector('input[name="password"]'), 'mi-clave-1');
    await enviar();
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /Marcá la casilla/);
    assert.equal(borrado, undefined);
    await click(dialogo.querySelector('input[name="confirmar"]'));
    await enviar();
    // Una contraseña incorrecta (400) no cierra la sesión.
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /no es correcta/);
    assert.ok(localStorage.getItem('token'));
    falla = false;
    await enviar();
    assert.deepEqual(borrado, { password: 'mi-clave-1' });
    assert.equal(window.location.pathname, '/');
    assert.equal(localStorage.getItem('token'), null);
    assert.equal(localStorage.getItem('refresh_token'), null);
    assert.match(document.querySelector('.aviso-cuenta-eliminada').textContent, /Tu cuenta se eliminó/);
  } finally {
    globalThis.fetch = original;
  }
});

test('el administrador también tiene Mi cuenta en el panel', async () => {
  session('administrador');
  await mount('/admin');
  assert.match(document.body.textContent, /Mi cuenta/);
  assert.ok(button('Descargar mis datos'));
  await click(button('Eliminar mi cuenta'));
  assert.doesNotMatch(document.querySelector('dialog.cuenta-dialogo').textContent, /turnos pendientes/);
});

test('el enfermero elimina un horario después de confirmarlo', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  const horario = { id: 44, dia_semana: 'Sábado', hora_inicio: '08:00', hora_fin: '16:00', estado: 'Disponible' };
  let eliminado;
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/perfil/enfermero/horarios/44') && options.method === 'DELETE') {
      eliminado = ruta;
      return response({ mensaje: 'Horario eliminado', id: 44 });
    }
    if (ruta.endsWith('/perfil/enfermero/horarios')) return response([horario]);
    return original(url, options);
  };
  try {
    await mount('/perfil-enfermero');
    await click(button('Eliminar horario de Sábado'));
    assert.equal(eliminado, undefined);
    await click(button('No'));
    assert.ok(button('Eliminar horario de Sábado'));
    await click(button('Eliminar horario de Sábado'));
    await click(button('Sí, eliminar'));
    assert.match(eliminado, /\/api\/perfil\/enfermero\/horarios\/44$/);
    assert.match(document.body.textContent, /Todavía no agregaste horarios/);
    assert.match(document.body.textContent, /Eliminamos el horario del sábado/);
  } finally {
    globalThis.fetch = original;
  }
});

test('al registrarse entra sola y el inicio muestra lo que falta completar', async () => {
  const original = globalThis.fetch;
  const llamadas = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    llamadas.push(ruta);
    if (ruta.endsWith('/registro')) return response({ mensaje: 'Usuario registrado exitosamente' }, 201);
    if (ruta.endsWith('/login')) {
      return response({ token: tokenDePrueba({ sub: '1', rol: 'paciente', exp: enUnaHora() }), refresh_token: 'r', rol: 'paciente' });
    }
    if (ruta.endsWith('/perfil/paciente')) return response({ ...profile, telefono: null, direccion: null });
    return original(url, options);
  };
  try {
    await mount('/registro');
    const clave = document.querySelector('input[name="password"]');
    assert.equal(clave.minLength, 8);
    assert.match(document.getElementById(clave.getAttribute('aria-describedby')).textContent, /Al menos 8 caracteres/);
    await type(document.querySelector('input[name="nombre"]'), 'Ana Pérez');
    await type(document.querySelector('input[name="email"]'), 'ana@test.local');
    await type(clave, 'clave-segura');
    await click(document.querySelector('input[name="aceptaTerminos"]'));
    await submitForm();
    await esperar(20);
    assert.equal(window.location.pathname, '/home');
    assert.ok(llamadas.findIndex((r) => r.endsWith('/login')) > llamadas.findIndex((r) => r.endsWith('/registro')));
    assert.match(document.body.textContent, /Tu cuenta está lista/);
    const lista = document.querySelector('.completar-perfil');
    assert.ok(lista, 'Falta la lista Completá tu perfil');
    assert.deepEqual([...lista.querySelectorAll('li a')].map((a) => a.getAttribute('href')), ['/perfil-paciente', '/perfil-paciente']);
    assert.match(lista.textContent, /celular/);
    assert.match(lista.textContent, /dirección/);
  } finally {
    globalThis.fetch = original;
  }
});

test('si el inicio de sesión automático falla, el registro ofrece ir al login', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/registro')) return response({ mensaje: 'Usuario registrado exitosamente' }, 201);
    if (ruta.endsWith('/login')) return response({ error: 'Hiciste muchos intentos para entrar.' }, 429);
    return original(url, options);
  };
  try {
    await mount('/registro');
    await type(document.querySelector('input[name="nombre"]'), 'Ana Pérez');
    await type(document.querySelector('input[name="email"]'), 'ana@test.local');
    await type(document.querySelector('input[name="password"]'), 'clave-segura');
    await click(document.querySelector('input[name="aceptaTerminos"]'));
    await submitForm();
    assert.equal(window.location.pathname, '/registro');
    assert.match(document.body.textContent, /Ya sos parte de la red/);
    assert.ok(link('Ir a iniciar sesión'));
    assert.equal(localStorage.getItem('token'), null);
  } finally {
    globalThis.fetch = original;
  }
});

test('el inicio del enfermero lista teléfono, matrícula, horarios y explica la verificación', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const ruta = String(url);
    if (ruta.endsWith('/perfil/enfermero')) return response({ ...profile, matricula: 'PENDIENTE-1', estadoVerificacion: 'sin_cargar', telefono: '' });
    if (ruta.endsWith('/perfil/enfermero/horarios')) return response([]);
    return original(url, options);
  };
  try {
    await mount('/home');
    await esperar(20);
    const lista = document.querySelector('.completar-perfil');
    assert.ok(lista);
    assert.deepEqual(
      [...lista.querySelectorAll('li a')].map((a) => a.getAttribute('href')),
      ['/perfil-enfermero', '/perfil-enfermero', '/perfil-enfermero#horarios'],
    );
    assert.match(lista.textContent, /WhatsApp/);
    assert.match(lista.textContent, /matrícula/);
    assert.match(lista.textContent, /no aparece en la cartilla/);
  } finally {
    globalThis.fetch = original;
  }
});

test('la lista Completá tu perfil queda vacía cuando no falta nada', async () => {
  const { pendientesDelPerfil } = await import(pathToFileURL(resolve('.test-build/perfil.mjs')));
  assert.deepEqual(pendientesDelPerfil('paciente', { telefono: '261 555 1234', direccion: 'San Martín 123' }), []);
  assert.deepEqual(
    pendientesDelPerfil('paciente', { telefono: '123', direccion: 'No registrada' }).map(([clave]) => clave),
    ['telefono', 'direccion'],
  );
  assert.deepEqual(
    pendientesDelPerfil('enfermero', { telefono: '2615551234', matricula: 'MP-1', estadoVerificacion: 'verificada' }, [{ estado: 'Disponible' }]),
    [],
  );
  // Sin la lista de horarios no se marca como faltante.
  assert.deepEqual(pendientesDelPerfil('enfermero', { telefono: '2615551234', matricula: 'MP-1' }, null), []);
});

test('la recuperación avisa que el código llega por correo y pide 8 caracteres', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response({ mensaje: 'Solicitud procesada' });
  try {
    await mount('/recuperar-password');
    assert.doesNotMatch(document.body.textContent, /consola|Modo de prueba/);
    await type(document.querySelector('input[type="email"]'), 'ana@test.local');
    await submitForm();
    assert.match(document.body.textContent, /Te enviamos un código a tu correo\. Revisá también el correo no deseado\./);
    const clave = document.querySelector('input[type="password"]');
    assert.equal(clave.minLength, 8);
    assert.match(document.body.textContent, /Al menos 8 caracteres/);
  } finally {
    globalThis.fetch = original;
  }
});

test('la privacidad menciona Gemini, los correos, el contacto al aceptar y la cuenta descargable', async () => {
  await mount('/privacidad');
  const texto = document.body.textContent;
  assert.match(texto, /Google Gemini/);
  assert.match(texto, /encargado del tratamiento/);
  assert.match(texto, /no guarda ese texto/);
  assert.match(texto, /correos de aviso/);
  assert.match(texto, /solo cuando el profesional acepta su solicitud/);
  assert.match(texto, /descargar todos tus datos/);
  assert.match(texto, /guardada cifrada/);
});

test('la landing explica que el turno se pide en la app y se coordina por WhatsApp', async () => {
  await mount('/');
  const texto = document.body.textContent;
  assert.doesNotMatch(texto, /por teléfono o correo/);
  assert.doesNotMatch(texto, /Enfered te permite encontrarlo y acceder a sus datos de contacto/);
  assert.match(texto, /WhatsApp/);
  assert.match(texto, /Demo académica/);
});

// F4: panel de administración (matrículas con motivo, moderación de reseñas y auditoría).
function metricasCompletas(extra = {}) {
  return {
    total_usuarios: 12, pacientes: 8, enfermeros: 4, usuarios_suspendidos: 1,
    matriculas_pendientes: 1, total_solicitudes: 15,
    solicitudes_por_estado: { Pendiente: 3, Aceptada: 2, Rechazada: 1, Cancelada: 4, Realizada: 5, Vencida: 7 },
    resenas_denunciadas: 2,
    ...extra,
  };
}

test('el administrador rechaza una matrícula con motivo y aprueba solo después de confirmar', async () => {
  session('administrador');
  const original = globalThis.fetch;
  const puts = [];
  const pendiente = {
    idEnfermero: 7, usuarioId: 30, nombre: 'Laura', apellido: 'Gómez', email: 'laura@test.local',
    matricula: 'MP-123', especialidad: 'Curaciones', estadoVerificacion: 'pendiente',
    motivoRechazo: 'La foto del DNI no se lee', verificadoEn: '2026-10-01T13:00:00Z', verificadoPor: 1,
  };
  const otra = { idEnfermero: 8, usuarioId: 31, nombre: 'Pedro', apellido: 'Ruiz', email: 'pedro@test.local', matricula: 'MP-9' };
  let lista = [pendiente, otra];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    requests.push({ url: ruta, options });
    if (ruta.includes('/admin/metricas')) return response(metricasCompletas());
    if (ruta.includes('/admin/enfermeros/pendientes')) return response({ enfermeros: lista });
    if (ruta.includes('/matricula') && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      puts.push({ ruta, body });
      const id = Number(ruta.match(/enfermeros\/(\d+)\//)[1]);
      lista = lista.filter((item) => item.idEnfermero !== id);
      return response({
        mensaje: 'Verificación actualizada',
        enfermero: body.verificado
          ? { idEnfermero: id, verificado: true, estadoVerificacion: 'verificada', motivoRechazo: null, verificadoEn: '2026-10-22T15:00:00Z', verificadoPor: 1, turnosCancelados: 0 }
          : { idEnfermero: id, verificado: false, estadoVerificacion: 'rechazada', motivoRechazo: body.motivo, verificadoEn: '2026-10-22T15:00:00Z', verificadoPor: 1, turnosCancelados: 1 },
      });
    }
    return original(url, options);
  };
  try {
    await mount('/admin');
    await esperar(20);
    const texto = document.body.textContent;
    assert.match(texto, /Solicitudes por estado/);
    assert.match(texto, /Vencidas sin respuesta7/);
    assert.match(texto, /Hay 2 reseñas denunciadas esperando que la revises/);
    assert.ok(document.querySelector('a[href="/admin/resenas?filtro=denunciadas"]'));
    // Revisión anterior: motivo del rechazo y quién la hizo.
    const tarjeta = document.querySelector('.admin-pending-card');
    assert.match(tarjeta.textContent, /Rechazo anterior: La foto del DNI no se lee/);
    assert.match(tarjeta.textContent, /Última revisión: .*2026.* por vos/);

    await click(button('Rechazar'));
    const dialogo = document.querySelector('dialog.admin-motivo-dialog');
    assert.equal(dialogo.open, true);
    assert.match(dialogo.textContent, /¿Rechazar esta matrícula\?/);
    assert.match(dialogo.textContent, /Laura Gómez no va a aparecer en la búsqueda/);
    const titulo = dialogo.querySelector('h2');
    assert.equal(dialogo.getAttribute('aria-labelledby'), titulo.id);
    await typeTextArea(dialogo.querySelector('textarea'), ' mal ');
    await enviarFormulario(dialogo.querySelector('form'));
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /entre 5 y 300 caracteres/);
    assert.equal(puts.length, 0);

    await typeTextArea(dialogo.querySelector('textarea'), '  El número de matrícula no coincide con el colegio.  ');
    await enviarFormulario(dialogo.querySelector('form'));
    await esperar(20);
    assert.equal(puts.length, 1);
    assert.match(puts[0].ruta, /\/api\/admin\/enfermeros\/7\/matricula$/);
    assert.deepEqual(puts[0].body, { verificado: false, motivo: 'El número de matrícula no coincide con el colegio.' });
    assert.equal(dialogo.open, false);
    const aviso = document.querySelector('.notice-success').textContent;
    assert.match(aviso, /Matrícula de Laura Gómez rechazada/);
    assert.match(aviso, /Motivo: El número de matrícula no coincide con el colegio\./);
    assert.match(aviso, /Se canceló 1 turno y avisamos a los pacientes/);
    assert.doesNotMatch(document.querySelector('.admin-pending-list').textContent, /Laura Gómez/);

    // Aprobar también pide confirmación y no lleva motivo.
    await click(button('Aprobar matrícula'));
    assert.equal(dialogo.open, true);
    assert.match(dialogo.textContent, /¿Aprobar esta matrícula\?/);
    assert.equal(dialogo.querySelector('textarea'), null);
    await click(button('Volver'));
    assert.equal(dialogo.open, false);
    assert.equal(puts.length, 1);
    await click(button('Aprobar matrícula'));
    await click(button('Sí, aprobar'));
    await esperar(20);
    assert.deepEqual(puts[1].body, { verificado: true });
    assert.match(document.querySelector('.notice-success').textContent, /Matrícula de Pedro Ruiz aprobada/);
  } finally {
    globalThis.fetch = original;
  }
});

test('el administrador oculta una reseña denunciada con motivo y filtra las ocultas', async () => {
  session('administrador');
  const original = globalThis.fetch;
  const resena = {
    idResena: 41, idSolicitud: 9, puntuacion: 1, comentario: 'Llegó tarde y fue grosera.', fecha: '2026-10-20T12:00:00Z',
    paciente: 'Ana P.', enfermero: { idEnfermero: 7, usuarioId: 30, nombre: 'Laura', apellido: 'Gómez' },
    oculta: false, motivoOcultamiento: null, denunciada: true, motivoDenuncia: 'Nunca atendí a esta paciente', denunciaPendiente: true,
  };
  const soloEstrellas = { ...resena, idResena: 42, puntuacion: 5, comentario: '', denunciada: false, motivoDenuncia: null, denunciaPendiente: false };
  const puts = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    requests.push({ url: ruta, options });
    if (ruta.includes('/admin/resenas/41/visibilidad') && options.method === 'PUT') {
      const body = JSON.parse(options.body);
      puts.push(body);
      return response({
        mensaje: 'Reseña oculta',
        resena: { ...resena, oculta: true, motivoOcultamiento: body.motivo, denunciaPendiente: false },
        calificacionPromedio: 4.5,
        cantidadResenas: 3,
      });
    }
    if (ruta.includes('/admin/resenas')) {
      return response({ resenas: [resena, soloEstrellas], total_resultados: 2, total_paginas: 1, denunciadas_pendientes: 1 });
    }
    return original(url, options);
  };
  try {
    await mount('/admin/resenas?filtro=denunciadas');
    await esperar(20);
    assert.equal(document.title, 'Moderación de reseñas · Enfered');
    assert.ok(requests.some((r) => r.url.includes('/api/admin/resenas?filtro=denunciadas&page=1&per_page=10')));
    assert.equal(button('Denunciadas').getAttribute('aria-pressed'), 'true');
    const tarjetas = () => [...document.querySelectorAll('.admin-review-card')];
    assert.match(tarjetas()[0].textContent, /Denuncia sin revisar/);
    assert.match(tarjetas()[0].textContent, /Sobre Laura Gómez/);
    assert.match(tarjetas()[0].textContent, /De Ana P\./);
    assert.match(tarjetas()[0].textContent, /Llegó tarde y fue grosera\./);
    assert.match(tarjetas()[0].textContent, /Motivo de la denuncia: Nunca atendí a esta paciente/);
    assert.equal(tarjetas()[0].querySelector('[role="img"]').getAttribute('aria-label'), '1,0 de 5 estrellas');
    assert.match(tarjetas()[1].textContent, /Solo dejó estrellas, sin comentario\./);
    assert.match(document.body.textContent, /1 denuncia sin revisar/);

    await click(tarjetas()[0].querySelector('.button-primary'));
    const dialogo = document.querySelector('dialog.admin-motivo-dialog');
    assert.equal(dialogo.open, true);
    assert.match(dialogo.textContent, /¿Ocultar esta reseña\?/);
    await enviarFormulario(dialogo.querySelector('form'));
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /Escribí por qué ocultás la reseña/);
    assert.equal(puts.length, 0);
    await typeTextArea(dialogo.querySelector('textarea'), ' Insulta a la profesional. ');
    await enviarFormulario(dialogo.querySelector('form'));
    await esperar(20);
    assert.deepEqual(puts, [{ oculta: true, motivo: 'Insulta a la profesional.' }]);
    assert.equal(dialogo.open, false);
    assert.match(tarjetas()[0].textContent, /Oculta/);
    assert.match(tarjetas()[0].textContent, /Por qué se ocultó: Insulta a la profesional\./);
    assert.ok([...tarjetas()[0].querySelectorAll('button')].some((b) => b.textContent === 'Volver a mostrar'));
    assert.match(document.querySelector('.notice-success').textContent, /El promedio de Laura Gómez ahora es 4,5 \(3 reseñas\)/);
    assert.match(document.body.textContent, /Sin denuncias por revisar/);

    await click(button('Ocultas'));
    await esperar(20);
    assert.equal(window.location.search, '?filtro=ocultas');
    assert.ok(requests.some((r) => r.url.includes('/api/admin/resenas?filtro=ocultas&page=1')));
  } finally {
    globalThis.fetch = original;
  }
});

test('la auditoría lista las acciones de los administradores, pagina y filtra', async () => {
  session('administrador');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    requests.push({ url: ruta, options });
    if (ruta.includes('/admin/auditoria')) {
      const pagina = Number(new URL(ruta).searchParams.get('page'));
      return response({
        registros: [{
          idAuditoria: pagina === 2 ? 3 : 10, idAdmin: 1, adminEmail: 'admin@enfered.test',
          accion: pagina === 2 ? 'suspender_usuario' : 'rechazar_matricula',
          tipoObjetivo: pagina === 2 ? 'usuario' : 'enfermero', idObjetivo: 7,
          detalle: 'Matrícula MP-123; turnos cancelados: 0; motivo: no coincide', fecha: '2026-10-22T15:30:00Z',
        }],
        total_resultados: 21,
        total_paginas: 2,
      });
    }
    return original(url, options);
  };
  try {
    await mount('/admin');
    await esperar(20);
    await click(document.querySelector('a[href="/admin/auditoria"]'));
    await esperar(20);
    assert.equal(window.location.pathname, '/admin/auditoria');
    assert.equal(document.title, 'Auditoría · Enfered');
    assert.ok(document.querySelector('a[href="/admin/resenas"]'));
    assert.ok(requests.some((r) => r.url.includes('/api/admin/auditoria?page=1&per_page=20')));
    const item = document.querySelector('.admin-audit-item');
    assert.match(item.textContent, /Rechazó una matrícula/);
    assert.match(item.textContent, /Por admin@enfered\.test · Profesional N\.º 7/);
    assert.match(item.textContent, /motivo: no coincide/);
    assert.equal(item.querySelector('time').getAttribute('datetime'), '2026-10-22T15:30:00Z');
    assert.match(document.body.textContent, /21 registros/);

    await click(button('Siguiente'));
    await esperar(20);
    assert.ok(requests.some((r) => r.url.includes('/api/admin/auditoria?page=2')));
    assert.match(document.querySelector('.admin-audit-item').textContent, /Suspendió una cuenta/);
    assert.match(document.body.textContent, /Página 2 de 2/);

    await elegir(document.querySelector('.admin-audit-filter select'), 'ocultar_resena');
    await esperar(20);
    assert.ok(requests.some((r) => r.url.includes('/api/admin/auditoria?page=1&per_page=20&accion=ocultar_resena')));
  } finally {
    globalThis.fetch = original;
  }
});

test('si el backend no deja suspender a otro administrador se muestra su mensaje', async () => {
  session('administrador');
  const original = globalThis.fetch;
  const otroAdmin = { id: 5, nombre: null, apellido: null, email: 'otra@enfered.test', rol: 'administrador', suspendido: false };
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/api/admin/usuarios/5/suspension') && options.method === 'PUT') {
      return response({ error: 'Solo un administrador con permiso total puede suspender o reactivar a otro administrador' }, 403);
    }
    if (String(url).includes('/api/admin/usuarios')) {
      return response({ usuarios: [otroAdmin], total_resultados: 1, total_paginas: 1 });
    }
    return original(url, options);
  };
  try {
    await mount('/admin/usuarios');
    await esperar(300);
    await click(button('Suspender'));
    const dialogo = document.querySelector('dialog');
    assert.match(dialogo.textContent, /Es una cuenta de administrador/);
    await click(button('Sí, suspender'));
    await esperar(20);
    assert.equal(dialogo.open, true);
    assert.match(dialogo.querySelector('[role="alert"]').textContent, /Solo un administrador con permiso total puede suspender o reactivar a otro administrador/);
    assert.ok(localStorage.getItem('token'));
    assert.equal(window.location.pathname, '/admin/usuarios');
  } finally {
    globalThis.fetch = original;
  }
});

// SCRUM-14/53 y SCRUM-30/50: servicios que ofrece cada profesional y catálogo del administrador.
const CATALOGO = [
  { idServicio: 301, tipoServicio: 'Curaciones', descripcion: 'Heridas', precioEstimado: '8500.00', duracionMinutos: 60, activo: true },
  { idServicio: 302, tipoServicio: 'Inyecciones', descripcion: null, precioEstimado: '6000.00', duracionMinutos: 30, activo: true },
];

test('la cartilla filtra por tipo de servicio y muestra qué ofrece cada profesional', async () => {
  session('paciente');
  const original = globalThis.fetch;
  const busquedas = [];
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/api/servicios')) return response(CATALOGO);
    if (ruta.includes('/enfermeros/buscar')) {
      busquedas.push(new URL(ruta).searchParams);
      return response({
        enfermeros: [{ id: 5, usuario_id: 5, nombre: 'Laura', disponible: true,
          servicios: [{ idServicio: 301, tipoServicio: 'Curaciones' }, { idServicio: 302, tipoServicio: 'Inyecciones' }] }],
        total_resultados: 1, total_paginas: 1,
      });
    }
    return original(url, options);
  };
  try {
    await mount('/cartilla');
    await esperar(300);
    const filtro = document.querySelector('#desktop-servicio');
    assert.ok(filtro, 'Falta el filtro por servicio');
    assert.deepEqual([...filtro.options].map((opcion) => opcion.textContent), ['Todos los servicios', 'Curaciones', 'Inyecciones']);
    assert.match(document.querySelector('.card-services').textContent, /Ofrece: Curaciones, Inyecciones/);
    await elegir(filtro, '302');
    await esperar(300);
    assert.equal(busquedas.at(-1).get('servicio'), '302');
    assert.ok(button('Quitar filtro Inyecciones'));
  } finally {
    globalThis.fetch = original;
  }
});

test('el enfermero elige en su perfil los servicios que ofrece', async () => {
  session('enfermero');
  const original = globalThis.fetch;
  let enviado;
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (ruta.endsWith('/api/servicios')) return response(CATALOGO);
    if (ruta.endsWith('/perfil/enfermero')) {
      if (options.method === 'PUT') {
        enviado = JSON.parse(options.body);
        return response({ ...profile, rol: 'enfermero', servicios: CATALOGO.filter((s) => enviado.servicios.includes(s.idServicio)) });
      }
      return response({ ...profile, rol: 'enfermero', telefono: '', servicios: [{ idServicio: 301, tipoServicio: 'Curaciones' }] });
    }
    return original(url, options);
  };
  try {
    await mount('/perfil-enfermero');
    await esperar(50);
    assert.match(document.body.textContent, /Servicios que ofrecésCuraciones/);
    await click(button('Editar'));
    const opciones = [...document.querySelectorAll('.services-offered input[type="checkbox"]')];
    assert.deepEqual(opciones.map((opcion) => opcion.checked), [true, false]);
    await click(opciones[1]);
    await click(button('Guardar'));
    await esperar(20);
    assert.deepEqual(enviado.servicios, [301, 302]);
    assert.match(document.body.textContent, /Servicios que ofrecésCuraciones, Inyecciones/);
  } finally {
    globalThis.fetch = original;
  }
});

test('el administrador agrega servicios, los edita y los da de baja', async () => {
  session('administrador');
  const original = globalThis.fetch;
  const pedidos = [];
  const conUso = (servicio) => ({ enfermerosQueLoOfrecen: 0, solicitudes: 0, ...servicio });
  globalThis.fetch = async (url, options = {}) => {
    const ruta = String(url);
    if (!ruta.includes('/admin/servicios')) return original(url, options);
    if (!options.method || options.method === 'GET') {
      return response({ servicios: CATALOGO.map((servicio) => conUso({ ...servicio, enfermerosQueLoOfrecen: 2 })) });
    }
    const body = JSON.parse(options.body);
    pedidos.push({ ruta, metodo: options.method, body });
    if (options.method === 'POST') {
      return response({ mensaje: 'Servicio creado', servicio: conUso({ idServicio: 303, activo: true, ...body }) }, 201);
    }
    const actual = CATALOGO.find((servicio) => ruta.endsWith(`/${servicio.idServicio}`));
    return response({
      mensaje: body.activo === false ? 'Servicio dado de baja' : 'Servicio actualizado',
      servicio: conUso({ ...actual, ...body }),
    });
  };
  try {
    await mount('/admin/servicios');
    await esperar(50);
    assert.equal(document.title, 'Servicios · Enfered');
    assert.ok(document.querySelector('a[href="/admin/servicios"]'), 'Falta el acceso en el menú');
    assert.match(document.querySelector('.admin-service').textContent, /Profesionales que lo ofrecen2/);

    await click(button('Agregar servicio'));
    await type(document.querySelector('input[name="tipoServicio"]'), 'Nebulizaciones');
    await type(document.querySelector('input[name="precioEstimado"]'), '4500');
    await type(document.querySelector('input[name="duracionMinutos"]'), '30');
    await enviarFormulario(document.querySelector('.admin-service-form'));
    await esperar(20);
    assert.deepEqual(pedidos[0], { ruta: pedidos[0].ruta, metodo: 'POST',
      body: { tipoServicio: 'Nebulizaciones', descripcion: '', precioEstimado: '4500', duracionMinutos: 30 } });
    assert.match(document.querySelector('.notice-success').textContent, /Servicio creado: Nebulizaciones/);

    await click(document.querySelectorAll('.admin-service')[0].querySelector('button'));
    await type(document.querySelector('input[name="precioEstimado"]'), '');
    await enviarFormulario(document.querySelector('.admin-service-form'));
    await esperar(20);
    assert.equal(pedidos[1].metodo, 'PUT');
    assert.equal(pedidos[1].body.precioEstimado, null, 'Precio vacío = "A consultar"');

    await click(button('Dar de baja'));
    const dialogo = document.querySelector('dialog');
    assert.equal(dialogo.open, true);
    assert.match(dialogo.textContent, /Los pacientes ya no lo van a poder pedir/);
    await enviarFormulario(dialogo.querySelector('form'));
    await esperar(20);
    assert.deepEqual(pedidos[2].body, { activo: false });
    assert.match(document.body.textContent, /Dado de baja/);
  } finally {
    globalThis.fetch = original;
  }
});

test('al pedir un turno solo se ofrecen los servicios que hace ese profesional', async () => {
  session('paciente');
  const servicios = (seleccion) => [...document.querySelectorAll('select[name="idServicio"] option')]
    .map((opcion) => opcion.textContent.split(' · ')[0]).slice(1, seleccion);
  for (const [ofrecidos, esperado] of [
    [[{ idServicio: 302, tipoServicio: 'Inyecciones' }], ['Inyecciones']],
    [[], ['Curaciones', 'Inyecciones']],  // Sin servicios declarados: todo el catálogo.
  ]) {
    solicitudHandler = async (config) => {
      if (config.url === '/usuarios/21') return { data: { id: 21, enfermero_id: 201, nombre: 'Laura', rol: 'enfermero',
        verificado: true, disponible: true, servicios: ofrecidos } };
      if (config.url === '/servicios') return { data: CATALOGO };
      throw new Error(`Petición inesperada: ${config.method} ${config.url}`);
    };
    await mount('/perfil/21/solicitar');
    await esperar(50);
    assert.deepEqual(servicios(), esperado);
    await act(async () => root.unmount());
    root = null;
  }
});
