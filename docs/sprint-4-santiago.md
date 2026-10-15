# Sprint 4 - Backend de Santiago

Contrato de SCRUM-56, SCRUM-57 y SCRUM-58. Ver la [guía general](../README.md) y la [comparación con el PDF](comparacion-sprints-1-4.md).

## Sprint 4 — Santiago: solicitudes (SCRUM-56, SCRUM-57 y SCRUM-58)

### Dónde está cada parte

Se mantiene la estructura del backend: modelos SQLAlchemy en `models/`,
endpoints Flask en `routes/`, registro de Blueprints en `app.py` y pruebas en
`tests/`.

| Archivo dentro de `backend/` | Responsabilidad |
| --- | --- |
| `models/servicio_models.py` | Catálogo de servicios y precio estimado. |
| `models/solicitud_models.py` | Solicitud, estados permitidos y comprobante JSON (`to_dict`). |
| `routes/solicitud_routes.py` | Creación y consulta de Santiago; cambios de estado de Pablo. |
| `schema_sprint4.py` | Preparar las tablas y la columna de verificación al iniciar la app. |
| `tests/test_solicitudes.py` | Probar solicitudes, permisos y preparación de bases anteriores. |

En las rutas, `_validar_datos_solicitud()` comprueba y normaliza el formulario;
`crearSolicitud()` comprueba el acceso y la disponibilidad, guarda el pedido y
devuelve el comprobante. Los nombres de campos y de los métodos
`crearSolicitud()` y `confirmarSolicitud()` respetan la consigna. Las funciones
auxiliares usan `snake_case`, como el resto del backend, y el prefijo `_` indica
que se usan dentro de ese módulo.

Para cambiar una validación, revisar las rutas y sus pruebas. Para cambiar los
datos del comprobante, revisar `SolicitudServicio.to_dict()` y los ejemplos de
abajo. `ESTADOS_SOLICITUD` centraliza los estados permitidos por la base y
`ESTADOS_ACTIVOS` determina los que se muestran al paciente.

### Endpoints

Todas las rutas requieren
`Authorization: Bearer <token>` obtenido en `/api/login`.

| Método y ruta | Resultado | Quién puede usarlo |
| --- | --- | --- |
| `POST /api/solicitudes` | Crea una solicitud `Pendiente`; devuelve el comprobante y HTTP 201. | Paciente autenticado, para sí mismo. |
| `GET /api/solicitudes/<idSolicitud>` | Devuelve el comprobante y HTTP 200, sin modificar el estado. | Paciente dueño o enfermero destinatario. |
| `GET /api/solicitudes/paciente/<idPaciente>` | Lista las solicitudes `Pendiente` y `Aceptada` del paciente. | Ese paciente. |
| `GET /api/solicitudes/enfermero/<idEnfermero>` | Lista todas las solicitudes recibidas, con sus estados, paciente y dirección de atención. | Ese enfermero. |

Las listas son arrays JSON, ordenados por fecha, hora e ID de solicitud. Una lista
sin resultados devuelve `[]` con HTTP 200. «Activas» se define por estado, no por
fecha; esta entrega no implementa vencimiento automático.

### Modelos y preparación de la base

- `models/solicitud_models.py`: `SolicitudServicio`, tabla `solicitudes_servicio`,
  con exactamente los ocho campos solicitados: `idSolicitud`, `idPaciente`,
  `idEnfermero`, `idServicio`, `fecha`, `hora`, `estado` y `direccionAtencion`.
- No se encontró el modelo Servicio del Sprint 2 en las ramas disponibles del
  equipo. Se incorporó en `models/servicio_models.py` una definición mínima con
  los datos mencionados en la consigna: `idServicio`, `tipoServicio` y
  `precioEstimado` (`Numeric(10, 2)`, no negativo), tabla `servicios`.
  Es un catálogo general; no había una relación servicio-profesional definida.
- Se agregó `Enfermero.verificado`, por defecto `False`. La disponibilidad se
  consulta en el campo ya existente `Enfermero.disponible`; no se creó otro
  atributo llamado `disponibilidad`.
