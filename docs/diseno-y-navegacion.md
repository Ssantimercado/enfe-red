# Diseño y navegación de Enfe red

La interfaz debe conservar el estilo de cuidado cercano que ya usan la landing,
la autenticación, la cartilla y los perfiles: fondos claros, azul para la acción
principal, verde como acompañamiento y contenido organizado en tarjetas simples.
Las nuevas funciones deben incorporarse a esos componentes y recorridos.

El [mapa de navegación de referencia](mapa-de-navegacion.md) conserva el flujo
compartido por el equipo, sus ajustes y la distinción entre funciones actuales
y futuras.

Referencia de código: rama `Prueba`, base `6d8e1b9`, revisada el 15 de octubre de
2026. Esta guía registra patrones del código activo; no sustituye una revisión
visual en navegador. Las propuestas para próximos sprints se identifican al final.

## Pantallas y recorridos existentes

| Ruta | Pantalla y referencia | Regla para continuar |
| --- | --- | --- |
| `/` | `Landing.jsx` y `Landing.css` | Presentación pública; marca hacia `/`, secciones con anclas y accesos a registro/login o al espacio personal cuando hay sesión. |
| `/login` | `Login.jsx` dentro de `AuthLayout` | Formulario de acceso, aviso de sesión vencida, recuperación y registro. |
| `/registro` | `Register.jsx` dentro de `AuthLayout` | Elegir paciente o enfermero; admite `?rol=enfermero`; después del éxito ofrece iniciar sesión. |
| `/recuperar-password` | `RecuperarPassword.jsx` dentro de `AuthLayout` | Correo, código y nueva contraseña, confirmación final; permite reenviar código y cambiar correo. |
| `/home` | `Home.jsx` dentro de `AppShell` | Paciente: buscar cuidados. Enfermero: gestionar perfil y horarios. |
| `/cartilla` | `ListaEnfermeros.jsx` y `DirectoryFilters.jsx` | Búsqueda, filtros, lista/mapa y paginación con seis profesionales por página. |
| `/perfil/:id` | `VerPerfiles.jsx` y `ProfessionalContact.jsx` | Perfil profesional; retorno a la cartilla conservando búsqueda, filtros y página. `id` identifica a Usuario. |
| `/perfil-paciente` | `PerfilPaciente.jsx` → `ProfileEditor` | Perfil propio, consulta y edición; acceso de paciente. |
| `/perfil-enfermero` | `PerfilEnfermero.jsx` → `ProfileEditor` | Perfil propio profesional, punto del mapa y `GestionHorarios`; acceso de enfermero. |

La aplicación interna comparte `AppShell`: marca, Inicio, Buscar profesionales,
Mi perfil, cuenta y cierre de sesión. Buscar permanece activo al abrir un perfil
público. Mi perfil cambia de destino según el rol. No agregar una segunda cabecera
o un segundo pie dentro de una pantalla interna.

`App.jsx` protege la sesión y los roles y gestiona el desplazamiento al cambiar de
ruta. El acceso directo a `/perfil-enfermero#horarios` espera la carga del perfil
para llegar a la sección. Las rutas desconocidas redirigen según la sesión.
El login conserva un destino interno solicitado previamente.

## Archivos que definen el diseño

| Fuente | Responsabilidad |
| --- | --- |
| `src/index.css` | Tokens de color, tipografía, estilos base, foco y movimiento reducido. |
| `src/App.css` | Componentes compartidos, estructura interna, autenticación, cartilla, perfiles, horarios y responsive. |
| `src/components/Landing.css` | Composición pública y clases `lp-`, con variaciones propias de la landing. |
| `src/components/ui/Brand.jsx` | Marca única, cruz azul, texto `Enfered.` con E mayúscula y punto verde. |
| `src/components/ui/Icon.jsx` | Iconos SVG de línea, color heredado, tamaño predeterminado 20 px. |
| `src/components/ui/Avatar.jsx` | Foto cuando existe o iniciales; variantes de color y tamaño grande. |
| `src/components/ui/ProfileSkeleton.jsx` | Carga accesible del perfil manteniendo su estructura. |

