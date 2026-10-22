"""Copia de seguridad de la base MySQL de Enfered: mysqldump + gzip, sin dependencias nuevas.

Uso, desde la carpeta backend:

    python scripts/backup_mysql.py

Programarlo una vez por día (cron en Linux o el Programador de tareas en Windows). Lee de backend/.env:
- DATABASE_URL (obligatoria): la misma que usa la app.
- BACKUP_DIR: carpeta de las copias (por defecto backend/backups; relativa a backend/).
- BACKUP_CONSERVAR: cuántas copias guardar (por defecto 14); las más viejas se borran.
- MYSQLDUMP: ruta a mysqldump si no está en el PATH (en Windows suele estar en la carpeta bin de MySQL).

La contraseña nunca va en la línea de comandos (otros usuarios del servidor la verían con ps):
se pasa en un archivo de opciones temporal que solo puede leer este usuario y se borra al terminar.
"""
import gzip
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

DIR_BACKEND = Path(__file__).resolve().parent.parent
PREFIJO = 'enfered-'
SUFIJO = '.sql.gz'
CONSERVAR_POR_DEFECTO = 14


class ErrorBackup(RuntimeError):
    """Error con un mensaje claro para mostrar en la consola."""


def datos_conexion(url_texto):
    from sqlalchemy.engine import make_url

    if not url_texto:
        raise ErrorBackup('Falta DATABASE_URL en backend/.env (ver .env.example).')
    try:
        url = make_url(url_texto)
    except Exception as error:
        raise ErrorBackup('DATABASE_URL no tiene un formato válido (ver .env.example).') from error
    if not url.drivername.startswith('mysql'):
        raise ErrorBackup('Este backup es para MySQL: DATABASE_URL tiene que empezar con mysql+pymysql://')
    if not url.database:
        raise ErrorBackup('DATABASE_URL no dice el nombre de la base (por ejemplo .../enfe_red).')
    return {
        'host': url.host or 'localhost',
        'port': url.port or 3306,
        'user': url.username or '',
        'password': url.password or '',
        'database': url.database,
        'socket': url.query.get('unix_socket'),
    }


def _valor_opcion(valor):
    # En los archivos de opciones de MySQL, entre comillas, la barra invertida y la comilla se escapan.
    return '"' + str(valor).replace('\\', '\\\\').replace('"', '\\"') + '"'


def escribir_archivo_opciones(conexion):
    """Archivo [client] temporal con usuario y clave. mkstemp lo crea legible solo por este usuario."""
    descriptor, ruta = tempfile.mkstemp(prefix='enfered-mysql-', suffix='.cnf')
    lineas = ['[client]', f'host={_valor_opcion(conexion["host"])}', f'port={int(conexion["port"])}']
    if conexion['user']:
        lineas.append(f'user={_valor_opcion(conexion["user"])}')
    if conexion['password']:
        lineas.append(f'password={_valor_opcion(conexion["password"])}')
    if conexion.get('socket'):
        lineas.append(f'socket={_valor_opcion(conexion["socket"])}')
    with os.fdopen(descriptor, 'w', encoding='utf-8') as archivo:
        archivo.write('\n'.join(lineas) + '\n')
    return ruta


def comando_mysqldump(ruta_opciones, base):
    ejecutable = os.getenv('MYSQLDUMP', '').strip() or 'mysqldump'
    return [
        ejecutable,
        # Tiene que ser la primera opción para que mysqldump la lea.
        f'--defaults-extra-file={ruta_opciones}',
        # Copia consistente sin bloquear la app mientras se usa (tablas InnoDB).
        '--single-transaction', '--quick',
        '--routines', '--triggers',
        # Evita pedir el permiso PROCESS, que los hostings no suelen dar.
        '--no-tablespaces',
        '--default-character-set=utf8mb4',
        base,
    ]


def borrar_copias_viejas(carpeta, base, conservar):
    """Deja solo las `conservar` copias más nuevas de esa base. Devuelve las que borró."""
    # La fecha del nombre (AAAAMMDD-HHMMSS) ordena de la más vieja a la más nueva.
    copias = sorted(p for p in Path(carpeta).glob(f'{PREFIJO}{base}-*{SUFIJO}') if p.is_file())
    viejas = copias[:-conservar] if conservar > 0 else copias
    for copia in viejas:
        copia.unlink()
    return viejas


def hacer_backup(conexion, carpeta, conservar, ahora=None):
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True, mode=0o700)
    ahora = ahora or datetime.now()
    destino = carpeta / f'{PREFIJO}{conexion["database"]}-{ahora:%Y%m%d-%H%M%S}{SUFIJO}'
    # Se escribe con otro nombre y se renombra al final: una copia cortada nunca cuenta como buena.
    parcial = destino.with_name(destino.name + '.parcial')
    ruta_opciones = escribir_archivo_opciones(conexion)
    try:
        with tempfile.TemporaryFile() as errores, gzip.open(parcial, 'wb') as salida:
            try:
                proceso = subprocess.Popen(comando_mysqldump(ruta_opciones, conexion['database']),
                                           stdout=subprocess.PIPE, stderr=errores)
            except FileNotFoundError as error:
                raise ErrorBackup('No se encontró mysqldump. Instalá el cliente de MySQL o poné su ruta '
                                  'en MYSQLDUMP (ver .env.example).') from error
            with proceso.stdout:
                shutil.copyfileobj(proceso.stdout, salida)
            codigo = proceso.wait()
            errores.seek(0)
            detalle = errores.read().decode('utf-8', 'replace').strip()
        if codigo != 0:
            raise ErrorBackup(f'mysqldump terminó con error (código {codigo}). {detalle}'.strip())
        os.replace(parcial, destino)
        if os.name != 'nt':
            os.chmod(destino, 0o600)  # La copia tiene datos personales: solo la lee este usuario.
    finally:
        Path(ruta_opciones).unlink(missing_ok=True)
        parcial.unlink(missing_ok=True)
    return destino, borrar_copias_viejas(carpeta, conexion['database'], conservar)


def _conservar():
    valor = os.getenv('BACKUP_CONSERVAR', '').strip()
    if not valor:
        return CONSERVAR_POR_DEFECTO
    if not valor.isdigit() or int(valor) <= 0:
        raise ErrorBackup('BACKUP_CONSERVAR tiene que ser un número entero mayor que 0 (ver .env.example).')
    return int(valor)


def _carpeta():
    carpeta = Path(os.getenv('BACKUP_DIR', '').strip() or 'backups')
    return carpeta if carpeta.is_absolute() else DIR_BACKEND / carpeta


def main():
    from dotenv import load_dotenv

    load_dotenv(DIR_BACKEND / '.env')
    try:
        conexion = datos_conexion(os.getenv('DATABASE_URL', '').strip())
        destino, borradas = hacer_backup(conexion, _carpeta(), _conservar())
    except ErrorBackup as error:
        print(f'No se pudo hacer el backup: {error}', file=sys.stderr)
        return 1
    print(f'Backup listo: {destino} ({destino.stat().st_size} bytes).')
    if borradas:
        print(f'Copias viejas borradas: {len(borradas)}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
