# Comparación con la documentación: sprints 1 a 3 y Sprint 4 de Santiago

Revisión del 15/10/2026. Referencia académica: **Enfe-Red Proyecto de Practica
Profesionalizante 3.pdf**, 30 páginas, facilitado por Santiago. Se cuentan las
páginas desde la primera hoja del archivo. El PDF no se modificó ni se agregó
al repositorio; consultar el ejemplar compartido por el equipo.

Referencia técnica actualizada: entrega de `Santiago` para `Prueba`, sobre
la base `52a785a`, incluyendo el backend de solicitudes SCRUM-56/57/58,
su documentación y la limpieza de estructura. Se consultaron las ramas remotas con
`git fetch origin`; su existencia por sí sola no implica integración.
Ver el [mapa de ramas](../README.md#ramas-y-estado-de-integración).

## Cronograma de entregas a la profesora

Ver también el [mapa de navegación de referencia](mapa-de-navegacion.md) para
relacionar las entregas con los recorridos de paciente, enfermero y administrador.

Fechas y alcance comprometidos en el cuadro compartido por Pablo. Las fechas
se expresan en día/mes y corresponden a la presentación de cada incremento.

| Sprint / entrega | Fecha de presentación | Funcionalidades comprometidas |
| --- | --- | --- |
| 1 — Registro y perfiles | **07/09** | Registro de enfermeros y pacientes, edición del perfil del usuario y visualización del perfil de otros usuarios. |
| 2 — Configuración y disponibilidad | **21/09** | Configuración de perfiles de usuario y gestión de disponibilidad: información pública de pacientes y enfermeros y definición de horarios. |
| 3 — Búsqueda y geolocalización | **05/10** | Motor de búsqueda avanzado, filtros y geolocalización: mapa, ubicación de profesionales cercanos y segmentación por servicio. |
| 4 — Gestión de solicitudes | **19/10** | Gestión integral de solicitudes: creación, aceptación, rechazo y cancelación de turnos. |
| 5 — Comunicación y reputación | **02/11** | Canales de comunicación, notificaciones y sistema de reputación: mensajería interna, publicación de reseñas y calificaciones. |
| 6 — Administración y validación | **16/11** | Panel de administración, validación profesional y moderación: verificación de matrículas, gestión de permisos y control de calidad. |

Este calendario es la referencia para preparar las demostraciones a la profesora.
El reparto interno de tareas es una planificación distinta: aunque allí reseñas
y calificaciones se asignaron al Sprint 6, su presentación está comprometida para
el **02/11**, junto con comunicación y notificaciones.

El cuadro registra compromisos, no certifica que estén implementados. La
comparación detallada de abajo conserva el alcance histórico de la revisión de
Santiago; las transiciones de Pablo del Sprint 4 ya integradas se describen en
el [contrato actualizado de solicitudes](sprint-4-santiago.md).

## Alcance y criterio

Se comparan exclusivamente:

- Sprint 1: SCRUM-41 a SCRUM-46.
- Sprint 2: SCRUM-47 a SCRUM-51.
- Sprint 3: SCRUM-52 a SCRUM-55.
- Sprint 4 de Santiago: subtareas backend 56.1, 56.2, 57.1, 58.1 y 58.2 del
  reparto comunicado por el equipo, correspondientes a SCRUM-56/57/58.

La asignación de esas subtareas proviene del reparto compartido por Santiago;
el PDF de la página 22 enumera las actividades generales, no ese detalle de API.
No se evalúan las interfaces del Sprint 4 ni las transiciones asignadas a Pablo.
Tampoco se penaliza la ausencia de funciones de los sprints 5 y 6. Una diferencia
del modelo se registra como tal, sin convertir toda clase futura del diagrama
en una obligación de esta entrega.

**Estados utilizados:**

- **Presente:** existe la implementación correspondiente; no significa prueba
  exhaustiva de todos los escenarios en producción.
- **Parcial:** existe parte del recorrido, pero falta una condición relevante
  de la documentación o la implementación es más limitada.
- **No implementado:** no hay un flujo operativo en el código revisado.
- **Alinear documentación:** el diseño escrito no describe literalmente el código.

## Sprint 1: usuarios y perfiles

La planificación de la página 22 enumera registro, sesión, recuperación,
edición de perfil y visualización de perfiles de paciente/enfermero. La HU1 de
la página 4 describe el registro de pacientes.

| Actividad | Estado | Evidencia y alcance |
| --- | --- | --- |
| SCRUM-41 Registro | Presente | `POST /api/registro` crea Usuario y perfil. Roles paciente/enfermero; contraseña con Bcrypt; campos obligatorios y email duplicado. |
| SCRUM-42 Inicio de sesión | Presente | `POST /api/login` valida credenciales y emite JWT con rol; React protege la navegación y controla expiración. |
| SCRUM-43 Recuperación | Parcial | Se genera y valida código con vencimiento, intentos y uso único. Se imprime en consola; no hay envío de correo. No presentarlo como recuperación completa por email. |
| SCRUM-44 Edición de perfil | Presente, con diferencia del modelo | GET/PUT propios para ambos roles y formulario común. Falta `obraSocial` descrita para Paciente en el diagrama. |
| SCRUM-45 Perfil de paciente | Presente | Pantalla propia con nombre, apellido, contacto, dirección e historial médico. |
| SCRUM-46 Perfil de enfermero | Presente | Perfil propio/profesional con especialidad, matrícula, contacto, tarifa, descripción, disponibilidad y horarios. |

Fuentes: [rutas de usuarios](../enfe-red/backend/routes/usuario_routes.py),
[recuperación](../enfe-red/backend/routes/auth_routes.py),
[rutas React](../enfe-red/frontend/src/App.jsx) y
[editor de perfiles](../enfe-red/frontend/src/components/ProfileEditor.jsx).

El registro valida requisitos básicos. No se interpreta que la presencia de
esas comprobaciones cubra toda posible validación: por ejemplo, las rutas de
registro/login no normalizan todos los tipos de JSON antes de usar sus campos.
La validación de una matrícula no debe confundirse con comprobar que el texto
no esté vacío o repetido.

## Sprint 2: profesionales, disponibilidad y servicios

La página 22 asigna a este sprint verificación de matrícula, disponibilidad,
administración de perfiles, servicios y validación de registro. La HU9 de la
página 10 requiere que un administrador vea pendientes, revise matrícula/datos,
apruebe o rechace y que los aprobados aparezcan en búsquedas.

| Actividad | Estado | Evidencia y diferencia |
| --- | --- | --- |
| SCRUM-47 Verificación de matrícula | Parcial | Existe matrícula y, con la entrega del Sprint 4, `verificado=False`. No hay API/pantalla administrativa para aprobar/rechazar. El booleano solo no distingue pendiente de rechazado como HU9. |
| SCRUM-48 Disponibilidad | Parcial | Se edita `disponible` y se agregan/consultan franjas semanales. Se rechazan duplicados y superposiciones de franjas. No hay edición/borrado de franjas, aunque las capturas del PDF muestran esos controles. |
| SCRUM-49 Administración de perfiles | Parcial | El enfermero edita su propio perfil; no está implementada la administración de perfiles por el administrador que aparece en la planificación. |
| SCRUM-50 Servicios ofrecidos | Parcial | El modelo mínimo `Servicio` se incorporó como dependencia del Sprint 4. No hay gestión del catálogo y falta `descripcion` del diagrama. Especialidad y tarifa/hora no equivalen al catálogo de servicios. |
| SCRUM-51 Validación de datos | Parcial | Hay comprobaciones de registro, matrícula única, rangos numéricos, coordenadas y horarios. No está el circuito administrativo de verificación de datos profesionales. |

Fuentes: [modelos de usuarios](../enfe-red/backend/models/usuario_models.py),
[Servicio](../enfe-red/backend/models/servicio_models.py),
[rutas](../enfe-red/backend/routes/usuario_routes.py) y
[horarios activos](../enfe-red/frontend/src/components/GestionHorarios.jsx).

**Dependencia importante para tu Sprint 4:** crear solicitudes exige un
enfermero verificado y un servicio existente. El catálogo inicia vacío y el
arranque no verifica profesionales automáticamente. Hoy hay que preparar esos
datos en una base de prueba para probar el POST; eso no reemplaza el flujo de
administración documentado para Sprint 2.

La búsqueda actual no filtra `verificado`. Por eso un profesional puede aparecer
en la cartilla y luego ser rechazado al solicitarle atención. Corresponde acordar
e implementar la regla de visibilidad de HU9 cuando se complete esa dependencia.

**Asignación documentada:** HU9 figura a nombre de Santiago, iteración 2. Ese
dato no significa que verificar matrículas forme parte del reparto nuevo de
SCRUM-56/57/58; es una tarea anterior que el equipo debe confirmar en su plan.
No se atribuye aquí la construcción de todo el panel futuro a tu Sprint 4.

## Sprint 3: búsqueda, filtros y geolocalización

Referencias: HU3 (página 5), actividades de la página 22 e informe del
incremento 3 (página 29).

| Actividad | Estado | Evidencia y diferencia |
| --- | --- | --- |
| SCRUM-52 Búsqueda por ubicación | Parcial | La búsqueda acepta texto, ciudad y dirección. No filtra por radio ni ordena por proximidad a las coordenadas del paciente. |
| SCRUM-53 Filtro por tipo de servicio | No implementado como está descrito | Hay filtro de especialidad, precio, disponibilidad y día; no de servicio del catálogo. |
| SCRUM-54 Enfermeros cercanos | Parcial | Hay tarjetas, marcadores y selección sincronizada. El mapa representa los resultados paginados de búsqueda, no un resultado calculado por cercanía. |
| SCRUM-55 Geolocalización | Presente para ubicación manual | Hay coordenadas persistidas, ubicación del navegador y ruta OSRM al profesional seleccionado. Desde `52a785a`, el perfil permite elegir/quitar su punto en un mapa. No hay conversión automática de direcciones en coordenadas. |

Fuentes: [API de búsqueda](../enfe-red/backend/routes/usuario_routes.py),
[cartilla](../enfe-red/frontend/src/components/ListaEnfermeros.jsx),
[filtros](../enfe-red/frontend/src/components/DirectoryFilters.jsx) y
[mapa](../enfe-red/frontend/src/components/MapaEnfermeros.jsx) y
[selector de ubicación](../enfe-red/frontend/src/components/LocationPicker.jsx).

Dos diferencias requieren explicación en la entrega:

1. HU3 pide mostrar solo disponibles. La interfaz actual ofrece todos, solo
   disponibles o no disponibles; el filtro es opcional. HU9 además exige la
   aprobación previa para aparecer en búsquedas, condición todavía no aplicada.
2. La página 29 afirma que Flask calcula distancias y filtra por servicio. En
   este código la distancia de recorrido viene de OSRM consultado desde React.
   El backend no devuelve `distancia_km` ni consulta el catálogo en la búsqueda.
   No es correcto presentar la implementación actual como cálculo SQL de cercanía.

La tarjeta está preparada para mostrar puntuación/distancia si llegan en la
respuesta, pero la API actual no aporta esos datos. No se exige implementar
el sistema de reseñas de un sprint posterior en esta revisión.

## Sprint 4: solo backend de Santiago

Se contrasta el reparto de tareas compartido por Santiago, las actividades
56/57/58 de la página 22, las HU4/HU7/HU8 (páginas 6, 8 y 9), los casos de uso
de la página 14 y el modelo de la página 15.

| Subtarea | Estado del alcance backend | Evidencia |
| --- | --- | --- |
| 56.1 Modelo SolicitudServicio | Presente | Ocho campos del diagrama, FK a paciente/enfermero/servicio y estado inicial Pendiente. |
| 56.2 Crear solicitud | Presente | POST `/api/solicitudes`; paciente autenticado, datos válidos, fecha futura, enfermero verificado/disponible y servicio existente. |
| 57.1 Comprobante | Presente | GET `/api/solicitudes/<idSolicitud>` devuelve resumen con paciente, enfermero y `Servicio.precioEstimado`; acceso por titular/destinatario. |
| 58.1 Consulta del paciente | Presente | GET por `idPaciente`; solo solicitudes Pendiente/Aceptada del paciente autenticado. |
| 58.2 Consulta del enfermero | Presente | GET por `idEnfermero`; pedidos recibidos con paciente, dirección y estado. |

Fuentes: [modelo](../enfe-red/backend/models/solicitud_models.py),
[rutas](../enfe-red/backend/routes/solicitud_routes.py),
[pruebas](../enfe-red/backend/tests/test_solicitudes.py) y
[contrato completo](sprint-4-santiago.md).

**Conclusión de tu entrega:** el backend implementa las cinco subtareas
solicitadas. El flujo completo en pantalla depende de trabajos de otros
integrantes y de los datos previos de verificación/catálogo. Esas interfaces y
transiciones no se contabilizan como incumplimientos de tu parte.

`confirmarSolicitud()` es consultar un comprobante, no aceptar la atención.
El POST comprueba `disponible`, no reserva una franja ni impide todos los cruces
de turnos. La gestión de reservas y transiciones debe coordinarse con el equipo;
no se amplió silenciosamente el alcance de SCRUM-56.

## Diagramas y estructura: qué coincide y qué hay que alinear

- **Relaciones de solicitudes:** coinciden con las multiplicidades de páginas
  15 y 17: cada pedido tiene un paciente, un enfermero y un servicio; cada uno
  puede participar en múltiples solicitudes.
- **Herencia:** páginas 15-17 presentan Usuario como base de Paciente/Enfermero
  y describen métodos polimórficos. El código utiliza tablas con relación uno a
  uno y funciones en Blueprints. Es un diseño válido, pero no demuestra esa
  herencia Python. La página 26 ya describe la separación relacional actual.
  Acordar con la cátedra si se debe ajustar el modelo conceptual o implementar
  explícitamente el requisito de orientación a objetos.
- **Atributos:** `obraSocial` del paciente y `descripcion` del servicio no están.
  `disponibilidad` del diagrama se llama `disponible` en el código; no son dos
  indicadores diferentes. Teléfono se guarda como texto y el precio de Servicio
  como decimal, decisiones razonables que conviene reflejar en el diseño técnico.
- **IDs y bajo acoplamiento:** conservar FK en SQLAlchemy es compatible con
  modelar asociaciones en UML. El diagrama simplificado de la página 19 no
  requiere eliminar las claves foráneas de las tablas.
- **Casos de uso:** registro, sesión, edición y búsqueda tienen código; verificar
  matrícula aún no tiene el recorrido administrativo. Solicitar/consultar está
  cubierto en la API de Santiago, no todavía en el recorrido integrado de UI.
- **Historias:** HU4 y HU7 repiten gran parte de la solicitud. Conviene distinguir
  su alcance para evitar contar dos veces la misma entrega. Las versiones del
  story map y las fechas de planificación no están totalmente alineadas con
  los incrementos; se usó la lista SCRUM de la página 22 para esta comparación.

## Organización realizada en esta revisión

Se mantuvo `enfe-red/backend` y `enfe-red/frontend`, con sus imports y rutas
vigentes. Se retiraron únicamente las dos copias desconectadas de
`frontend/frontend/src/components`, el lockfile huérfano de la raíz y el
seguimiento Git de dependencias/base local. Las dependencias y la base existente
permanecen en disco. El informe histórico se movió a `docs/historial/` y el
contrato de Sprint 4 se conservó en `docs/`.

Esta organización no implementa los faltantes funcionales detectados, no cambia
la base de datos y no incorpora código de otras ramas. Las verificaciones de
regresión se ejecutaron inicialmente después de la limpieza:

| Comprobación | Resultado |
| --- | --- |
| Backend: `python -m unittest discover -s tests -v` | 32 pruebas aprobadas, usando SQLite en memoria. |
| Frontend: `npm.cmd run lint` | Aprobado. |
| Frontend: `npm.cmd test` | 13 pruebas aprobadas con JSDOM y respuestas simuladas. |
| Frontend: `npm.cmd run build` | Compilación aprobada. |

El backend emitió avisos existentes de `Query.get()` de SQLAlchemy y conexiones
SQLite sin cerrar en pruebas; no produjeron fallos y no se cambiaron durante
esta tarea de organización. Estos resultados no certifican el envío de correos,
los servicios externos del mapa ni un recorrido completo del Sprint 4 en UI.
No se inició `app.py` contra la base configurada para realizar esta revisión.
Además se verificaron 30 enlaces locales de documentación, se compararon los
hashes de 48 archivos de código activo (sin cambios) y se comprobó que la base
local conserva exactamente el contenido anterior a la limpieza.

## Actualización tras integrar Prueba

El 15/10/2026 se ejecutó `git pull --ff-only origin Prueba` desde `Santiago`.
Se integró `52a785a` sin conflictos. Antes del pull se respaldaron los cambios
locales; se verificó que los 23 archivos locales registrados en ese respaldo
conservaran su contenido/estado después de la integración. En ese momento la
entrega del Sprint 4 seguía local; su publicación posterior se registra abajo.

El commit incorpora el selector de ubicación profesional, validación conjunta
de latitud/longitud, limpieza de coordenadas al cambiar dirección, apellido
opcional, nuevo código de recuperación desde la misma pantalla, acceso directo
a horarios e imágenes WebP de menor tamaño en la landing. Esas mejoras
actualizan la observación de SCRUM-55; no completan la verificación
administrativa, el catálogo ni la búsqueda por radio/servicio.

| Comprobación sobre la combinación actual | Resultado |
| --- | --- |
| Suite completa del backend | 38 pruebas aprobadas. |
| Suite del frontend | 18 pruebas aprobadas. |
| Lint y compilación del frontend | Aprobados. |
| Arranque real de Flask y módulos integrados | 18 comprobaciones de endpoints aprobadas mediante el cliente de pruebas, con SQLite temporal. |

La prueba de integración registró paciente y enfermero, inició sesiones reales
del backend, editó la ubicación, consultó el perfil desde la búsqueda y usó los
IDs retornados para crear y consultar una solicitud. Se verificó que el precio
viniera del catálogo, que ambas bandejas reflejaran el pedido y que editar la
dirección del profesional conservara sus IDs, verificación y acceso al pedido.
También se comprobaron los rechazos por falta de verificación, falta de
disponibilidad y ausencia de sesión.

El servicio y la aprobación del profesional se prepararon explícitamente como
datos de prueba en esa base temporal. No se modificó la base de desarrollo ni
se simuló que existiera un panel administrativo. La integración se comprobó
en la API; el frontend de solicitudes de otros integrantes sigue fuera de esta
entrega. No se probó manualmente en navegador el servicio externo de mapas ni
se certificó aquí una instalación nueva en MySQL.

## Entrega de Santiago a Prueba

El 15/10/2026 se preparó la publicación conjunta del backend SCRUM-56/57/58,
su documentación y la limpieza de estructura, con el mensaje de commit
`feat(sprint-4): completar la parte de Santiago (SCRUM-56, SCRUM-57 y SCRUM-58)`.
Antes del push se repitieron las 38 pruebas del backend y las 18 del frontend,
además de lint y build: todas aprobadas. `origin/Prueba` seguía en `52a785a`;
la entrega se integra sin conflictos y sin incorporar tareas de otros
integrantes del Sprint 4. El README general registra las ramas de destino.

## Orden sugerido para coordinar con el equipo

1. Confirmar cómo se entregarán la verificación de matrícula y la administración
   de servicios que la planificación ubica en Sprint 2.
2. Completar o aclarar en el PDF los criterios reales de búsqueda por servicio,
   disponibilidad/verificación y cercanía de Sprint 3.
3. Resolver las diferencias académicas de modelo (herencia y campos) antes de
   afirmar que diagrama y código coinciden literalmente.
4. Compartir el contrato backend de Santiago para integrar las partes del
   Sprint 4 cuando el equipo las trabaje. No se solicita adelantar sprints 5/6.
