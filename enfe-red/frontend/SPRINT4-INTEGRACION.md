# Sprint 4 — Integración de solicitudes

## Contrato implementado

- GET /api/usuarios/:id: perfil público; :id es el ID de Usuario. Usar enfermero_id en el POST. Requiere verificado y disponible verdaderos para habilitar el formulario.
- GET /api/servicios: catálogo global real de la tabla Servicio, con JWT. Devuelve array de { idServicio, tipoServicio, precioEstimado }, ordenado por tipoServicio e ID. Sin servicios devuelve []. El modelo actual no relaciona Servicio con Enfermero: no presentar el catálogo como oferta personalizada de cada profesional.
- POST /api/solicitudes: { idEnfermero, idServicio, fecha, hora, direccionAtencion }. idEnfermero corresponde al perfil, no al usuario. idPaciente se resuelve desde JWT. Dirección de 1 a 200 caracteres; fecha y hora futuras. El servidor valida disponibilidad, verificación y conflictos de turno.
- Respuesta POST: HTTP 201 con { mensaje, solicitud: { idSolicitud, ... } }. El formulario toma solicitud.idSolicitud y navega al comprobante.
- GET /api/solicitudes/:idSolicitud: comprobante directo con estado, fecha, hora, direccionAtencion, enfermero y servicio (tipoServicio y precioEstimado).
- PUT /api/solicitudes/:idSolicitud/cancelar: sin body; solo el paciente dueño puede cancelar estados Pendiente o Aceptada. El componente actualiza la pantalla únicamente tras éxito.

Todos los pedidos envían Authorization: Bearer <token>. VITE_API_URL es el origen sin /api; por defecto http://localhost:5000. Se conserva la gestión de sesión de src/api.js.

## Interfaz

Perfil → Solicitar servicio → formulario → comprobante. No se inventan servicios si el catálogo está vacío o falla su carga. La carga fallida ofrece reintentar. Se usan page-container, page-heading, content-panel, field, form-stack, button y notice del diseño existente; Solicitudes.css solo agrega disposición y espaciado.

CancelarSolicitud puede incluirse en las tarjetas de Renzo pasando solicitud y onCancelada(idSolicitud), que debe actualizar el estado a Cancelada en el listado. El comprobante ya lo utiliza. Conserva el turno si se cierra el diálogo; confirmar hace PUT. Durante la petición bloquea dobles clics.

## Pruebas

Frontend: npm test. Cobertura con React/JSDOM y adaptador Axios simulado: carga de catálogo separado del perfil, POST con IDs correctos, respuesta anidada y navegación a comprobante, dirección máxima, catálogo vacío, creación rechazada, conservar turno, cancelar exitosamente y error de cancelación. Los contratos simulados reproducen el backend; no son pruebas contra MySQL vivo.

Backend: python -m unittest discover -s tests -q. Verifica catálogo de BD, precio serializado, autenticación, catálogo vacío y creación/detalle usando su ID, además de los casos previos de solicitudes. Usa SQLite en memoria.

Para comprobar visualmente: entrar como paciente, abrir perfil verificado/disponible, seleccionar un servicio real, fecha/hora futuras y dirección. Enviar, recargar el comprobante y probar conservar/cancelar. Confirmar el resultado contra MySQL en el entorno compartido al integrar.
