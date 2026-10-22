# Despliegue del backend de Enfered

Guía para publicar el backend (Flask + MySQL) para gente real. Ningún valor de este archivo es real:
reemplazá cada ejemplo por el tuyo y nunca subas `backend/.env` al repositorio.

## 1. Qué necesitás

- Python 3.12 (o Docker).
- Una base MySQL 8 (o MariaDB 10.6+) vacía, por ejemplo `enfe_red`, con un usuario propio que solo tenga
  permisos sobre esa base.
- El frontend publicado en HTTPS (su dirección va en `FRONTEND_ORIGINS`).
- Opcional: una cuenta SMTP para mandar correos (recuperación de contraseña y avisos de turnos).
- Opcional: una clave de Gemini para la búsqueda asistida por IA.

## 2. Variables de entorno

Copiá `backend/.env.example` a `backend/.env` (o cargalas en el panel del hosting) y completá:

| Variable | ¿Obligatoria? | Para qué sirve | Valor de producción |
| --- | --- | --- | --- |
| `DATABASE_URL` | Sí | Conexión a MySQL: `mysql+pymysql://USUARIO:CLAVE@HOST:3306/enfe_red`. Símbolos de la clave codificados (`@` = `%40`). | La de tu base |
| `JWT_SECRET_KEY` | Sí | Firma las sesiones. Mínimo 32 caracteres. | Generada (ver 3) |
| `CLAVE_CIFRADO_DATOS` | Sí con `FLASK_DEBUG=0` | Cifra el historial médico. Para cambiarla seguí los pasos de la sección 3 (si no, los historiales no se pueden leer). | Generada (ver 3) |
| `CLAVE_CIFRADO_ANTERIOR` | No | Solo al cambiar la clave: la clave vieja (o varias separadas por coma), para leer lo guardado y pasarlo a la nueva. | Vacía |
| `FRONTEND_ORIGINS` | Sí con `FLASK_DEBUG=0` | Direcciones del frontend que pueden usar la API, separadas por coma, sin barra final. No acepta `*`. | `https://enfered.example` |
| `FLASK_DEBUG` | No (0) | 1 solo en desarrollo (debugger, recarga, correos en consola). | `0` |
| `AUTO_MIGRAR` | No (0) | 1 prepara la base cada vez que arranca la app. | `0` (usá `preparar-bd`) |
| `CARGAR_DEMO` | No (0) | 1 crea cuentas demo con clave 123456 al preparar la base. | `0` siempre |
| `PORT` | No (5000) | Puerto de `serve.py`. Muchos hostings lo fijan solos. | El del hosting |
| `WAITRESS_THREADS` | No (4) | Pedidos que se atienden a la vez. | `4` a `8` |
| `LOG_LEVEL` | No (INFO) | DEBUG, INFO, WARNING, ERROR o CRITICAL. | `INFO` |
| `HTTPS` | No (0) | 1 agrega `Strict-Transport-Security`. Activalo solo cuando el sitio ya funcione con HTTPS. | `1` |
| `PROXY_CONFIABLE` | No (0) | 1 solo detrás de un proxy propio (nginx, el balanceador del hosting) que manda `X-Forwarded-For`. Sin esto, los límites de intentos ven a todos con la IP del proxy (si llega `X-Forwarded-For`, el backend lo avisa en el log). | `1` si hay proxy |
| `JWT_ACCESS_MINUTOS` | No (60) | Duración del token de acceso. | `60` |
| `JWT_REFRESH_DIAS` | No (30) | Duración de la sesión renovable. | `30` |
| `SMTP_HOST` | No | Servidor de correo. Sin él no se envían correos (solo se registra una advertencia). | El de tu proveedor |
| `SMTP_PORT` | No (587) | 587 con STARTTLS; 465 con TLS directo. | `587` |
| `SMTP_USUARIO` / `SMTP_CLAVE` | No | Credenciales SMTP. | Las de tu proveedor |
| `SMTP_TLS` | No (1) | 1 usa STARTTLS. | `1` |
| `CORREO_REMITENTE` | No | Dirección que ve el usuario (si falta, se usa `SMTP_USUARIO`). | `avisos@enfered.example` |
| `IA_PROVEEDOR` | No (reglas) | `reglas` (sin IA) o `gemini`. Si la IA falla, se usan las reglas. | `reglas` o `gemini` |
| `GEMINI_API_KEY` | Con `gemini` | Clave de Google AI Studio. | La tuya |
| `GEMINI_MODELO` | No | Modelo de Gemini. | `gemini-flash-lite-latest` |
| `BACKUP_DIR` | No (backups) | Carpeta de las copias, relativa a `backend/`. | Fuera de lo público |
| `BACKUP_CONSERVAR` | No (14) | Cuántas copias guardar. | `14` |
| `MYSQLDUMP` | No | Ruta a `mysqldump` si no está en el PATH. | Según el servidor |

