# Sprint 4 — Germán

Implementado: formulario desde el perfil, POST con Axios/JWT, comprobante mediante GET, cancelación mediante PUT y diálogo nativo de confirmación. Las rutas requieren sesión de paciente. El backend debe validar sesión, rol y propiedad en todas las operaciones; la validación del frontend no reemplaza la autorización.

## Contrato propuesto, pendiente de acordar con Santiago y Pablo

El backend local todavía no implementa SolicitudServicio ni Servicio. No se agregaron datos ficticios ni cambios al backend. No es posible completar una reserva real hasta integrar estos endpoints.

GET /api/usuarios/:id sigue recibiendo el ID de usuario del profesional. Para habilitar el formulario necesita `enfermero_id` (ID de la tabla enfermeros), `verificado: true`, `disponible: true` y `servicios: [{ idServicio: 1, tipoServicio: "Curaciones", precioEstimado: 8500 }]`. El catálogo debe contener únicamente servicios ofrecidos por ese profesional. Si el equipo define un endpoint separado para el catálogo, adaptar services/solicitudes.js y la carga del formulario.

POST /api/solicitudes recibe:

```json
{
  "idEnfermero": 2,
  "idServicio": 1,
  "fecha": "2026-11-10",
  "hora": "10:30",
  "direccionAtencion": "Dirección ingresada por el paciente"
}
```

Se propone que el backend resuelva idPaciente desde el JWT, sin confundir el ID de usuario con el ID de paciente. Validar servicio ofrecido, verificación, disponibilidad, fecha/hora futura y conflictos de horario en servidor. Respuesta POST exitosa: HTTP 201 y `{ "idSolicitud": 15 }`. No devolver éxito si la creación falló.

GET /api/solicitudes/15 devuelve el objeto directo:

```json
{
  "idSolicitud": 15,
  "estado": "Pendiente",
  "fecha": "2026-11-10",
  "hora": "10:30",
  "direccionAtencion": "Dirección ingresada por el paciente",
  "enfermero": { "nombre": "Laura", "apellido": "Gómez" },
  "servicio": { "tipoServicio": "Curaciones", "precioEstimado": 8500 }
}
```

PUT /api/solicitudes/15/cancelar: sin body; HTTP 200 o 204 tras cancelar. El servidor debe exigir que sea el paciente dueño y que el estado sea Pendiente o Aceptada. Errores: `{ "error": "mensaje" }` con estado HTTP adecuado. Fechas y horas locales de atención; precios expresados en ARS.

## Integración con Renzo

No se creó EstadoSolicitudes.jsx, que corresponde a Renzo. En cada tarjeta del paciente incluir:

```jsx
<CancelarSolicitud
  key={solicitud.idSolicitud}
  solicitud={solicitud}
  onCancelada={(id) => setSolicitudes(actuales => actuales.map(item =>
    item.idSolicitud === id ? { ...item, estado: 'Cancelada' } : item
  ))}
/>
```

El componente ya está conectado al comprobante para poder cancelar desde allí. Oculta la acción en estados terminales, evita dobles clics y conserva el estado anterior ante errores. Renzo puede enlazar cada tarjeta a `/solicitudes/${solicitud.idSolicitud}`.

## Prueba manual tras integrar el backend

1. Entrar como paciente, abrir un perfil y pulsar Solicitar servicio.
2. Verificar que sin catálogo, verificación o disponibilidad el envío esté bloqueado.
3. Elegir servicio, fecha y hora futuras y dirección; enviar y verificar una sola creación.
4. Comprobar que el comprobante carga desde GET incluso después de recargar la página; Pendiente no debe presentarse como turno aceptado.
5. Cancelar: conservar en el diálogo no hace PUT; confirmar sí hace PUT y muestra Cancelada tras el éxito.
6. Probar error de red, sesión vencida y cancelación rechazada; verificar que no se indique éxito.
7. Verificar en servidor que otro paciente no pueda consultar ni cancelar una solicitud ajena.

Configuración opcional: VITE_API_URL contiene el origen del backend sin /api, como en src/api.js. Por defecto se usa http://localhost:5000; el cliente de solicitudes agrega /api y comparte el cierre de sesión ante respuestas 401.