- Al iniciar `app.py`, `schema_sprint4.inicializar_bd_sprint4()` crea las tablas
  faltantes y agrega `verificado` si la base era anterior. Puede ejecutarse otra
  vez sin borrar datos ni reemplazar verificaciones existentes. La cuenta de BD
  necesita permisos de creación de tablas y de `ALTER TABLE`, como en Sprint 3.
- Los enfermeros existentes **no se verifican automáticamente** y el catálogo
  de servicios comienza vacío. La verificación y los precios deben ser cargados
  por quien administra la base; no se aceptan desde el formulario del paciente
  ni desde la edición del perfil del enfermero.

### IDs para Germán y Renzo

El JWT identifica a `Usuario`. Las solicitudes usan los IDs de `Paciente` y
`Enfermero`; **no hay que enviar el ID del JWT como si fuera el ID del perfil**.

- `GET /api/perfil/paciente` ahora incluye `idPaciente`.
- Los perfiles y resultados de enfermeros incluyen `idEnfermero` (equivale al
  campo existente `enfermero_id`). `id` y `usuario_id` mantienen su significado.
- El POST obtiene el paciente desde la sesión. Puede omitirse `idPaciente`;
  si se envía, debe corresponder al perfil de quien inició sesión.
- `idServicio` debe existir en `servicios`. Esta entrega no agrega un CRUD ni
  una pantalla de administración del catálogo.

### Crear una solicitud

Ejemplo de cuerpo JSON (usar IDs existentes y una fecha futura):

```json
{
  "idEnfermero": 201,
  "idServicio": 301,
  "fecha": "2030-01-11",
  "hora": "14:30",
  "direccionAtencion": "San Martín 123, Mendoza"
}
```

Validaciones: IDs enteros positivos, dirección de 1 a 200 caracteres (se recortan
espacios exteriores), fecha `AAAA-MM-DD` y hora `HH:MM` entre `00:00` y `23:59` (no `24:00`). El turno debe
ser futuro según hora de Argentina (UTC-3). El enfermero debe estar verificado y
disponible, y el servicio debe existir. No se admiten campos adicionales como
`estado`, `idSolicitud` o un precio enviado por el cliente.

Respuesta del POST:

```json
{
  "mensaje": "Solicitud creada",
  "solicitud": {
    "idSolicitud": 1,
    "idPaciente": 101,
    "idEnfermero": 201,
    "idServicio": 301,
    "fecha": "2030-01-11",
    "hora": "14:30",
    "estado": "Pendiente",
    "direccionAtencion": "San Martín 123, Mendoza",
    "paciente": {
      "idPaciente": 101,
      "nombre": "Ana",
      "apellido": "Prueba",
      "telefono": "2611111111"
    },
    "enfermero": {
      "idEnfermero": 201,
      "nombre": "Laura",
      "apellido": "Prueba",
      "matricula": "MAT-201",
      "especialidad": "General",
      "telefono": "2612222222"
    },
    "servicio": {
      "idServicio": 301,
      "tipoServicio": "Curaciones",
      "precioEstimado": "8500.50"
    }
  }
}
```

El header `Location` del POST apunta a `/api/solicitudes/1`. El GET de detalle
devuelve directamente el objeto interior `solicitud`; las listas contienen
objetos con esa misma estructura. El precio viene de `Servicio`, no de
`tarifa_hora` ni del cliente. Se envía como texto decimal para conservar los
centavos; la interfaz puede usar `Number(solicitud.servicio.precioEstimado)` para
mostrarlo. Es el precio estimado actual del catálogo, no un precio histórico
congelado. No se devuelve historial médico ni credenciales en el comprobante.

Errores de estas rutas: `400` por datos inválidos, `401` por falta de sesión,
sesión vencida o usuario eliminado, `403` por rol o titularidad incorrectos,
`404` por perfil/recurso inexistente, `409` por enfermero sin verificar o sin
disponibilidad, y `500` si no se pudo guardar (con rollback). El mensaje está en
`error`. Un JWT malformado también se responde con `401` mediante el handler de
la aplicación.

### Datos para una prueba local

Desde `backend`, en una **base local de prueba**, ejecutar
`python -m flask --app app shell` y cargar un servicio de ejemplo y habilitar
únicamente el profesional de demostración:

