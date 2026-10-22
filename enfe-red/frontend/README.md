# Frontend de Enfered

Único proyecto React/Vite de la aplicación. El código que se ejecuta está en
`src/`; `index.html` carga `src/main.jsx`, que monta `App.jsx`.

Consultar el [README general](../../README.md) para instalación, backend,
configuración, contratos, ramas y estado del proyecto.

## Organización

- `src/App.jsx`: rutas, sesión y restricciones de navegación por rol.
- `src/api.js`: URL del backend, clientes HTTP, JWT y respuestas 401.
- `src/components/`: pantallas y componentes funcionales.
- `src/components/ui/`: componentes compartidos de presentación.
- `src/assets/`: imágenes; `public/`: archivos servidos directamente.
- `src/App.css`, `src/index.css` y CSS de componentes: estilos.
- `tests/navigation.test.mjs`: pruebas de navegación con Node/JSDOM.

No crear `frontend/frontend/`. El registro activo es
`src/components/Register.jsx`; los horarios activos están en
`src/components/GestionHorarios.jsx`. Las copias antiguas desconectadas se
retiraron y permanecen recuperables en el historial Git.

## Comandos desde esta carpeta

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

La API predeterminada está en `http://localhost:5000`. Opcionalmente copiar
`.env.example` a `.env` y configurar `VITE_API_URL` sin `/api` al final.
Backend y frontend se ejecutan en terminales separadas.

`node_modules/`, `dist/` y `.test-build/` son generados y no se versionan.
Para integrar las solicitudes, leer el [contrato de Sprint 4](../../docs/sprint-4-santiago.md).
