# Publicar Enfered gratis (demo y piloto chico)

Guía para subir la app a internet sin pagar y sin tarjeta, pensada para la presentación de la facultad y
para un piloto chico con datos ficticios. Los detalles técnicos del backend (todas las variables,
backups, logs) están en [backend/DEPLOY.md](backend/DEPLOY.md).

Información de planes revisada en octubre de 2026. Las fuentes están al final.

## 1. Qué usamos

| Pieza | Proveedor | Por qué |
|---|---|---|
| Frontend (React + Vite) | **Cloudflare Pages** | Gratis, sin tarjeta, tráfico ilimitado y 500 builds por mes. |
| Backend (Flask + waitress, Docker) | **Render, instancia Free** | Sin tarjeta, 750 horas por mes y acepta el `Dockerfile` del repo. Se duerme a los 15 minutos sin uso. |
| Base de datos | **TiDB Cloud Starter** | Compatible con MySQL (el código usa `ALTER` propios de MySQL), 5 GiB gratis y sin tarjeta. |
| Búsqueda con IA | **Gemini** | La clave que ya tenemos. Si falla, la app usa las reglas. |
| Correo | Todavía no | Sin SMTP la app funciona igual, pero no llegan los códigos de recuperación ni los avisos por correo. Ver la sección 6. |

Opciones descartadas:
- **Koyeb, Fly.io y Google Cloud Run** piden tarjeta.
- **Railway** es solo una prueba de USD 5.
- **PythonAnywhere gratis** ya no trae MySQL para cuentas nuevas y no puede conectarse a TiDB.
- **Render Postgres** vence a los 30 días y no es MySQL.
- **Aiven MySQL Free** (1 GB) sirve como alternativa a TiDB, pero puede apagarse si no se usa.

Así queda armado:

```
Navegador ──► https://enfered.pages.dev            (Cloudflare Pages)
                 │ VITE_API_URL
                 ▼
             https://enfered-api.onrender.com      (Render Free: python serve.py)
                 │ DATABASE_URL (TLS)                │ GEMINI_API_KEY
                 ▼                                   ▼
             TiDB Cloud Starter (MySQL, :4000)    Google Gemini
```

Los nombres `enfered` y `enfered-api` son ejemplos. Si el proveedor te da otros, reemplazalos en todos lados.

## 2. Antes de empezar (10 minutos)

1. El código tiene que estar subido a GitHub en la rama que vas a publicar (por ejemplo `main` o `Prueba`).
   En este repo el proyecto está dentro de la carpeta `enfe-red/`.
2. Generá las claves **de producción** (distintas de las de tu computadora) con el Python del backend y
   guardalas en un gestor de contraseñas:
   ```powershell
   cd "C:\Proyectos programacion\Enfe-red\enfe-red\backend"
   .\venv\Scripts\python.exe -c "import secrets; print(secrets.token_urlsafe(48))"                                # JWT_SECRET_KEY
   .\venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # CLAVE_CIFRADO_DATOS
   ```
   `CLAVE_CIFRADO_DATOS` cifra el historial médico. Tiene que ser **la misma** en Render y cuando prepares
   la base desde tu PC. Si se pierde, los historiales no se pueden leer nunca más, ni con backups.
3. Tené a mano la clave de Gemini (Google AI Studio).

## 3. Paso 1: crear la base en TiDB Cloud Starter

1. Entrá a https://tidbcloud.com y registrate con GitHub o Google.
2. Creá una instancia **Starter** en la región **AWS us-east-1 (N. Virginia)**, cerca de Render.
3. En **Connect** elegí **Public**, tocá **Generate password** y anotá:
   - la contraseña (se muestra una sola vez);
   - el host (algo como `gateway01.us-east-1.prod.aws.tidbcloud.com`);
   - el puerto `4000`;
   - el usuario completo, que viene con un prefijo (por ejemplo `3abcXYZ.root`).
4. En el **SQL Editor** ejecutá `CREATE DATABASE enfe_red;`.
5. Armá dos versiones de `DATABASE_URL`. TiDB solo acepta conexiones cifradas: lo que activa el cifrado es el
   parámetro `?ssl_ca=`, que PyMySQL usa para validar el certificado.
   - **Para Render** (la imagen es `python:3.12-slim`, Debian):
     ```
     mysql+pymysql://3abcXYZ.root:CLAVE@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/enfe_red?ssl_ca=/etc/ssl/certs/ca-certificates.crt
     ```
   - **Para tu PC con Windows:** bajá https://letsencrypt.org/certs/isrgrootx1.pem a `C:\certs\isrgrootx1.pem` y usá:
     ```
     mysql+pymysql://3abcXYZ.root:CLAVE@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/enfe_red?ssl_ca=C:/certs/isrgrootx1.pem
     ```
   Si la contraseña tiene `@ : / ? # %`, escribilos codificados (`@` es `%40`).