Las rutas de esta tabla parten de `enfe-red/frontend/`. El frontend activo se
monta desde `src/main.jsx` y `src/App.jsx`. No existe una segunda aplicación dentro
de `frontend/frontend/`: una pestaña antigua del IDE no indica que ese código se use.

`Navbar.jsx` y `Navbar.css` no se importan desde las pantallas activas.
`GestionHorarios.jsx` sí está activo, pero no importa `GestionHorarios.css`:
sus estilos actuales están en `App.css`. No copiar el formulario oscuro ni la
tipografía Arial de ese CSS histórico para construir componentes nuevos.

## Colores y tipografía

Usar las variables existentes antes de agregar colores literales.

| Variable o valor | Uso actual |
| --- | --- |
| `--ink: #193b4d` | Títulos y texto destacado. |
| `--muted: #607583` | Descripciones, datos secundarios y ayudas. |
| `--blue: #167bb5` | Acción principal, marca y elementos activos. |
| `--blue-dark: #11658f` | Hover principal, enlaces y énfasis azul. |
| `--blue-soft: #edf6fc` | Selección de navegación y superficies azules suaves. |
| `--teal: #137e75` | Acompañamiento, iconos y etiquetas de sección. |
| `--mint: #e9f6f1` | Superficies de acompañamiento verde. |
| `--border: #dfe8ec` | Separaciones y bordes finos. |
| `#f7f9fb` / `#ffffff` | Fondo general / tarjetas y formularios. |
| `#a52e3b` sobre `#fff2f3` | Aviso de error, con borde `#f0d5d9`. |
| `#176a50` sobre `#eef9f3` | Aviso de éxito, con borde `#c9e6d8`. |

La fuente global es `'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif`.
Conservar herencia en controles. El diseño es claro; no introducir modo oscuro,
otra fuente o una paleta por pantalla como parte de una tarea funcional.

El `h1` global usa `clamp(30px, 3.1vw, 46px)`, interlineado 1.2 y peso 720;
`.page-heading h1` usa 34 px y baja a 29 px en celular. El `h2` base usa 26 px;
los paneles lo reducen a 19 px. El cuerpo y los controles suelen usar 14 px;
las ayudas, 12–13 px. `.eyebrow` es una etiqueta breve de sección, de 10 px,
verde, en mayúsculas y con espaciado entre letras. No usarla para instrucciones largas.

## Estructura y espacios

Las pantallas internas usan `.page-container`, centrado, de hasta 1296 px y
padding `40px 32px`. La cabecera comparte ese ancho. La jerarquía habitual es
etiqueta de sección, título, descripción y contenido; reutilizar `.page-heading`.

Las tarjetas de profesionales usan borde de 1 px, radio de 14 px y padding
de 22 px; `.content-panel`, radio de 14 px y padding de 28 px. La cabecera de
perfil usa radio de 16 px y padding de 32 px. Existe `--radius: 16px`, pero no
todos los componentes usan ese valor. Conservar las variantes según su función.

Las separaciones principales de grillas y paneles son de 18, 20, 24 o 28 px.
Usar `gap`, padding y márgenes del componente equivalente en lugar de saltos de
línea o espacios vacíos. Mantener bordes discretos y sombras suaves; el hover
de una tarjeta destaca su borde sin cambiar la distribución.

La cartilla tiene filtros de 236 px y resultados flexibles separados por 28 px;
los profesionales aparecen en dos columnas. `.results-map` conserva 22 px de
separación inferior: el mapa y las tarjetas no deben quedar pegados.
Los perfiles usan contenido ancho y columna auxiliar. El panel de contacto
público permanece visible con `position: sticky` en escritorio.

## Botones y formularios

