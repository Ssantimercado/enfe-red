# Sprint 6 — Pablo: administración y seguridad

Todas las rutas `/api/admin/*` requieren un JWT cuyo usuario siga activo, tenga
el rol `administrador` y un `nivelPermiso` configurado. La API vuelve a consultar
la cuenta en la base y contrasta los claims del token, por lo que los cambios de
rol, permiso o suspensión tienen efecto sobre los tokens existentes.

## Endpoints

| Método y ruta | Función |
| --- | --- |
| `GET /api/admin/usuarios?q=&rol=&estado=&page=&per_page=` | Busca y pagina usuarios por email, nombre, apellido o matrícula. |
| `PUT /api/admin/usuarios/<idUsuario>/suspension` | Recibe `{"suspendido":true}` o `false`; no permite suspender la propia cuenta. |
| `PUT /api/admin/usuarios/<idUsuario>/estado` | Alias del contrato del sprint; recibe `{"estado":"Suspendido"}` o `"Activo"`. |
| `PUT /api/admin/enfermeros/<idEnfermero>/matricula` | Recibe `{"verificado":true}` para aprobar o `false` para rechazar. |
| `GET /api/admin/metricas`, `GET /api/admin/resumen` | Contrato del PanelAdmin y métricas del sprint (`usuariosActivos`, `enfermerosPendientes`, `serviciosRealizados`). |

La búsqueda devuelve `usuarios`, `total_resultados` y `total_paginas`. Cada cuenta
incluye `id`, `email`, `rol`, `suspendido`, `nombre` y `apellido`, que corresponden
al contrato de `AdminUsuarios.jsx`.

La tabla `usuarios` incorpora `suspendido` (predeterminado `false`) y
`nivelPermiso`. `schema_sprint6.inicializar_bd_sprint6()` agrega esas columnas a
bases existentes. El inicio de sesión rechaza cuentas suspendidas con HTTP 403.
El registro público no permite crear administradores. Para promover una cuenta
existente, ejecutar desde `backend/`:

```powershell
python -m flask --app app asignar-administrador pablo@example.com --nivel-permiso total
```

Después, iniciar sesión de nuevo para recibir los claims administrativos.