## 4. Paso 2: preparar la base desde tu PC (una vez, antes de publicar el backend)

El backend de producción (`serve.py`) **no arranca si la base no está preparada**, y Render Free no tiene
consola. Por eso la base se prepara desde tu computadora, apuntando a TiDB:

```powershell
cd "C:\Proyectos programacion\Enfe-red\enfe-red\backend"
$env:DATABASE_URL = "mysql+pymysql://3abcXYZ.root:CLAVE@gateway01.us-east-1.prod.aws.tidbcloud.com:4000/enfe_red?ssl_ca=C:/certs/isrgrootx1.pem"
$env:JWT_SECRET_KEY = "CLAVE_JWT_DE_PRODUCCION"
$env:CLAVE_CIFRADO_DATOS = "CLAVE_FERNET_DE_PRODUCCION"
$env:FLASK_DEBUG = "0"
$env:FRONTEND_ORIGINS = "https://enfered.pages.dev"
$env:CARGAR_DEMO = "1"     # solo para la presentación: crea las cuentas demo (clave 123456)
.\venv\Scripts\flask.exe --app app preparar-bd
```

- Las variables que pongas con `$env:` le ganan a las de tu `backend/.env`. Definí **siempre**
  `DATABASE_URL` y `CLAVE_CIFRADO_DATOS`, para no tocar tu base local ni cifrar con otra clave.
- Para tener un administrador, registrate en la app ya publicada y después corré, en la misma ventana:
  `.\venv\Scripts\flask.exe --app app asignar-administrador tu_correo@ejemplo.com`.
- Al terminar cerrá la ventana de PowerShell, así esas variables no quedan cargadas.
- Para comprobarlo, en el SQL Editor de TiDB corré `USE enfe_red; SHOW TABLES;`.
- **Cada vez que se publique una versión nueva del backend con cambios en la base**, repetí este paso
  (se puede correr las veces que quieras).

## 5. Paso 3: publicar el backend en Render

1. Entrá a https://render.com con tu cuenta de GitHub.
2. **New → Web Service** y conectá el repo (dale permiso solo a ese repo).
3. Configuración:
   - **Name:** `enfered-api`.
   - **Region:** Virginia (US East).
   - **Branch:** la que vas a publicar.
   - **Root Directory:** `enfe-red/backend`.
   - **Language:** Docker. Usa `enfe-red/backend/Dockerfile`, que arranca `python serve.py`.
   - **Instance Type:** Free.
4. Variables de entorno:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | La versión para Render del paso 1 |
   | `JWT_SECRET_KEY` | La de producción |
   | `CLAVE_CIFRADO_DATOS` | La de producción (la misma del paso 2) |
   | `FRONTEND_ORIGINS` | `https://enfered.pages.dev` (sin `/` al final) |
   | `FLASK_DEBUG` | `0` |
   | `HTTPS` | `1` |
   | `PROXY_CONFIABLE` | `1` (Render pone un proxy delante de la app) |
   | `IA_PROVEEDOR` | `gemini` |
   | `GEMINI_API_KEY` | La clave de Gemini |
   | `SMTP_*`, `CORREO_REMITENTE` | Vacías por ahora |

   No cargues `PORT`, porque Render la define sola. Tampoco cargues `CARGAR_DEMO` ni `AUTO_MIGRAR`.
5. **Health Check Path:** `/api/health`. Responde `{"estado": "ok"}` si la base contesta y está preparada.
6. **Create Web Service** y mirá los logs hasta que diga *Live*. Si dice que falta correr `preparar-bd`,
   volvé al paso 2. Si el error es de SSL, revisá `?ssl_ca=` y el usuario con prefijo.

**Si no podés correr el paso 2 desde tu PC:** en Render, **Settings → Docker Command**, poné temporalmente
`sh -c "python -m flask --app app preparar-bd && python serve.py"` (y `CARGAR_DEMO=1` si querés la demo),
hacé un deploy, revisá los logs y después **borrá** ese comando y `CARGAR_DEMO`.

## 6. Paso 4: publicar el frontend en Cloudflare Pages

1. Entrá a https://dash.cloudflare.com y creá una cuenta gratis.
2. **Workers & Pages → Create → Pages → Connect to Git**, y elegí el repo y la rama.
3. Build:
   - **Project name:** `enfered`. La URL va a ser `https://enfered.pages.dev` y tiene que coincidir con `FRONTEND_ORIGINS`.
   - **Root directory:** `enfe-red/frontend`.
   - **Build command:** `npm run build`.
   - **Output directory:** `dist`.
4. Variables de producción:
   - `VITE_API_URL`: `https://enfered-api.onrender.com` (sin `/api` ni `/` final).
   - `VITE_SOPORTE_EMAIL`: el correo de soporte cuando lo tengan. Sin él, la política de privacidad no muestra una dirección.
   - `NODE_VERSION`: `22`, solo si el build se queja de la versión de Node.
