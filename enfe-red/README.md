# Enfe-red: aplicación

La documentación general está en el [README de la raíz](../README.md).
Allí se explican la estructura, los recorridos, la API, la configuración local,
las pruebas y el estado de cada rama.

- [Backend de solicitudes de Santiago](../docs/sprint-4-santiago.md).
- [Comparación con el PDF: sprints 1 a 3 y Sprint 4 de Santiago](../docs/comparacion-sprints-1-4.md).

## Carpetas activas

- `backend/`: Flask, SQLAlchemy, modelos, rutas y pruebas Python.
- `frontend/`: único proyecto React/Vite; su código está en `frontend/src/`.

Desde esta carpeta, abrir una terminal en `backend/` para ejecutar
`venv\Scripts\python.exe app.py` y otra en `frontend/` para `npm.cmd run dev`,
después de configurar e instalar según la guía general.

Este directorio conserva su ubicación histórica para no cambiar los comandos
ni las rutas compartidas por el equipo. No contiene otro frontend anidado.
