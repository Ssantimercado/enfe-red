# Contexto para trabajar en Enfe red

## Antes de modificar

- Leer [README.md](README.md) para ubicar la aplicación y
  [la guía de diseño](docs/diseno-y-navegacion.md) antes de crear o modificar interfaz.
- Comprobar `git status --short --branch`. Conservar cambios locales ajenos a la tarea.
- Seguir el alcance pedido y el reparto del sprint. No implementar tareas de otros
  integrantes ni adelantar sprints por considerar que falta una pantalla.
- La implementación activa y el contrato actualizado prevalecen sobre las
  instantáneas históricas de ramas o entregas del README.

## Estructura y diseño

- El único frontend está en `enfe-red/frontend/`; el backend, en `enfe-red/backend/`.
  No recrear `frontend/frontend/` ni otro proyecto npm dentro del existente.
- Seguir imports desde `src/main.jsx` y `src/App.jsx` para reconocer código activo.
- Usar `AppShell` para pantallas internas y `AuthLayout` para autenticación.
  La navegación interna activa está en `AppShell.jsx`; `Navbar.jsx` es histórico.
- Reutilizar `Brand`, `Icon`, `Avatar`, `ProfileSkeleton`, `ProfileEditor`,
  `DirectoryFilters` y `ProfessionalContact` según su responsabilidad.
- Mantener los tokens de `src/index.css` y las clases compartidas de `src/App.css`.
  La landing tiene estilos propios con prefijo `lp-` en `Landing.css`.
  `Navbar.css` y `GestionHorarios.css` no son la referencia del diseño activo.
- Conservar español con voseo, navegación por rol, retorno de cartilla con filtros,
  estados de carga/error/vacío/éxito y acceso por teclado.
- Toda regla visual nueva debe partir del componente equivalente existente.
  Evitar estilos globales genéricos o estilos en línea que creen otro sistema visual.

## Integración y validación

- Centralizar nuevas llamadas en `src/api.js`; preferir `requestApi` para JSON.
  Conservar el tratamiento compartido de sesión y errores.
- Consultar [el contrato de solicitudes](docs/sprint-4-santiago.md) antes de integrar
  Sprint 4. Los cuatro PUT de Pablo ya existen; sus pantallas todavía no están integradas.
- El JWT identifica a `Usuario`; `/perfil/:id` usa `Usuario.id`. Las solicitudes
  usan IDs de perfil (`idPaciente`, `idEnfermero`) e `idServicio`.
- No mostrar datos inventados como persistidos ni prometer una acción sin endpoint.
  Los testimonios de la landing deben conservar sus etiquetas de demostración.
- Para cambios funcionales del frontend ejecutar lint, pruebas y build desde
  `enfe-red/frontend/`. Revisar además las vistas afectadas en escritorio y celular;
  las pruebas JSDOM no comprueban distribución visual ni servicios externos del mapa.
- Para cambios del backend ejecutar las pruebas correspondientes desde
  `enfe-red/backend/`, usando el entorno Python local y una base de pruebas.
- Versionar código y documentación; mantener fuera `.env`, bases locales,
  `node_modules`, entornos virtuales y archivos generados.
- Actualizar la guía cuando cambie un patrón compartido; no describir una propuesta
  como funcionalidad implementada. No hacer commit, push o merge salvo que se solicite.