5. **Save and Deploy.** Las variables `VITE_*` se graban al compilar: si las cambiás, hacé *Retry deployment*.
   Los enlaces directos (`/login`, `/cartilla`…) funcionan gracias a `public/_redirects`.
6. Si Cloudflare te da otra URL, actualizá `FRONTEND_ORIGINS` en Render.

## 7. Paso 5: probar

1. Abrí `https://enfered-api.onrender.com/api/health`. Si estaba dormido tarda cerca de un minuto.
2. Abrí `https://enfered.pages.dev` con F12 abierto:
   - **Error de CORS:** `FRONTEND_ORIGINS` no coincide exactamente con la URL.
   - **Pedidos a `localhost`:** `VITE_API_URL` no estaba cargada en el build.
3. Entrá con una cuenta demo (por ejemplo `laura.gomez@test.com`, clave `123456`) o registrate.
4. Probá la búsqueda con IA, el mapa, pedir un turno, aceptarlo como enfermero, WhatsApp, reseñas y el panel admin.

## 8. Riesgos del plan gratis y el día de la presentación

| Riesgo | Cómo cubrirte |
|---|---|
| El backend se duerme a los 15 minutos y tarda ~1 minuto en despertar. | 15 minutos antes, abrí la app y dejala abierta. O configurá un monitor gratis (UptimeRobot o cron-job.org) que llame a `https://enfered-api.onrender.com/` cada 10 minutos (esa ruta no consulta la base). Un solo servicio despierto todo el mes entra en las 750 horas. |
| Render reinicia cuando quiere y borra los archivos locales. | Todo está en TiDB; el backend no guarda archivos. |
| TiDB guarda backups de un solo día. | Antes de la presentación exportá la base (Export en la consola de TiDB, o `scripts/backup_mysql.py` con la `DATABASE_URL` de TiDB). |
| Se termina la cuota de Gemini. | La app usa las reglas sola. |
| Se cae internet o un proveedor. | Plan B: la app corriendo en tu PC (`python app.py` y `npm run dev`) y un video corto del recorrido. |
| Datos reales de salud. | Para la demo, solo datos ficticios. Un piloto con pacientes reales necesita planes pagos chicos, backups de verdad y revisar la Ley 25.326 (inscripción de la base en la AAIP). |
| Cuentas demo con clave `123456` en la versión publicada. | Sirven para la presentación. Después de la demo, borralas o cambiales la clave. |

## 9. Cuando configuren el correo

Render Free **bloquea los puertos 25, 465 y 587**. Usá un proveedor con otro puerto, por ejemplo Brevo:
`SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=2525`, `SMTP_TLS=1`, más `SMTP_USUARIO`, `SMTP_CLAVE` y
`CORREO_REMITENTE`. Sin correo, nadie puede recuperar su contraseña en la versión publicada.

## Fuentes

- Render Free (se duerme a los 15 min, 750 h, sin consola, SMTP bloqueado, Postgres de 30 días): https://render.com/docs/free
- Render, web services (Docker, `PORT`, 0.0.0.0): https://render.com/docs/web-services
- Comparativa de planes gratis (septiembre de 2026): https://flaviocopes.com/hosting-free-tiers/
- Koyeb, precios: https://www.koyeb.com/docs/faqs/pricing
- Railway, precios: https://docs.railway.com/reference/pricing
- Fly.io, precios 2026: https://temps.sh/blog/fly-io-pricing-2026
- PythonAnywhere, cuentas gratis: https://help.pythonanywhere.com/pages/FreeAccountsFeatures/ y https://blog.pythonanywhere.com/221/
- TiDB Cloud Starter, límites: https://docs.pingcap.com/tidbcloud/serverless-limitations/
- TiDB Cloud Starter, preguntas frecuentes: https://docs.pingcap.com/tidbcloud/serverless-faqs/
- TiDB, conexiones TLS: https://docs.pingcap.com/tidbcloud/secure-connections-to-serverless-clusters/
- TiDB con SQLAlchemy: https://docs.pingcap.com/developer/dev-guide-sample-application-python-sqlalchemy/
- SQLAlchemy, SSL con PyMySQL: https://docs.sqlalchemy.org/en/20/dialects/mysql.html
- Aiven MySQL gratis: https://aiven.io/docs/products/mysql/concepts/mysql-free-tier
- Cloudflare Pages: https://developers.cloudflare.com/pages/configuration/serving-pages/
- Netlify, créditos: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- Brevo, puertos SMTP: https://help.brevo.com/hc/en-us/articles/10905415650322
- Certificado raíz de Let's Encrypt: https://letsencrypt.org/certs/isrgrootx1.pem
