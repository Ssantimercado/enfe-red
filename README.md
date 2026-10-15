# Enfe-red

Aplicación académica de Práctica Profesionalizante 3 para conectar pacientes
con profesionales de enfermería. Permite registrarse, administrar perfiles,
consultar disponibilidad y buscar profesionales en una cartilla y un mapa.
El backend de solicitudes de Santiago incorpora la creación de pedidos y la
consulta de sus comprobantes y estados.

Esta guía describe la entrega de `Santiago` para la rama compartida `Prueba` al
**15 de octubre de 2026**. El alcance revisado comprende **Sprint 1, Sprint 2,
Sprint 3 y exclusivamente SCRUM-56/57/58 del backend de Santiago en Sprint 4**.
Las tareas de los demás integrantes del Sprint 4 y los sprints siguientes no
se evalúan como entregas pendientes de esta revisión.

## Guías para el equipo

- [Diseño y navegación: reglas para mantener la misma interfaz](docs/diseno-y-navegacion.md).
- [Contexto para asistentes y colaboradores](AGENTS.md).
- [Comparación con el PDF: sprints 1 a 3 y Sprint 4 de Santiago](docs/comparacion-sprints-1-4.md).
- [Contrato y ejemplos de la API de solicitudes](docs/sprint-4-santiago.md).
- [Mapa de ramas y estado de integración](#ramas-y-estado-de-integración).
- [Instalación y ejecución local](#instalación-y-ejecución-local).

**Para una IA que reciba este repositorio:** leer esta guía, la comparación y
el contrato antes de proponer cambios. Comprobar siempre `git status` y la rama
actual. Una funcionalidad mencionada en el PDF o en otra rama no necesariamente
está integrada en la copia que se está ejecutando.

## Estructura del repositorio

Hay **un backend y un frontend**. Se conserva el directorio histórico
`enfe-red/` para mantener las rutas que usa el equipo. La raíz del repositorio
contiene esta guía y la documentación; no es un proyecto npm.

```text
enfe-red/                         # Raíz del repositorio Git
├── README.md                     # Guía general y punto de entrada
├── .gitignore
├── docs/
│   ├── comparacion-sprints-1-4.md # Alcance, evidencias y diferencias con el PDF
│   ├── sprint-4-santiago.md      # Contrato detallado de solicitudes
│   └── historial/
│       ├── README.md
│       └── diferencias.txt       # Informe antiguo; no describe el estado actual
└── enfe-red/                     # Directorio histórico de la aplicación
    ├── README.md                 # Enlace a la guía general
    ├── backend/
    │   ├── app.py                # Configuración, extensiones y Blueprints
    │   ├── database.py           # Instancia compartida de SQLAlchemy
    │   ├── extensions.py         # Instancia compartida de Bcrypt
    │   ├── requirements.txt      # Dependencias Python
    │   ├── .env.example          # Plantilla; .env real es local
    │   ├── models/
    │   │   ├── usuario_models.py # Usuario, Paciente, Enfermero, Disponibilidad
    │   │   ├── servicio_models.py
    │   │   └── solicitud_models.py
    │   ├── routes/
    │   │   ├── usuario_routes.py # Registro, login, perfiles, horarios, búsqueda
    │   │   ├── auth_routes.py    # Recuperación de contraseña local
    │   │   └── solicitud_routes.py
    │   ├── seed_sprint3.py       # Ajustes de esquema y profesionales de demo
    │   ├── schema_sprint4.py     # Tablas de solicitudes y campo verificado
    │   └── tests/
    │       ├── test_current_flows.py
    │       └── test_solicitudes.py
    └── frontend/
        ├── README.md
        ├── package.json         # Comandos npm y dependencias del único frontend
        ├── package-lock.json    # Versiones instalables con npm ci
        ├── .env.example
        ├── index.html           # Carga src/main.jsx
        ├── vite.config.js
        ├── eslint.config.js
        ├── public/              # Recursos servidos directamente
        ├── src/
        │   ├── main.jsx         # Monta React
        │   ├── App.jsx          # Rutas y protección de sesión/rol
        │   ├── api.js           # URL de API, clientes HTTP y sesión
        │   ├── App.css          # Estilos de la interfaz
        │   ├── index.css        # Estilos globales
        │   ├── assets/          # Imágenes; landing y procedencia de recursos
        │   └── components/
        │       ├── ui/          # Avatar, marca, iconos y skeletons compartidos
        │       └── ...          # Pantallas y componentes descritos abajo
        └── tests/
            └── navigation.test.mjs
```

`node_modules/`, `dist/`, `.test-build/`, `venv/`, `__pycache__/` y las bases
locales en `backend/instance/` son archivos generados o privados de cada máquina.
Pueden existir en disco, pero no forman parte del código a compartir.

La carpeta antigua `frontend/frontend/` tenía dos componentes sin importar
desde la aplicación. Se retiró esa copia: el registro activo es
`frontend/src/components/Register.jsx` y los horarios se gestionan en
`frontend/src/components/GestionHorarios.jsx`. El lockfile suelto de la raíz
tampoco pertenecía a una aplicación activa; el lockfile válido está en
`enfe-red/frontend/`.

## Dónde trabajar según la tarea

| Necesidad | Archivo o carpeta dentro de `enfe-red/` |
| --- | --- |
| Agregar una pantalla y su navegación | `frontend/src/App.jsx` y `frontend/src/components/` |
| Landing pública | `frontend/src/components/Landing.jsx`, `Landing.css`, `src/assets/landing/` |
| Login, registro y recuperación | `Login.jsx`, `Register.jsx`, `RecuperarPassword.jsx`, `AuthLayout.jsx` en `frontend/src/components/` |
| Navegación interna y sesión | `frontend/src/components/AppShell.jsx`, `Home.jsx`, `frontend/src/App.jsx` y `api.js` |
| Mi perfil | `PerfilPaciente.jsx` y `PerfilEnfermero.jsx`, que reutilizan `ProfileEditor.jsx` |
| Horarios del enfermero | `frontend/src/components/GestionHorarios.jsx` y `backend/routes/usuario_routes.py` |
| Buscador, filtros y tarjetas | `frontend/src/components/ListaEnfermeros.jsx` y `DirectoryFilters.jsx` |
| Mapa y rutas por calles | `frontend/src/components/MapaEnfermeros.jsx` |
| Selección de la ubicación del profesional | `frontend/src/components/LocationPicker.jsx`, usado por `ProfileEditor.jsx` |
| Perfil de un profesional y contacto | `frontend/src/components/VerPerfiles.jsx` y `ProfessionalContact.jsx` |
| Cambiar datos persistidos | `backend/models/` y la preparación del esquema correspondiente |
| Agregar endpoints | `backend/routes/`; registrar nuevos Blueprints en `backend/app.py` |
| Contrato de solicitudes | `backend/models/solicitud_models.py` y `backend/routes/solicitud_routes.py` |
| Pruebas de regresión | `backend/tests/` y `frontend/tests/` |

No todos los archivos históricos de `components/` se montan en la app. Para
identificar el componente activo, seguir los imports desde `main.jsx` y
`App.jsx`; la barra actual es `AppShell.jsx`, no una segunda aplicación.

## Cómo funciona

```text
Navegador: React + React Router
    -> src/api.js: HTTP + token de sesión
    -> Flask: /api/*, validación y permisos
    -> SQLAlchemy: modelos y consultas
    -> Base de datos configurada con DATABASE_URL

Mapa: navegador -> geolocalización + Leaflet/OpenStreetMap + rutas OSRM
```

### Frontend y recorrido del usuario

La landing (`/`) explica el producto y permite ir a registro o login. Las
reseñas de esa pantalla están identificadas como demostraciones académicas;
no provienen de valoraciones guardadas por pacientes.

Después del login, `/home` muestra el inicio interno. El paciente puede editar
su perfil, abrir `/cartilla`, buscar, filtrar y ver el perfil de un profesional.
El enfermero puede editar sus datos, su disponibilidad general y agregar franjas
semanales de atención. Puede elegir o quitar su punto en el mapa al editar el
perfil. Cambiar dirección/ciudad descarta las coordenadas anteriores para evitar
publicar una ubicación desactualizada. El contacto actual se ofrece desde el perfil profesional.
El formulario de solicitudes del Sprint 4 no está integrado en este frontend.

| Ruta de pantalla | Acceso y función |
| --- | --- |
| `/` | Pública; landing |
| `/login`, `/registro`, `/recuperar-password` | Flujos de autenticación |
| `/home` | Usuario con sesión |
| `/perfil-paciente` | Paciente; perfil propio |
| `/perfil-enfermero` | Enfermero; perfil propio y horarios |
| `/cartilla` | Usuario con sesión; búsqueda/listado/mapa |
| `/perfil/:id` | Usuario con sesión; perfil profesional identificado por **Usuario.id** |

`api.js` centraliza `VITE_API_URL`, el manejo de respuestas y el cierre de
sesión ante HTTP 401. `requestApi('/enfermeros')` construye
`<VITE_API_URL>/api/enfermeros` y adjunta el Bearer token si existe. También
hay un cliente Axios y un wrapper de fetch para componentes existentes.
El JWT se guarda en `localStorage`; el frontend comprueba expiración y rol para
la navegación, y el backend verifica el token en las rutas protegidas.

### Backend, modelos e identificadores

Se usa Flask con Blueprints, Flask-SQLAlchemy, Flask-JWT-Extended y Bcrypt.
El frontend usa React 19, React Router 7 y Vite 5; el mapa usa React Leaflet.
Las versiones exactas están en los manifests y lockfiles, no en este resumen.

| Modelo / tabla | Responsabilidad y relaciones |
| --- | --- |
| `Usuario` / `usuarios` | Email, hash de contraseña y rol (`paciente` o `enfermero`). |
| `Paciente` / `pacientes` | Perfil asociado por `usuario_id` único. |
| `Enfermero` / `enfermeros` | Perfil, matrícula, especialidad, tarifa, disponibilidad, verificación y coordenadas; `usuario_id` único. |
| `Disponibilidad` / `disponibilidades` | Franjas por día de semana de un enfermero. |
| `Servicio` / `servicios` | Catálogo mínimo: tipo y precio estimado decimal. |
| `SolicitudServicio` / `solicitudes_servicio` | Un paciente, un enfermero, un servicio, fecha/hora, dirección y estado. |

En el código actual `Paciente` y `Enfermero` son modelos separados, vinculados
uno a uno con `Usuario`; no heredan de esa clase Python. El PDF representa
herencia conceptual y describe polimorfismo: esta diferencia está registrada
en la comparación para acordarla con la cátedra, no se cambió la arquitectura.

**No confundir los IDs:** el JWT identifica a `Usuario`. En los resultados de
enfermeros, `id`/`usuario_id` identifican al usuario; `enfermero_id`/`idEnfermero`
identifican al perfil. Las solicitudes usan `idPaciente` e `idEnfermero` del
perfil, junto con `idServicio` del catálogo. El precio estimado del pedido se
toma de `Servicio`; no es automáticamente la tarifa por hora del profesional.

### API existente

Todos los endpoints de esta tabla tienen el prefijo `/api`.

| Método y ruta | Función / acceso |
| --- | --- |
| `POST /registro` | Crea usuario y perfil de paciente o enfermero. |
| `POST /login` | Devuelve token y rol. |
| `POST /recuperar-password` | Genera código de recuperación **local**, no envía correo. |
| `POST /reset-password` | Valida código y actualiza contraseña. |
| `GET`, `PUT /perfil/paciente` | Consulta/edición del perfil propio con JWT. |
| `GET`, `PUT /perfil/enfermero` | Consulta/edición del perfil propio con JWT. |
| `GET`, `POST /perfil/enfermero/horarios` | Lista/agrega franjas del enfermero autenticado. |
| `GET /enfermeros` | Listado público con perfiles y horarios. |
| `GET /enfermeros/buscar` | Búsqueda pública filtrada y paginada. |
| `GET /usuarios/<id>` | Datos de usuario y perfil profesional, con JWT; `id` es Usuario.id. |
| `GET /usuarios/<id>/horarios` | Horarios del profesional, con JWT; `id` es Usuario.id. |
| `POST /solicitudes` | Paciente autenticado: crea pedido Pendiente. |
| `GET /solicitudes/<idSolicitud>` | Dueño o enfermero destinatario: comprobante. |
| `GET /solicitudes/paciente/<idPaciente>` | Ese paciente: pedidos Pendiente/Aceptada. |
| `GET /solicitudes/enfermero/<idEnfermero>` | Ese enfermero: pedidos recibidos de todos los estados. |

La búsqueda admite `q`, `especialidad`, `ciudad`, `precio_min`, `precio_max`,
`disponible`, `dia_semana`, `page` y `per_page`. Devuelve
`{ pagina_actual, por_pagina, total_resultados, total_paginas, enfermeros }`.
El filtro textual busca nombre, apellido, especialidad, ciudad y dirección.
La cartilla pide seis resultados por página. No hay filtro por `idServicio`,
radio geográfico ni ordenamiento por distancia en esa API.

El mapa solicita la ubicación al navegador y consulta OSRM para el recorrido
entre el paciente y el profesional seleccionado. La distancia de ese recorrido
no se calcula en Flask ni se añade a todas las tarjetas de búsqueda.

## Instalación y ejecución local

Los comandos siguientes son para PowerShell y parten de la **raíz del repo**,
donde están `.git` y este README. Ejecutar backend y frontend en terminales
separadas. No ejecutar `npm install` en la raíz: el único `package.json` de la
app está en `enfe-red/frontend/`.

Requisitos: Python 3.13 (entorno usado por el equipo), Node.js/npm compatibles
con `frontend/package.json` y MySQL con una base local. La conexión se obtiene
de `DATABASE_URL` mediante SQLAlchemy; los tests utilizan SQLite en memoria.

### 1. Backend

```powershell
cd .\enfe-red\backend
py -3.13 -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

Crear `venv` solo si no existe; si ya está preparado, usar su ejecutable.
Con MySQL iniciado, crear una base vacía desde el cliente SQL:

```sql
CREATE DATABASE IF NOT EXISTS enfe_red CHARACTER SET utf8mb4;
```

Copiar la plantilla solo si todavía no hay `.env`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Editar `.env` con una conexión propia y un secreto JWT local. La plantilla
contiene placeholders: no funciona hasta reemplazarlos. Se puede generar el
secreto con `.\venv\Scripts\python.exe -c "import secrets; print(secrets.token_hex(32))"`.

- `DATABASE_URL`: `mysql+pymysql://USUARIO:CLAVE@localhost:3306/enfe_red`.
  Los caracteres especiales del usuario/clave deben estar codificados para URL.
- `JWT_SECRET_KEY`: secreto aleatorio de al menos 32 bytes; no compartirlo en Git.
- `PORT`: puerto de Flask; predeterminado `5000`.

```powershell
.\venv\Scripts\python.exe app.py
```

El backend queda en `http://localhost:5000`; `GET /` devuelve un mensaje de
servidor disponible. No hace falta activar el entorno virtual para estos comandos.

**Efectos del arranque:** `app.py` crea tablas faltantes, prepara la columna
`verificado` y ejecuta los ajustes/datos de demo de Sprint 3. Utilizar una base
de desarrollo. Se necesitan permisos de creación/alteración de tablas. No hay
un sistema de migraciones Alembic; los scripts actuales no sustituyen una
migración general de todas las diferencias futuras.

El seed agrega cuatro profesionales de Mendoza cuando no existen. Por ejemplo,
`laura.gomez@test.com` recibe la contraseña de demo `123456` solo al crearse;
reiniciar el backend no reemplaza contraseñas ya cambiadas. Un paciente se crea
desde `/registro`. Los profesionales de demo no se verifican automáticamente
y el catálogo `Servicio` comienza vacío. Para preparar una solicitud de prueba
local, seguir [el ejemplo del contrato](docs/sprint-4-santiago.md#datos-para-una-prueba-local).

### 2. Frontend

En otra terminal, desde la raíz del repo:

```powershell
cd .\enfe-red\frontend
npm.cmd ci
npm.cmd run dev
```

Abrir la URL que informa Vite, normalmente `http://localhost:5173`. Si ese puerto
está ocupado, Vite puede elegir otro. `.env` es opcional: por defecto la API está
en `http://localhost:5000`. Para cambiarla, copiar `.env.example` a `.env` sin
sobrescribir una configuración existente y ajustar `VITE_API_URL` **sin `/api`**.
Reiniciar Vite después de modificar variables de entorno.

En PowerShell usamos `npm.cmd` para evitar bloqueos de ejecución de `npm.ps1`.
No se incluyen tokens ni contraseñas del backend en variables `VITE_*`:
esas variables son públicas en el navegador.

## Pruebas y comprobaciones

Desde `enfe-red/backend/`:

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests -v
```

Los tests construyen aplicaciones Flask de prueba y usan SQLite en memoria,
sin importar el arranque de `app.py` ni modificar la base configurada en `.env`.
Cubren horarios, filtros, recuperación, perfiles y solicitudes. No sustituyen
una prueba de despliegue con MySQL ni una revisión visual en navegador.

Desde `enfe-red/frontend/`:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

La suite usa Node y JSDOM con respuestas simuladas para probar navegación y
comportamiento de pantallas. `build` genera `dist/`; `npm.cmd run preview`
permite servir ese resultado. Ni `dist/` ni `.test-build/` se versionan.

Verificación del 15/10/2026 después de integrar `origin/Prueba` (`52a785a`) en
`Santiago`: **38 tests de backend, 18 de frontend, lint y build aprobados**.
Además se ejecutaron 18 comprobaciones de endpoints usando el arranque real
de Flask y una base SQLite temporal: registro, login, edición de ubicación,
búsqueda, creación de solicitud, comprobante, bandejas y restricciones de acceso.
La base configurada de desarrollo no se modificó. Los límites de esta
verificación y los avisos del backend se registran en la comparación con el PDF.

## Ramas y estado de integración

Instantánea comprobada con `git fetch origin` el **15/10/2026**. Los nombres
respetan mayúsculas: **`Santiago` y `Prueba`**, no `santiago`/`prueba`.
Esta tabla no es un seguimiento en tiempo real: actualizarla al integrar trabajo.

| Rama remota | Commit observado | Qué representa en esta revisión |
| --- | --- | --- |
| `origin/main` | `da2ea4b` | Base anterior del proyecto; no contiene los avances integrados de Prueba. |
| `origin/Prueba` | Entrega Sprint 4 de Santiago sobre `52a785a` | Integración compartida: mejoras previas de perfiles/ubicación y backend de solicitudes SCRUM-56/57/58, documentación y limpieza de estructura. |
| `origin/Santiago` | Misma entrega de Sprint 4 | Rama de trabajo de Santiago sincronizada con la entrega a Prueba. |
| `origin/Pablo` | `3b81721` | Correcciones de sprints 1, 2 y 3, ya incluidas en Santiago/Prueba. |
| `origin/Renzo` | `c725180` | Horarios y correcciones de cartilla, ya incluidas en Santiago/Prueba. |
| `origin/German` | `2c474f2` | Tiene un commit adicional de UI de solicitudes que no está integrado en Santiago. Se registra su existencia, sin evaluarlo como parte de esta entrega. |

**Entrega del 15/10/2026:** el commit `feat(sprint-4): completar la parte de
Santiago (SCRUM-56, SCRUM-57 y SCRUM-58)` incorpora el backend de solicitudes,
las pruebas, la documentación y la limpieza de estructura. Se integra en
`Prueba` desde `Santiago`, sobre `52a785a`, sin reescribir el historial.
Consultar `git log -1 origin/Prueba` para obtener el identificador de la entrega.

La limpieza deja de versionar 668 archivos de `node_modules` y una base local;
estos archivos siguen en la máquina de trabajo y quedan ignorados por Git.
Después de actualizar una copia anterior, ejecutar `npm.cmd ci` en el frontend
para reinstalar las dependencias. Cada integrante debe conservar su `.env` y
su propia base de desarrollo; esos datos no se comparten mediante Git.
Si la copia anterior todavía versiona `backend/instance/test.db`, respaldar
esa base fuera del repositorio antes de actualizar: Git retira el archivo
versionado al incorporar esta limpieza.

El reparto comunicado para Sprint 4 asigna a Santiago creación, comprobante y
consulta (SCRUM-56/57/58); a Pablo las transiciones de estado; a Germán el flujo
del paciente; y a Renzo las bandejas y acciones del enfermero. Esta guía no
marca las tareas de esos compañeros como fallas de tu entrega actual.

Para verificar la situación antes de trabajar:

```powershell
git status --short --branch
git branch -avv
git fetch origin
git log -5 --oneline --decorate
git diff --stat
git diff --cached --stat
git log --oneline HEAD..origin/Prueba
```

`fetch` actualiza referencias, no mezcla código. No cambiar de rama ni hacer
un merge con trabajo local sin revisar. Integrar cambios funcionales y contratos
en `Prueba` de forma coordinada; no asumir que están en `main`.

## Límites actuales importantes

- La recuperación imprime el código en la consola del backend. Vence en diez
  minutos, permite cinco intentos y se consume al usarlo. No hay envío de email.
- La matrícula registrada no equivale a una aprobación administrativa. El POST
  de solicitudes exige `verificado = True` y `disponible = True`, pero el flujo
  de aprobación del administrador de Sprint 2 todavía no está implementado.
- La búsqueda no oculta automáticamente enfermeros sin verificar y permite
  listar disponibles/no disponibles. Esto difiere de HU3/HU9 del PDF.
- La disponibilidad semanal permite agregar y consultar franjas; no tiene
  rutas actuales de edición/borrado. No es una agenda de reservas por fecha.
- El perfil permite elegir y quitar coordenadas mediante un mapa. Cambiar
  dirección/ciudad borra el punto anterior; se debe elegir uno nuevo si se desea
  publicarlo. No se convierte automáticamente una dirección en coordenadas.
- El catálogo `Servicio` es mínimo; falta `descripcion` del diagrama y su
  administración de Sprint 2. No confundir especialidad, servicio y tarifa/hora.
- Consultar `confirmarSolicitud()` devuelve el comprobante: no acepta el pedido.
  El POST no reserva bloques ni comprueba superposición de solicitudes.

La comparación detallada distingue estas diferencias de lo que está fuera de
alcance. No se implementaron funciones de otros sprints durante esta revisión.

## Convenciones para continuar

1. Mantener un solo frontend en `enfe-red/frontend/src` y un solo backend en
   `enfe-red/backend`. No crear otro proyecto React dentro de `frontend/`.
2. Reutilizar `api.js`, los componentes de `ui/`, `ProfileEditor` y los estilos
   existentes. Los modelos van en `models/`, las rutas en `routes/` y las
   comprobaciones automatizadas en `tests/`.
3. Conservar los nombres y tipos del contrato de solicitudes. Coordinar cualquier
   cambio de IDs, estados o respuestas entre frontend y backend.
4. No duplicar `disponible` creando otro campo `disponibilidad`. Distinguir la
   disponibilidad general de las franjas de la tabla `Disponibilidad`.
5. Guardar documentación en `docs/`; actualizar este índice y el mapa de ramas
   cuando cambie la integración. El PDF es la referencia académica y se contrasta
   con la implementación, no se usa para afirmar que algo ya está programado.
6. Versionar código, manifests y lockfiles; instalar dependencias localmente.
   No subir `.env`, entornos virtuales, bases locales ni `node_modules`.
