"""Reglas de agenda compartidas: duración, horarios de atención, vencimiento, suspensión y avisos por correo."""
import unicodedata
from calendar import monthrange
from datetime import datetime, time, timedelta, timezone

from flask import current_app
from sqlalchemy import and_, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm.attributes import set_committed_value

from database import db
from models.notificacion_models import notificar
from models.servicio_models import DURACION_POR_DEFECTO
from models.solicitud_models import ESTADOS_ACTIVOS, SIN_UBICACION, SolicitudServicio
from services.correo import enviar_aviso

ZONA_HORARIA_ARGENTINA = timezone(timedelta(hours=-3))
DIAS_SEMANA = ('Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo')
DIAS_PLURAL = ('lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados', 'domingos')
MESES_MAXIMOS = 6
MAX_PENDIENTES_POR_PACIENTE = 5
MOTIVO_ENFERMERO_SUSPENDIDO = 'El profesional no está disponible'
MOTIVO_PACIENTE_SUSPENDIDO = 'El paciente no está disponible'
MINUTOS_DIA = 24 * 60
FIN_DEL_DIA = time(23, 59)


def ahora_local():
    # fecha y hora de los turnos se guardan como valores locales, sin zona horaria.
    return datetime.now(ZONA_HORARIA_ARGENTINA).replace(tzinfo=None)


def nombre_completo(perfil, alternativo):
    return ' '.join(filter(None, [perfil.nombre, perfil.apellido])) or alternativo


def duracion_minutos(servicio):
    return (servicio.duracionMinutos if servicio else None) or DURACION_POR_DEFECTO


def texto_duracion(minutos):
    horas, resto = divmod(minutos, 60)
    partes = []
    if horas:
        partes.append('1 hora' if horas == 1 else f'{horas} horas')
    if resto:
        partes.append(f'{resto} minutos')
    return ' y '.join(partes)


def inicio_y_fin(fecha, hora, servicio):
    inicio = datetime.combine(fecha, hora)
    return inicio, inicio + timedelta(minutes=duracion_minutos(servicio))


def fecha_maxima(hoy):
    """Mismo día, seis meses después (o el último día de ese mes si no existe)."""
    mes = hoy.month - 1 + MESES_MAXIMOS
    anio, mes = hoy.year + mes // 12, mes % 12 + 1
    return hoy.replace(year=anio, month=mes, day=min(hoy.day, monthrange(anio, mes)[1]))


def _sin_tildes(texto):
    texto = unicodedata.normalize('NFKD', str(texto or '').strip().lower())
    return ''.join(letra for letra in texto if not unicodedata.combining(letra))


def _minutos(hora):
    return hora.hour * 60 + hora.minute


def franjas_del_dia(horarios, indice):
    """Franjas Disponibles de ese día como (inicio, fin) en minutos, unidas si se tocan o se pisan.

    08:00-12:00 y 12:00-16:00 son una sola franja: un turno de 11:30 a 12:30 entra. Una franja que
    termina a las 23:59 llega hasta la medianoche (el campo de hora no permite escribir 24:00).
    """
    dia = _sin_tildes(DIAS_SEMANA[indice])
    rangos = sorted(
        (_minutos(h.hora_inicio), MINUTOS_DIA if h.hora_fin == FIN_DEL_DIA else _minutos(h.hora_fin))
        for h in horarios
        if _sin_tildes(h.dia_semana) == dia and (h.estado or 'Disponible') == 'Disponible'
    )
    unidas = []
    for desde, hasta in rangos:
        if unidas and desde <= unidas[-1][1]:
            unidas[-1] = (unidas[-1][0], max(unidas[-1][1], hasta))
        else:
            unidas.append((desde, hasta))
    return unidas


def _texto_minutos(minutos):
    return '24:00' if minutos >= MINUTOS_DIA else f'{minutos // 60:02d}:{minutos % 60:02d}'


