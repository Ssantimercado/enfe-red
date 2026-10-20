import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';
import { errorSolicitud, obtenerSolicitudesPaciente } from '../services/solicitudes';
import CancelarSolicitud from './CancelarSolicitud';
import './Solicitudes.css';

// SCRUM-58.3: el paciente consulta el estado de todas sus solicitudes.
const EN_CURSO = ['Pendiente', 'Aceptada'];
const DESCRIPCION_ESTADO = {
  Pendiente: 'Esperando que el profesional la acepte.',
  Aceptada: 'El profesional confirmó el turno. Podés coordinar por mensajes.',
  Realizada: 'Atención finalizada. Podés calificarla desde tu historial.',
  Rechazada: 'El profesional no pudo tomar este turno.',
  Cancelada: 'Cancelaste esta solicitud.',
};

function mensajeError(error) {
  if (!error.response && error.message && error.message !== 'Network Error') return error.message;
  return errorSolicitud(error);
}

function fechaLegible(fecha) {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-AR', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function TarjetaSolicitud({ solicitud, onCancelada }) {
  const profesional = [solicitud.enfermero?.nombre, solicitud.enfermero?.apellido].filter(Boolean).join(' ');
  return (
    <article className="content-panel solicitud-card">
      <div className="solicitud-card-heading">
        <div>
          <span className="eyebrow">SOLICITUD #{solicitud.idSolicitud}</span>
          <h3>{solicitud.servicio?.tipoServicio || 'Servicio solicitado'}</h3>
        </div>
        <span className={`solicitud-status ${solicitud.estado.toLowerCase()}`}>{solicitud.estado}</span>
      </div>
      <p className="solicitud-estado-detalle">{DESCRIPCION_ESTADO[solicitud.estado]}</p>
      <dl className="solicitud-summary">
        <dt>Profesional</dt>
        <dd>{profesional || 'No informado'}</dd>
        <dt>Fecha y hora</dt>
        <dd>{fechaLegible(solicitud.fecha)} · {solicitud.hora}</dd>
        <dt>Dirección</dt>
        <dd>{solicitud.direccionAtencion}</dd>
      </dl>
      <div className="solicitud-card-actions">
        <Link className="button button-primary" to={`/solicitudes/${solicitud.idSolicitud}`}>
          {solicitud.estado === 'Aceptada' ? 'Ver comprobante y mensajes' : 'Ver comprobante'}
        </Link>
      </div>
      <CancelarSolicitud solicitud={solicitud} onCancelada={onCancelada} />
    </article>
  );
}

export default function EstadoSolicitudes() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api('/perfil/paciente', { signal: controller.signal })
      .then((perfil) => {
        if (!perfil.idPaciente) throw new Error('No se encontró tu perfil de paciente.');
        return obtenerSolicitudesPaciente(perfil.idPaciente, controller.signal);
      })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('La respuesta de solicitudes no es válida.');
        if (!controller.signal.aborted) setSolicitudes(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'CanceledError') setError(mensajeError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [intento]);

  function marcarCancelada(idSolicitud) {
    setSolicitudes((items) => items.map((item) => (
      item.idSolicitud === idSolicitud ? { ...item, estado: 'Cancelada' } : item
    )));
  }

  const enCurso = solicitudes.filter((item) => EN_CURSO.includes(item.estado));
  // Las cerradas, de la más reciente a la más antigua.
  const anteriores = solicitudes.filter((item) => !EN_CURSO.includes(item.estado)).reverse();

  return (
    <div className="page-container solicitudes-inbox">
      <header className="page-heading">
        <div>
          <span className="eyebrow">TUS ATENCIONES</span>
          <h1>Mis solicitudes</h1>
          <p>Seguí el estado de cada pedido, entrá al comprobante y coordiná con el profesional.</p>
        </div>
        <Link className="button button-secondary" to="/cartilla">Buscar profesionales</Link>
      </header>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}{' '}
          <button className="text-link" type="button" onClick={() => setIntento((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}
      {cargando ? (
        <p role="status">Cargando tus solicitudes…</p>
      ) : !error && !solicitudes.length ? (
        <div className="content-panel empty-state">
          <h2>Todavía no hiciste solicitudes</h2>
          <p>Buscá un profesional en la cartilla y pedí tu primer turno.</p>
        </div>
      ) : (
        <>
          <section aria-labelledby="solicitudes-en-curso">
            <h2 id="solicitudes-en-curso" className="solicitudes-section-title">En curso ({enCurso.length})</h2>
            {enCurso.length ? (
              <div className="solicitudes-grid">
                {enCurso.map((item) => (
                  <TarjetaSolicitud key={item.idSolicitud} solicitud={item} onCancelada={marcarCancelada} />
                ))}
              </div>
            ) : (
              <p className="solicitudes-section-empty">No tenés solicitudes pendientes ni aceptadas.</p>
            )}
          </section>
          {anteriores.length > 0 && (
            <section aria-labelledby="solicitudes-anteriores">
              <h2 id="solicitudes-anteriores" className="solicitudes-section-title">Anteriores ({anteriores.length})</h2>
              <div className="solicitudes-grid">
                {anteriores.map((item) => (
                  <TarjetaSolicitud key={item.idSolicitud} solicitud={item} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
