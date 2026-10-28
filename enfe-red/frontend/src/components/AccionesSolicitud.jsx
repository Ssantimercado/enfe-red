import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api, enlaceWhatsapp, sesionActual } from '../api';
import { fechaLegible } from '../fechas';
import CalificarSolicitud from './CalificarSolicitud';
import ReprogramarSolicitud from './ReprogramarSolicitud';
import { EstrellasLectura } from './SelectorEstrellas';
import { CHAT_ABIERTO, CHAT_VISIBLE } from './ChatServicio';
import { ESTADOS_SIN_TURNO, textoEstado } from './estadoSolicitud';

// Partes de la solicitud que comparten la tarjeta de Mis solicitudes y el comprobante.
export function mensajeWhatsappPaciente(solicitud) {
  return `Hola, te escribo desde Enfered por el turno de ${solicitud.servicio?.tipoServicio || 'atención'} del ${fechaLegible(solicitud.fecha, solicitud.hora)}.`;
}

export function mensajeWhatsappEnfermero(solicitud) {
  return `Hola, te escribo desde Enfered por tu solicitud de ${solicitud.servicio?.tipoServicio || 'atención'} del ${fechaLegible(solicitud.fecha, solicitud.hora)}.`;
}

// HU13: el teléfono del profesional llega recién cuando acepta; antes se habla por el chat.
export function whatsappParaPaciente(solicitud) {
  return (solicitud.estado === 'Aceptada'
    && enlaceWhatsapp(solicitud.contacto?.telefono, mensajeWhatsappPaciente(solicitud))) || null;
}
export const NOTA_WHATSAPP_PACIENTE = 'Cuando el profesional acepte el turno, también vas a poder seguir la charla por WhatsApp.';

// El historial es lo único que dice si una atención Realizada ya tiene reseña.
export async function calificacionesDelHistorial(signal) {
  const historial = await api(`/usuarios/${sesionActual()?.sub}/historial`, { signal });
  if (!Array.isArray(historial)) return {};
  return Object.fromEntries(historial.map((item) => [item.idSolicitud, (item.calificaciones || [])[0] || null]));
}

// onAlternarChat: en Mis solicitudes el chat se abre dentro de la tarjeta (en el comprobante ya está abierto).
export function AccionesPaciente({
  solicitud, calificacion, onActualizada, onCalificada, comprobante = false, chatAbierto = false, onAlternarChat,
}) {
  const [gracias, setGracias] = useState(false);
  const chatActivo = CHAT_ABIERTO.includes(solicitud.estado);
  return (
    <>
      {solicitud.estado === 'Realizada' && calificacion && (
        <p className="solicitud-calificacion">
          Tu calificación: <EstrellasLectura valor={calificacion.estrellas} />
        </p>
      )}
      {gracias && <p className="notice notice-success solicitud-aviso" role="status">¡Gracias! Tu calificación se guardó.</p>}
      <div className="solicitud-card-actions">
        {onAlternarChat && CHAT_VISIBLE.includes(solicitud.estado) && (
          <button
            className={`button ${chatActivo ? 'button-primary' : 'button-secondary'}`}
            type="button"
            aria-expanded={chatAbierto}
            aria-controls={`chat-${solicitud.idSolicitud}`}
            onClick={onAlternarChat}
          >
            {chatActivo
              ? (chatAbierto ? 'Ocultar chat' : 'Escribirle al profesional')
              : (chatAbierto ? 'Ocultar mensajes' : 'Ver mensajes')}
          </button>
        )}
        {!comprobante && (
          <Link className="button button-secondary" to={`/solicitudes/${solicitud.idSolicitud}`}>
            Ver comprobante
          </Link>
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
