# Sprint 5 — Integración de comunicación, notificaciones y reputación

Esta guía reúne los contratos integrados de SCRUM-62 a SCRUM-67: historial y
mensajes de Germán, chat de Santiago, notificaciones de Renzo, campana de Pablo
y reseñas de Santiago. Las vistas y rutas activas están en el único frontend de
`enfe-red/frontend/`. Todos los endpoints privados requieren
`Authorization: Bearer <token>`.

## Instalación

Reiniciar `python app.py` con el entorno virtual activo. El import del blueprint registra el modelo Mensaje antes del `db.create_all()` existente en la inicialización: crea la tabla `mensajes` si falta, sin borrar tablas. No se requieren nuevas dependencias. No ejecutar scripts que eliminen datos.

## Historial (para Pablo)

`GET /api/usuarios/<idUsuario>/historial`

El ID es el de Usuario (el `sub` del JWT), no el de Paciente/Enfermero. Solo permite consultar el historial propio. Devuelve HTTP 200 y un array de comprobantes con el mismo formato del GET de detalle de Sprint 4, para solicitudes Aceptadas o Realizadas cuya fecha y hora ya pasaron, más recientes primero. Sin registros devuelve `[]`. Funciona para paciente y enfermero, resolviendo internamente su perfil. No expone contraseña ni historial médico. Los filtros visuales por fecha/estado pueden aplicarse sobre este array.

## Mensajes (para Santiago)

`POST /api/solicitudes/<idSolicitud>/mensajes`

Body único: `{ "contenido": "Hola, confirmo la dirección de atención." }`.

Solo paciente y enfermero de esa solicitud pueden enviar, y únicamente mientras su estado sea Aceptada. Texto obligatorio de 1 a 2000 caracteres después de quitar espacios exteriores. El servidor determina idEmisor desde el JWT y fechaHora en UTC; rechaza intentos de enviar esos campos desde el cliente. Éxito: HTTP 201 y el mensaje directo:

```json
{
  "idMensaje": 1,
  "idSolicitud": 15,
  "idEmisor": 11,
  "contenido": "Hola, confirmo la dirección de atención.",
  "fechaHora": "2026-10-15T20:30:00.000000Z"
}
```

`GET /api/solicitudes/<idSolicitud>/mensajes`

Solo participantes. HTTP 200 con array de mensajes en orden ascendente de idMensaje, o `[]`. Se puede consultar cada tres segundos y deduplicar por idMensaje; cancelar polling al desmontar la vista. Renderizar contenido como texto, sin HTML. Convertir fechaHora UTC a hora local para mostrarla. Después de finalizar/cancelar, los participantes conservan acceso de lectura a la conversación; nuevos envíos devuelven 409.

Errores de aplicación usan `{ "error": "mensaje" }`: 400 body inválido, 401 usuario inexistente, 403 acceso ajeno, 404 solicitud inexistente, 409 estado no habilitado, 500 error de persistencia (con rollback). Flask-JWT-Extended puede devolver `msg` en errores de token ausente/vencido. Manejar siempre el estado HTTP.

## Notificaciones (SCRUM-64, para la campana de Pablo)

Tabla `notificaciones` (`models/notificacion_models.py`): `idNotificacion`, `idUsuario` (Usuario, no perfil), `idSolicitud`, `tipo` (`aceptada`, `rechazada` o `mensaje`), `mensaje` (hasta 255 caracteres), `leida` y `fechaHora` (UTC). `db.create_all()` la crea al iniciar si falta, sin tocar otras tablas.

Disparadores, siempre en la misma transacción que el cambio (si falla la alerta, se revierte todo):

- El enfermero acepta o rechaza una solicitud: aviso al paciente, por ejemplo `Laura Gómez aceptó tu solicitud de Curaciones del 10/01 a las 10:30.`
- Llega un mensaje: aviso al otro participante. Si ya tiene un aviso de mensaje sin leer de esa solicitud, se actualiza en lugar de acumular uno por mensaje.
- Cancelar y finalizar no generan avisos.