Frontend: en `frontend/.env` va `VITE_API_URL` con la dirección del backend, sin `/api` al final
(por ejemplo `https://api.enfered.example`). Se lee al compilar (`npm run build`).

Si falta una variable obligatoria, el backend no arranca y explica en la consola qué falta y cómo generarla.

## 3. Cómo generar las claves

Con el Python del proyecto (`backend/venv`):

```bash
# JWT_SECRET_KEY
python -c "import secrets; print(secrets.token_urlsafe(48))"
# CLAVE_CIFRADO_DATOS
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

- Generá claves nuevas para producción: no reutilices las de tu computadora.
- Guardá `CLAVE_CIFRADO_DATOS` en un lugar seguro además del servidor (un gestor de contraseñas).
  Si se pierde, los historiales médicos guardados no se pueden recuperar, ni siquiera con los backups.
- Configurá `CLAVE_CIFRADO_DATOS` también en tu computadora si tu base tiene datos reales. Sin ella, con
  `FLASK_DEBUG=1` el historial se guarda **sin cifrar** (se avisa en la consola) y se cifra recién cuando
  la configurás y corrés `flask --app app preparar-bd`.
- Cambiar `JWT_SECRET_KEY` cierra la sesión de todos (tienen que volver a entrar). Antes de cambiarla,
  asegurate de tener `CLAVE_CIFRADO_DATOS` configurada y de haber corrido `preparar-bd`: si alguna versión
  anterior cifró historiales con la clave de desarrollo (que sale de `JWT_SECRET_KEY`), ese paso los pasa
  a tu clave; después de cambiar `JWT_SECRET_KEY` ya no se podrían leer.
- Para cambiar `CLAVE_CIFRADO_DATOS`: poné la nueva en `CLAVE_CIFRADO_DATOS`, la vieja en
  `CLAVE_CIFRADO_ANTERIOR`, corré `flask --app app recifrar-historiales` y, cuando diga que no quedan
  historiales sin abrir, borrá `CLAVE_CIFRADO_ANTERIOR`. Hacé un backup antes.

## 4. Pasos de despliegue

### Sin Docker (Linux o Windows)

```bash
cd backend
python -m venv venv
# Linux: source venv/bin/activate    Windows: venv\Scripts\activate
pip install -r requirements.txt
# 1) Preparar la base: crea tablas y aplica las migraciones pendientes sin borrar datos.
flask --app app preparar-bd
# 2) Levantar el servidor de producción (waitress, en 0.0.0.0:PORT).
python serve.py
```

- **Corré `flask --app app preparar-bd` en cada despliegue**, antes de `serve.py`. Se puede repetir sin
  problema: cada migración revisa qué falta. La app ya no migra sola al arrancar (salvo con
  `FLASK_DEBUG=1`, `AUTO_MIGRAR=1` o `python app.py`), así varias instancias no tocan la base a la vez.
  Si te olvidás, `serve.py` no arranca y explica que falta correr `preparar-bd`.
- `python app.py` es solo para desarrollo: el servidor de Flask no está pensado para gente real.
- Para el primer administrador: `flask --app app asignar-administrador tu-correo@enfered.example`
  (la cuenta tiene que estar registrada antes).
- Recomendado: un cron cada 15 minutos con `flask --app app vencer-solicitudes` (las bandejas ya vencen
  los turnos al consultarse; esto además avisa a tiempo a los pacientes).
- Poné delante un proxy con HTTPS (nginx, Caddy o el del hosting) y, si es tuyo, `PROXY_CONFIABLE=1`.
  Con el sitio ya en HTTPS, `HTTPS=1`.

### Con Docker

```bash
cd backend
docker build -t enfered-backend .
docker run --rm --env-file .env enfered-backend python -m flask --app app preparar-bd
docker run -d --name enfered-backend --env-file .env -p 5000:5000 --restart unless-stopped enfered-backend
```

- La imagen no incluye `.env`, `venv`, `tests` ni los backups (`.dockerignore`): las variables van con
  `--env-file` o el panel del hosting. En `--env-file` no uses comillas alrededor de los valores.
- Dentro del contenedor `localhost` es el propio contenedor: en `DATABASE_URL` poné el nombre o la IP del
  servidor MySQL.
- La imagen corre `python serve.py` con un usuario sin permisos de administrador y trae un `HEALTHCHECK`
  contra `/api/health`.

## 5. Health check

`GET /api/health` (sin sesión) hace `SELECT 1` en la base y revisa que esté migrada:

- `200 {"estado": "ok"}`: la API y la base responden.
- `503 {"estado": "error"}`: la base no contesta o le falta correr `preparar-bd`. No muestra detalles; el
  motivo queda en el log.

Configuralo en el hosting o en un monitor externo (por ejemplo cada minuto) para que avise si se cae.

## 6. Registro (logs)

- Todo se escribe en la salida estándar, con fecha y nivel:
  `2026-10-22 15:04:05 INFO [app] Base de datos lista (tablas y migraciones al día).`
- El nivel se elige con `LOG_LEVEL`. Los mensajes no incluyen emails, teléfonos, historiales ni textos de
  los usuarios (la búsqueda por IA solo registra la fuente y el tiempo).
- waitress no registra cada pedido; si querés ese registro, activalo en el proxy.

## 7. Seguridad que ya viene activada

- Fuera de debug, el backend no arranca sin `JWT_SECRET_KEY`, `CLAVE_CIFRADO_DATOS` y `FRONTEND_ORIGINS`.
- CORS solo para los orígenes de `FRONTEND_ORIGINS`.
- En todas las respuestas: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
  y `X-Frame-Options: DENY`; con `HTTPS=1`, también `Strict-Transport-Security: max-age=31536000`.
- Cuerpos de más de 1 MB se rechazan; los intentos de login y de recuperación tienen límites.

## 8. Copias de seguridad

```bash
cd backend
python scripts/backup_mysql.py
```

- Lee `DATABASE_URL` de `backend/.env`, corre `mysqldump` (copia consistente, sin frenar la app) y guarda
  `enfered-<base>-AAAAMMDD-HHMMSS.sql.gz` en `BACKUP_DIR`. Conserva las últimas `BACKUP_CONSERVAR` copias.
- La contraseña nunca va en la línea de comandos: se pasa en un archivo de opciones temporal que se borra al terminar.
- Necesita el cliente de MySQL (`mysqldump`). En Debian/Ubuntu: `apt install default-mysql-client`; en
  Windows viene con MySQL Server (si no está en el PATH, poné la ruta en `MYSQLDUMP`). La imagen Docker no
  lo trae: corré el backup desde el servidor de la base o desde otra máquina con el cliente instalado.
- Programalo una vez por día: cron en Linux, por ejemplo `0 3 * * * cd /ruta/backend && venv/bin/python scripts/backup_mysql.py`,
  o el Programador de tareas en Windows.
- Las copias tienen datos personales y de salud: guardalas con acceso restringido y copiá alguna a otro
  lugar (otro disco o un almacenamiento externo cifrado). Una copia que nunca se probó no es una copia:
  cada tanto restaurala en una base de prueba:

```bash
gunzip -c backups/enfered-enfe_red-20261022-030000.sql.gz | mysql -u USUARIO -p enfe_red_prueba
```

## 9. Lista para cada despliegue

1. Backup de la base (`python scripts/backup_mysql.py`).
2. Actualizar el código y `pip install -r requirements.txt`.
3. `flask --app app preparar-bd`.
4. Reiniciar `python serve.py` (o el contenedor).
5. Revisar `GET /api/health` y entrar al sitio.
