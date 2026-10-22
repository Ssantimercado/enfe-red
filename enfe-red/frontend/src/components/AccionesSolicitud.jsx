import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api, enlaceWhatsapp, sesionActual } from '../api';
import { fechaLegible } from '../fechas';
import CalificarSolicitud from './CalificarSolicitud';
import ReprogramarSolicitud from './ReprogramarSolicitud';
import { EstrellasLectura } from './SelectorEstrellas';
import { ESTADOS_SIN_TURNO, textoEstado } from './estadoSolicitud';

// Partes de la solicitud que comparten la tarjeta de Mis solicitudes y el comprobante.
export function mensajeWhatsappPaciente(solicitud) {
  return `Hola, te escribo desde Enfered por el turno de ${solicitud.servicio?.tipoServicio || 'atención'} del ${fechaLegible(solicitud.fecha, solicitud.hora)}.`;
}

// El historial es lo único que dice si una atención Realizada ya tiene reseña.
export async function calificacionesDelHistorial(signal) {
  const historial = await api(`/usuarios/${sesionActual()?.sub}/historial`, { signal });
  if (!Array.isArray(historial)) return {};
  return Object.fromEntries(historial.map((item) => [item.idSolicitud, (item.calificaciones || [])[0] || null]));
}

export function AccionesPaciente({ solicitud, calificacion, onActualizada, onCalificada, comprobante = false }) {
  const [gracias, setGracias] = useState(false);
  const whatsapp = solicitud.estado === 'Aceptada'
    && enlaceWhatsapp(solicitud.contacto?.telefono, mensajeWhatsappPaciente(solicitud));
  return (
    <>
      {solicitud.estado === 'Realizada' && calificacion && (
        <p className="solicitud-calificacion">
          Tu calificación: <EstrellasLectura valor={calificacion.estrellas} />
        </p>
      )}
      {gracias && <p className="notice notice-success solicitud-aviso" role="status">¡Gracias! Tu calificación se guardó.</p>}
      <div className="solicitud-card-actions">
        {!comprobante && (
          <Link className="button button-primary" to={`/solicitudes/${solicitud.idSolicitud}`}>
            {solicitud.estado === 'Aceptada' ? 'Ver comprobante y mensajes' : 'Ver comprobante'}
          </Link>
        )}
        {whatsapp && (
          <a className="button button-secondary" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Escribir por WhatsApp
          </a>
        )}
        {solicitud.estado === 'Realizada' && !calificacion && (
          <CalificarSolicitud
            solicitud={solicitud}
            onCalificada={(nueva) => { setGracias(true); onCalificada?.(nueva); }}
          />
        )}
        {ESTADOS_SIN_TURNO.includes(solicitud.estado) && (
          <Link className="button button-secondary" to="/cartilla">Buscar otro profesional</Link>
        )}
      </div>
      <ReprogramarSolicitud solicitud={solicitud} onReprogramada={onActualizada} />
    </>
  );
}

export function DetalleEstado({ solicitud, enfermero = false, calificada = false }) {
  return (
    <>
      <p className="solicitud-estado-detalle">{textoEstado(solicitud, { enfermero, calificada })}</p>
      {solicitud.estado === 'Cancelada' && solicitud.motivoCancelacion && (
        <p className="solicitud-motivo"><strong>Motivo:</strong> {solicitud.motivoCancelacion}</p>
      )}
    </>
  );
}