| Clase | Uso |
| --- | --- |
| `.button.button-primary` | Acción principal azul, texto blanco y hover azul oscuro. |
| `.button.button-secondary` | Acción secundaria blanca, borde fino y texto oscuro. |
| `.button-full` | Acción a ancho completo cuando corresponde al formulario o panel. |
| `.text-link` | Acción discreta, como editar, limpiar o volver. |
| `.icon-button` | Acción compacta con nombre accesible; no usar solo un icono sin etiqueta. |
| `.field` | Label visible, control y ayuda/error asociado. |
| `.form-stack` / `.form-grid` | Formulario vertical / campos en dos columnas, con `.full-width` cuando corresponde. |
| `.notice-info`, `.notice-error`, `.notice-success` | Mensajes dentro de `.notice`, conservando su significado. |

Los botones principales tienen al menos 44 px de alto, radio de 9 px y fuente
de 14 px. Los campos tienen borde `#cad9e1`, radio de 8 px y altura mínima de
44 px. Los controles móviles suben a 16 px de fuente. Usar `type`, `required`,
`autoComplete`, `min` y `step` según el dato; el placeholder no reemplaza al label.

Durante un envío, bloquear el envío duplicado y mostrar texto como `Guardando…`.
Conservar los valores ante errores y confirmar el resultado dentro de la vista.
Cancelar edición debe descartar el borrador y recuperar los datos guardados.
Reutilizar `ProfileEditor` para perfiles y `DirectoryFilters` para compartir
campos entre escritorio y celular.

## Estados y datos reales

Toda consulta nueva debe contemplar carga, contenido, vacío y error con una
salida útil. Reutilizar skeletons y `.empty-state`; ofrecer Reintentar cuando
corresponda. Los avisos de error usan `role="alert"`; la carga y confirmación,
`role="status"` o `aria-busy`. No reemplazar estos patrones con `alert()`.

Las tarjetas conservan identidad, zona, especialidad, disponibilidad, descripción,
datos adicionales reales, tarifa y Ver perfil. La selección del mapa usa
`.is-selected`. No llenar puntuaciones o distancias ausentes con valores de
demostración. Reutilizar `formatPrice` para las tarifas en ARS; un valor no
positivo se muestra actualmente como `A consultar`.

La matrícula informada no implica verificación administrativa. La disponibilidad
general, las franjas semanales y la reserva de una solicitud son conceptos distintos.
El precio estimado de `Servicio` tampoco equivale a `tarifa_hora` del enfermero.

## Adaptación a celular y accesibilidad

| Ancho | Comportamiento existente que hay que conservar |
| --- | --- |
| Hasta 1050 px | Navegación más compacta, filtros de 210 px y menor padding en tarjetas. |
| Hasta 800 px | Navegación interna fija abajo; espacio inferior y safe area reservados; perfiles y horarios en una columna; filtros en diálogo; autenticación sin panel ilustrado. |
| Hasta 540 px | Padding de página `25px 16px`; cartilla y formulario en una columna; filtros como panel inferior; tarjetas y títulos adaptados. |

En hasta 800 px, el contenedor interno usa `30px 22px`. El contacto del perfil
público pasa antes de la información y deja de ser sticky. La landing tiene sus
propios cortes de 1150, 1000, 700 y 370 px; su menú se colapsa hasta 1000 px.
No reemplazar estos comportamientos con un único ancho fijo.

Conservar foco visible, enlace para saltar al contenido, navegación con teclado,
labels asociados, `aria-pressed` en selección y `aria-expanded` al desplegar.
Los estados necesitan texto además del color. Los iconos decorativos se ocultan
al lector de pantalla; el control que los contiene aporta el nombre.

El diálogo de filtros usa `<dialog>`, `showModal()`, cierre con Escape, bloqueo
del scroll del fondo y borrador que se aplica al confirmar. Usarlo como referencia
para nuevos diálogos, con clases propias para no modificar los filtros existentes.
Mantener la preferencia de movimiento reducido definida en `index.css`.

Comprobar especialmente 320–390 px, 540 px, 800 px y escritorio. Textos largos,
errores, zoom y barra inferior no deben ocultar acciones ni causar scroll horizontal.

## Landing y mapas

La landing tiene composición más editorial: fotografía de cuidado, fondos crema,
secciones amplias y una sección profesional verde oscura. Reutiliza marca, botones,
iconos y colores globales, pero sus proporciones grandes no son la plantilla de
formularios internos. Conservar prefijo `lp-`, imágenes WebP y variantes pequeñas,
textos alternativos y procedencia en `assets/landing/provenance.txt`.