`GET /api/notificaciones/<idUsuario>`: solo las propias (403 si no). HTTP 200 con las últimas 50, de la más nueva a la más vieja, o `[]`.

```json
{ "idNotificacion": 7, "idUsuario": 11, "idSolicitud": 15, "tipo": "aceptada",
  "mensaje": "Laura Gómez aceptó tu solicitud de Curaciones del 10/01 a las 10:30.",
  "leida": false, "fechaHora": "2026-10-19T23:55:00Z" }
```

`PUT /api/notificaciones/<idNotificacion>/leer`: solo el dueño (403 ajena, 404 inexistente). Idempotente; responde 200 con `{ "mensaje": "Notificación leída", "notificacion": {...} }`.

Ambos requieren `Authorization: Bearer <token>` y usan `{ "error": "..." }` para errores de aplicación.

## Reseñas y reputación (Santiago: SCRUM-65, 66 y 67)

Se reutiliza la tabla `calificaciones_servicio` de Renzo para tener un único sistema de reputación: una reseña es la calificación que el paciente deja sobre el enfermero. Se agregaron `Calificacion.fecha` (Reseña.fecha del diagrama) y `Enfermero.calificacionPromedio` / `cantidadResenas`, con migración idempotente en `schema_sprint4.py` que completa el promedio de las calificaciones existentes.

**65.2 Promedio:** se recalcula en la misma transacción cada vez que un paciente califica, tanto desde `POST /api/resenas` como desde `POST /api/solicitudes/<id>/calificaciones` del historial. Las calificaciones del enfermero al paciente no cuentan. `Enfermero.to_dict()` incluye `calificacionPromedio`, `cantidadResenas` y `puntuacion` (el mismo promedio, que la cartilla ya muestra como estrella).

**66.1** `POST /api/resenas` (solo paciente dueño de la solicitud). Body exacto: `{ "idSolicitud": 15, "puntuacion": 5, "comentario": "Muy puntual." }`. Solo con la solicitud en **Realizada** (HU11: "una vez finalizada la atención"); si no, 409. Una reseña por solicitud (409 si se repite). Comentario obligatorio, hasta 250 palabras y 2000 caracteres. Responde 201:

```json
{ "mensaje": "Reseña publicada",
  "resena": { "idResena": 7, "idSolicitud": 15, "puntuacion": 5, "comentario": "Muy puntual.",
              "fecha": "2026-10-20T00:10:00Z", "paciente": "Ana P." },
  "calificacionPromedio": 4.5, "cantidadResenas": 2 }
```

**67.1** `GET /api/enfermeros/<idEnfermero>/resenas` (ID de perfil, igual que en solicitudes; requiere sesión). Responde `{ "idEnfermero", "calificacionPromedio", "cantidadResenas", "resenas": [...] }`, de la más nueva a la más vieja. El autor se muestra como nombre e inicial del apellido; no se exponen emails ni datos médicos. 404 si el enfermero no existe.

La calificación desde el historial (`/solicitudes/<id>/calificaciones`) y la reseña (`/api/resenas`) requieren que el servicio esté **Realizada** y que haya pasado su fecha y hora. El botón "Marcar como realizado" está conectado a la transición del Sprint 4.

## Validación

Desde backend: `python -m unittest discover -s tests -q`.

Se agregaron 10 pruebas de historial privado, estados terminales, envío bidireccional, aislamiento entre solicitudes, permisos, autenticación, validación, bloqueo de suplantación, timestamps UTC, rollback y esquema. Las pruebas usan SQLite en memoria: no alteran MySQL local. El bloqueo `FOR UPDATE` del envío está destinado a MySQL/InnoDB; la concurrencia real debe validarse allí al integrar. `tests/test_resenas.py` agrega 8 pruebas: promedio, regla de Realizada, una por solicitud, permisos, validación, rollback, calificación desde el historial y migración. `tests/test_notificaciones.py` agrega 9 pruebas: aviso al aceptar y rechazar, transiciones sin aviso, rollback si falla la alerta, mensajes sin acumulación, privacidad, lectura idempotente, orden y esquema.