def problema_de_horario(enfermero, inicio, fin):
    """Texto para el paciente si el turno cae fuera de las franjas cargadas; None si está bien.

    Sin franjas Disponibles en toda la semana (no cargó horarios o los tiene todos en pausa) se
    reciben pedidos en cualquier horario: el perfil le dice al paciente que elija la hora, y el
    profesional igual confirma o rechaza cada pedido.
    """
    horarios = [h for h in enfermero.disponibilidades if (h.estado or 'Disponible') == 'Disponible']
    if not horarios:
        return None
    indice = inicio.weekday()
    franjas = franjas_del_dia(horarios, indice)
    desde = _minutos(inicio.time())
    # Minutos desde la medianoche del día del turno: si termina al día siguiente pasa de 1440.
    hasta = int((fin - datetime.combine(inicio.date(), datetime.min.time())).total_seconds() // 60)
    if any(f_desde <= desde and hasta <= f_hasta for f_desde, f_hasta in franjas):
        return None
    nombre = nombre_completo(enfermero, 'El profesional')
    if not franjas:
        return (f'{nombre} no atiende los {DIAS_PLURAL[indice]}. '
                'Mirá sus días y horarios en el perfil y elegí otro día.')
    rangos = ' y '.join(f'de {_texto_minutos(a)} a {_texto_minutos(b)}' for a, b in franjas)
    minutos = int((fin - inicio).total_seconds() // 60)
    return (f'Ese horario está fuera de la agenda de {nombre}. Los {DIAS_PLURAL[indice]} atiende {rangos}. '
            f'El turno dura {texto_duracion(minutos)} y tiene que terminar dentro de ese horario.')


DIAS_SEMANA = ('lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo')
MESES = ('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
         'noviembre', 'diciembre')


def fecha_legible(fecha, con_anio=False):
    """'lunes 2 de noviembre', igual que la app (sin depender del idioma del servidor)."""
    texto = f'{DIAS_SEMANA[fecha.weekday()]} {fecha.day} de {MESES[fecha.month - 1]}'
    return f'{texto} de {fecha.year}' if con_anio else texto


def _texto_turno(solicitud):
    servicio = solicitud.servicio.tipoServicio if solicitud.servicio else 'servicio'
    return f'{servicio} del {fecha_legible(solicitud.fecha)} a las {solicitud.hora:%H:%M}'


def fecha_para_correo(solicitud):
    # Los correos no llevan el tipo de servicio ni otros datos de salud: solo el día y la hora.
    return f'el {fecha_legible(solicitud.fecha, con_anio=True)} a las {solicitud.hora:%H:%M}'


def vencer_cargadas(solicitudes, ahora):
    """Pasa a Vencida las Pendientes cuyo turno ya llegó y avisa a cada paciente. Devuelve cuántas."""
    candidatas = [
        s for s in solicitudes
        if s.estado == 'Pendiente' and datetime.combine(s.fecha, s.hora) <= ahora
    ]
    if not candidatas:
        return 0
    vencidas = 0
    try:
        for solicitud in candidatas:
            # Condicional: si otra petición ya la venció (o la aceptó), no se avisa dos veces.
            actualizadas = SolicitudServicio.query.filter_by(
                idSolicitud=solicitud.idSolicitud, estado='Pendiente',
            ).update({'estado': 'Vencida', **SIN_UBICACION}, synchronize_session=False)
            if actualizadas != 1:
                continue
            set_committed_value(solicitud, 'estado', 'Vencida')
            vencidas += 1
            notificar(
                solicitud.paciente.usuario_id, 'vencida',
                f'Tu solicitud de {_texto_turno(solicitud)} venció porque '
                f'{nombre_completo(solicitud.enfermero, "el profesional")} no llegó a responderla a tiempo. '
                'Podés pedir otro turno.',
                solicitud.idSolicitud,
            )
        if vencidas:
            db.session.commit()
    except SQLAlchemyError:
        db.session.rollback()
        current_app.logger.exception('No se pudieron vencer las solicitudes pendientes')
        return 0
    return vencidas


def vencer_solicitudes(ahora, *filtros):
    """Busca en la base las Pendientes vencidas (opcionalmente filtradas) y las vence."""
    consulta = SolicitudServicio.query.filter(
        SolicitudServicio.estado == 'Pendiente',
        or_(
            SolicitudServicio.fecha < ahora.date(),
            and_(SolicitudServicio.fecha == ahora.date(), SolicitudServicio.hora <= ahora.time()),
        ),
        *filtros,
    )
    return vencer_cargadas(consulta.all(), ahora)


def cancelar_por_suspension(usuario, ahora):
    """Cancela los turnos Pendientes y los Aceptados futuros de una cuenta suspendida.

    Agrega las notificaciones a la transacción en curso (quien llama hace el commit)
    y devuelve los correos para mandar después del commit.
    """
    paciente, enfermero = usuario.perfil_paciente, usuario.perfil_enfermero
    if paciente:
        filtro, motivo = SolicitudServicio.idPaciente == paciente.id, MOTIVO_PACIENTE_SUSPENDIDO
    elif enfermero:
        filtro, motivo = SolicitudServicio.idEnfermero == enfermero.id, MOTIVO_ENFERMERO_SUSPENDIDO
    else:
        return []
    correos = []
    activas = SolicitudServicio.query.filter(filtro, SolicitudServicio.estado.in_(ESTADOS_ACTIVOS)).all()
    for solicitud in activas:
        if solicitud.estado == 'Aceptada' and datetime.combine(solicitud.fecha, solicitud.hora) <= ahora:
            # El turno aceptado que ya pasó queda para cerrarlo como realizado.
            continue
        solicitud.estado = 'Cancelada'
        solicitud.canceladaPor = 'administrador'
        solicitud.motivoCancelacion = motivo
        solicitud.olvidar_ubicacion()
        if paciente:
            destino = solicitud.enfermero.usuario
            texto = (f'Se canceló el turno de {_texto_turno(solicitud)} con '
                     f'{nombre_completo(paciente, "tu paciente")} porque el paciente no está disponible.')
        else:
            destino = solicitud.paciente.usuario
            texto = (f'Se canceló tu turno de {_texto_turno(solicitud)} porque el profesional no está '
                     'disponible. Podés buscar otro profesional en la cartilla.')
        notificar(destino.id, 'cancelada', texto, solicitud.idSolicitud)
        correos.append((destino, 'Se canceló un turno en Enfered',
                        f'Se canceló el turno de {fecha_para_correo(solicitud)}. Motivo: {motivo}.'))
    return correos


def avisar_por_correo(usuario, asunto, texto):
    """Best effort y en segundo plano: un correo que no sale nunca revierte el cambio ya guardado."""
    if usuario is None or usuario.eliminado:
        return
    try:
        enviar_aviso(usuario, asunto, texto)
    except Exception:
        current_app.logger.exception('No se pudo programar un correo de aviso')


def enviar_correos(correos):
    for usuario, asunto, texto in correos:
        avisar_por_correo(usuario, asunto, texto)
