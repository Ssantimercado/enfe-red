import { useRef, useState } from 'react';
import { cancelarSolicitud, errorSolicitud } from '../services/solicitudes';
import './Solicitudes.css';
import { sesionActual } from '../api';

// Renzo puede incluir este componente en las tarjetas del paciente y actualizar
// su listado mediante onCancelada(idSolicitud). El servidor valida la propiedad.
export default function CancelarSolicitud({ solicitud, onCancelada }) {
  const dialog = useRef(null);
  const ocupado = useRef(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [cancelada, setCancelada] = useState(false);
  async function confirmar() {
    if (ocupado.current) return;
    ocupado.current = true;
    setEnviando(true);
    setError('');
    try {
      await cancelarSolicitud(solicitud.idSolicitud);
      dialog.current.close();
      setCancelada(true);
      onCancelada?.(solicitud.idSolicitud);
    } catch (err) { setError(errorSolicitud(err)); }
    finally { ocupado.current = false; setEnviando(false); }
  }
  if (cancelada) return <p role="status">Solicitud cancelada.</p>;
  if (sesionActual()?.rol !== 'paciente' || !solicitud.idSolicitud || !['Pendiente', 'Aceptada'].includes(solicitud.estado)) return null;
  return <div className="solicitud-cancelar">
    <button type="button" className="button button-secondary" onClick={(event) => { event.stopPropagation(); setError(''); dialog.current.showModal(); }}>Cancelar solicitud</button>
    <dialog className="content-panel" ref={dialog} aria-label="Confirmar cancelación de solicitud" onClick={event => event.stopPropagation()} onCancel={event => { if (ocupado.current) event.preventDefault(); }}>
      <h2>¿Cancelar esta solicitud?</h2>
      <p>Se cancelará el turno del {solicitud.fecha} a las {solicitud.hora}.</p>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button className="button button-secondary" type="button" autoFocus disabled={enviando} onClick={() => dialog.current.close()}>Conservar solicitud</button>
      <button type="button" className="button button-primary" disabled={enviando} onClick={confirmar}>{enviando ? 'Cancelando…' : 'Sí, cancelar'}</button>
    </dialog>
  </div>;
}
