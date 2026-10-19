# Sprint 5 — Backend de Germán

Implementa SCRUM-62 (historial) y SCRUM-63 (mensajes). Todos los endpoints requieren `Authorization: Bearer <token>`. No se implementan notificaciones ni interfaces de chat, que corresponden a los demás integrantes.

## Instalación

Reiniciar `python app.py` con el entorno virtual activo. El import del blueprint registra el modelo Mensaje antes del `db.create_all()` existente en la inicialización: crea la tabla `mensajes` si falta, sin borrar tablas. No se requieren nuevas dependencias. No ejecutar scripts que eliminen datos.

## Historial (para Pablo)

`GET /api/usuarios/<idUsuario>/historial`

El ID es el de Usuario (el `sub` del JWT), no el de Paciente/Enfermero. Solo permite consultar el historial propio. Devuelve HTTP 200 y un array de comprobantes con el mismo formato del GET de detalle de Sprint 4, filtrados a Realizada, Rechazada y Cancelada, más recientes primero por fecha/hora/ID. Sin registros devuelve `[]`. Funciona para paciente y enfermero, resolviendo internamente su perfil. No expone contraseña ni historial médico. Los filtros visuales por fecha/estado pueden aplicarse sobre este array.

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

## Validación

Desde backend: `python -m unittest discover -s tests -q`.

Se agregaron 10 pruebas de historial privado, estados terminales, envío bidireccional, aislamiento entre solicitudes, permisos, autenticación, validación, bloqueo de suplantación, timestamps UTC, rollback y esquema. Las pruebas usan SQLite en memoria: no alteran MySQL local. El bloqueo `FOR UPDATE` del envío está destinado a MySQL/InnoDB; la concurrencia real debe validarse allí al integrar. `tests/test_notificaciones.py` agrega 9 pruebas: aviso al aceptar y rechazar, transiciones sin aviso, rollback si falla la alerta, mensajes sin acumulación, privacidad, lectura idempotente, orden y esquema.