```python
from decimal import Decimal
from database import db
from models.servicio_models import Servicio
from models.usuario_models import Enfermero, Usuario

usuario_demo = Usuario.query.filter_by(email='laura.gomez@test.com').one()
enfermero_demo = Enfermero.query.filter_by(usuario_id=usuario_demo.id).one()
enfermero_demo.verificado = True
enfermero_demo.disponible = True
servicio_demo = Servicio.query.filter_by(tipoServicio='Curaciones (demo)').first()
if servicio_demo is None:
    servicio_demo = Servicio(tipoServicio='Curaciones (demo)', precioEstimado=Decimal('8500.50'))
    db.session.add(servicio_demo)

db.session.commit()
print(enfermero_demo.id, servicio_demo.idServicio)
```

Después, iniciar sesión como paciente y usar esos dos IDs en el POST. Consultar
el `Location` retornado y ambas bandejas con la sesión correspondiente. El GET
de confirmación mantiene `Pendiente`: consultar el comprobante no es aceptar el
servicio.

### Pablo: gestión de solicitudes (SCRUM-59, SCRUM-60 y SCRUM-61)

Las cuatro rutas están en el Blueprint existente `routes/solicitud_routes.py`,
usando `SolicitudServicio` de `models.solicitud_models`. Todas requieren JWT;
los permisos se comprueban con el rol y los perfiles guardados en la base.
El token identifica a `Usuario`, no a `Paciente` ni a `Enfermero`.

| Método y ruta | Transición permitida | Quién puede usarlo |
| --- | --- | --- |
| `PUT /api/solicitudes/<idSolicitud>/aceptar` | `Pendiente` → `Aceptada` | Enfermero asignado. |
| `PUT /api/solicitudes/<idSolicitud>/finalizar` | `Aceptada` → `Realizada` | Enfermero asignado (HU8). |
| `PUT /api/solicitudes/<idSolicitud>/rechazar` | `Pendiente` → `Rechazada` | Enfermero asignado. |
| `PUT /api/solicitudes/<idSolicitud>/cancelar` | `Pendiente` o `Aceptada` → `Cancelada` | Paciente dueño. |

No necesitan cuerpo JSON. Responden HTTP 200 con `mensaje` y `solicitud`, usando
el mismo comprobante del POST. No se toman identidades ni estados enviados en
el cuerpo para autorizar la operación. Un estado de origen inválido, incluida
la repetición de una acción ya realizada, devuelve `400`; otro rol o titular,
`403`; una solicitud inexistente, `404`; una sesión ausente, vencida o sin usuario,
`401`. Los errores de persistencia devuelven `500` y revierten el cambio.

La reserva se deriva del estado: un pedido `Pendiente` o `Aceptada` ocupa la
combinación enfermero, fecha y hora. El POST devuelve `409` si esa combinación
ya está ocupada. Rechazar o cancelar permite solicitarla nuevamente. No se
modifica `Enfermero.disponible` ni los bloques semanales de `Disponibilidad`.
Como el modelo no define duración, este control cubre el mismo inicio exacto,
no intervalos de atención superpuestos.

Las escrituras bloquean la fila del enfermero dentro de la transacción en
MySQL/InnoDB y actualizan el estado de forma condicional. Si existen pedidos
duplicados anteriores a esta validación, se permite rechazarlos o cancelarlos,
pero no aceptar otro cuando ya hay uno `Aceptada` para ese inicio (`409`).
Esta entrega no modifica el frontend ni implementa los sprints 5 o 6.

### Pruebas del sprint

`python -m unittest discover -s tests -v` ejecuta las pruebas nuevas y las
regresiones existentes. `tests/test_solicitudes.py` cubre creación/comprobante,
estado inicial, permisos por titular y rol, validaciones, ambas bandejas,
rollback, límites de datos expuestos, IDs de perfiles, consultas sin N+1 y
actualización repetible de bases nuevas y anteriores. También cubre las cuatro
transiciones de Pablo, estados inválidos, cancelación ajena, JWT, rollback y
reserva/liberación de horarios. Las pruebas usan SQLite
en memoria; no modifican `.env` ni la base configurada de la aplicación.
El bloqueo concurrente específico de MySQL/InnoDB requiere validación adicional
contra ese motor; SQLite no reproduce esos bloqueos de filas.
