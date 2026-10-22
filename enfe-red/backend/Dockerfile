# Imagen de producción del backend de Enfered.
#   docker build -t enfered-backend .
#   docker run --rm --env-file .env enfered-backend python -m flask --app app preparar-bd
#   docker run --env-file .env -p 5000:5000 enfered-backend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=5000

WORKDIR /app

# Primero las dependencias: si solo cambia el código, Docker reutiliza esta capa.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Sin permisos de administrador dentro del contenedor.
RUN useradd --create-home --uid 10001 enfered
USER enfered

EXPOSE 5000

# Usa el mismo GET /api/health que el monitor del hosting (python ya está; curl no viene en slim).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '5000'), timeout=4)"

CMD ["python", "serve.py"]