Las reseñas de la landing son ejemplos académicos identificados; no quitar sus
etiquetas ni presentarlas como reseñas guardadas. El contacto actual es por
teléfono/correo; no anunciar reserva o pago integrado hasta implementar ese flujo.

El mapa real usa Leaflet, OpenStreetMap y OSRM; no reemplazarlo por la ilustración
de la landing. La vista se carga de forma diferida. Mantener atribución, selección
entre tarjeta y marcador, explicación del alcance de la página y errores de ubicación
o recorrido. Solicitar geolocalización al accionar Usar mi ubicación.

`LocationPicker` permite marcar o quitar un punto opcional del profesional;
cambiar dirección/ciudad descarta el punto anterior. No publicar coordenadas de
ejemplo como si fueran de una persona. El mapa conserva estilos en línea y
algunos colores/emojis propios: son excepciones existentes, no el modelo para
los nuevos botones y avisos de otras pantallas.

## Reglas para las próximas funciones

El backend de Sprint 4 ya incluye creación, consulta, aceptación, finalización,
rechazo y cancelación. Sus pantallas todavía no están conectadas en este frontend.
Consultar [el contrato vigente](sprint-4-santiago.md) y respetar los IDs de perfil,
estados y permisos del backend. Las transiciones de Pablo están en
`backend/routes/solicitud_routes.py`, dentro del Blueprint existente.

Para nuevas pantallas de solicitudes, la propuesta de continuidad es usar
`AppShell`, `.page-container`, `.page-heading` y tarjetas/paneles del mismo estilo.
Las etiquetas deben decir exactamente Pendiente, Aceptada, Rechazada, Cancelada
o Realizada. Como criterio nuevo, mantener pendientes en un tono suave de aviso,
aceptadas en azul, realizadas en verde y rechazadas/canceladas con texto y tonos
discretos. Esas variantes de estado aún necesitan clases y revisión de contraste;
no existe hoy un componente compartido de badges de solicitudes.

Los botones se muestran según rol y estado, y los permisos se vuelven a validar
en el backend. Confirmar cancelaciones y rechazos en un diálogo; actualizar la
tarjeta con la respuesta recibida y tratar errores sin recargar toda la página.
Esta pauta define continuidad de diseño, no agrega las tareas del frontend.

En Sprint 5, integrar la campana al `AppShell` activo aunque la consigna mencione
`Navbar.jsx`. El historial debe seguir la estructura del perfil. En Sprint 6,
mantener el mismo sistema visual para administración y reputación. No mostrar
botones, contadores o estrellas como funciones operativas antes de integrar
sus datos y contratos. Implementar solamente el sprint y las tareas solicitadas.

## Cómo continuar y comprobar cambios

Antes de crear un componente, buscar el equivalente en la tabla de pantallas.
Reutilizar su estructura y clases; agregar CSS específico solo para lo nuevo,
con un prefijo del componente que evite afectar selectores globales. No instalar
otro framework visual para resolver una pantalla ni duplicar los clientes HTTP.
Para llamadas JSON nuevas, usar `requestApi` de `src/api.js` y su control de sesión.
Conservar filtros y vista de cartilla en la URL y el retorno desde perfiles.

Para cambios funcionales, ejecutar desde `enfe-red/frontend/`:

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
```

Revisar en navegador la pantalla afectada en escritorio y celular, con datos
largos, sin resultados, cargando, con error y con ambos roles cuando corresponda.
Las 18 pruebas actuales de navegación usan JSDOM y respuestas simuladas: cubren
recorridos y comportamiento, pero no verifican medidas visuales, contraste,
teselas, geolocalización ni rutas OSRM reales.

Para esta guía se verificaron el código activo, los estilos, el lint y las 18
pruebas de navegación. La interfaz no se modificó. Actualizar este contexto si
se acuerda cambiar un patrón compartido y separar siempre lo implementado de
las reglas propuestas para trabajo futuro.
