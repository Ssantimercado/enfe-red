import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

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
window.scrollTo = () => {};
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
    loader: { '.png': 'file' },
    define: { 'import.meta.env.VITE_API_URL': 'undefined' },
  });
  App = (await import(pathToFileURL(resolve('.test-build/app.mjs')))).default;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  localStorage.clear();
  requests = [];
});

after(() => dom.window.close());

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

test('cerrar sesión elimina también los datos del usuario', async () => {
  session();
  localStorage.setItem('usuario', '{"nombre":"Ana"}');
  await mount('/home');
  await click(button('Cerrar Sesión'));
  assert.equal(window.location.pathname, '/login');
  assert.equal(localStorage.length, 0);
});
