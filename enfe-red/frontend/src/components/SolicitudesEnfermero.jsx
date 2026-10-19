import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';
import {
  aceptarSolicitud,
  errorSolicitud,
  obtenerSolicitudesEnfermero,
  rechazarSolicitud,
} from '../services/solicitudes';
import ChatServicio from './ChatServicio';
import './Solicitudes.css';

// El chat se habilita al aceptar; después de cerrar queda como registro de lectura.
const CHAT_VISIBLE = ['Aceptada', 'Realizada', 'Cancelada'];

function mensajeError(error) {
  if (!error.response && error.message && error.message !== 'Network Error') {
    return error.message;
  }
  return errorSolicitud(error);
}

export default function SolicitudesEnfermero() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [seleccionada, setSeleccionada] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [intento, setIntento] = useState(0);
  const [chatAbierto, setChatAbierto] = useState(null);
  const dialog = useRef(null);
  const ocupado = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api('/perfil/enfermero', { signal: controller.signal })
      .then((perfil) => {
        if (!perfil.idEnfermero) throw new Error('No se encontró el perfil profesional.');
        return obtenerSolicitudesEnfermero(perfil.idEnfermero, controller.signal);
      })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('La respuesta de solicitudes no es válida.');
        if (!controller.signal.aborted) setSolicitudes(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(mensajeError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [intento]);

  async function cambiarEstado(solicitud, accion) {
    if (ocupado.current) return;
    ocupado.current = true;
    setGuardando(true);
    setError('');
    setMensaje('');
    try {
      const resultado = accion === 'aceptar'
        ? await aceptarSolicitud(solicitud.idSolicitud)
        : await rechazarSolicitud(solicitud.idSolicitud);
      const actualizada = resultado.solicitud;
      if (!actualizada?.idSolicitud) throw new Error('El servidor no devolvió la solicitud actualizada.');
      setSolicitudes((items) => items.map((item) =>
        item.idSolicitud === actualizada.idSolicitud ? actualizada : item,
      ));
      setMensaje(resultado.mensaje || `Solicitud ${accion === 'aceptar' ? 'aceptada' : 'rechazada'}.`);
      setSeleccionada(null);
      dialog.current?.close();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      ocupado.current = false;
      setGuardando(false);
    }
  }

  return (
    <div className="page-container solicitudes-inbox">
      <header className="page-heading">
        <div>
          <span className="eyebrow">GESTIÓN PROFESIONAL</span>
          <h1>Solicitudes recibidas</h1>
          <p>Revisá los pedidos de atención y aceptá o rechazá los pendientes.</p>
        </div>
        <Link className="button button-secondary" to="/perfil-enfermero">
          Volver a mi perfil
        </Link>
      </header>
      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          {!solicitudes.length && (
            <button className="text-link" onClick={() => setIntento((value) => value + 1)}>
              Reintentar
            </button>
          )}
        </div>
      )}
      {cargando ? (
        <p role="status">Cargando solicitudes…</p>
      ) : solicitudes.length ? (
        <div className="solicitudes-grid">
          {solicitudes.map((solicitud) => (
            <article className="content-panel solicitud-card" key={solicitud.idSolicitud}>
              <div className="solicitud-card-heading">
                <div>
                  <span className="eyebrow">SOLICITUD #{solicitud.idSolicitud}</span>
                  <h2>{solicitud.servicio?.tipoServicio || 'Servicio solicitado'}</h2>
                </div>
                <span className={`solicitud-status ${solicitud.estado.toLowerCase()}`}>
                  {solicitud.estado}
                </span>
              </div>
              <dl className="solicitud-summary">
                <dt>Paciente</dt>
                <dd>{solicitud.paciente?.nombre} {solicitud.paciente?.apellido}</dd>
                <dt>Teléfono</dt>
                <dd>{solicitud.paciente?.telefono || 'No informado'}</dd>
                <dt>Fecha y hora</dt>
                <dd>{solicitud.fecha} · {solicitud.hora}</dd>
                <dt>Dirección</dt>
                <dd>{solicitud.direccionAtencion}</dd>
              </dl>
              {CHAT_VISIBLE.includes(solicitud.estado) && (
                <div className="solicitud-card-actions">
                  <button
                    className="button button-secondary"
                    type="button"
                    aria-expanded={chatAbierto === solicitud.idSolicitud}
                    onClick={() => setChatAbierto((actual) => (
                      actual === solicitud.idSolicitud ? null : solicitud.idSolicitud
                    ))}
                  >
                    {chatAbierto === solicitud.idSolicitud ? 'Ocultar mensajes' : 'Ver mensajes'}
                  </button>
                </div>
              )}
              {chatAbierto === solicitud.idSolicitud && CHAT_VISIBLE.includes(solicitud.estado) && (
                <ChatServicio
                  key={`${solicitud.idSolicitud}-${solicitud.estado}`}
                  solicitud={solicitud}
                  contraparte={[solicitud.paciente?.nombre, solicitud.paciente?.apellido].filter(Boolean).join(' ')}
                />
              )}
              {solicitud.estado === 'Pendiente' && (
                <div className="solicitud-card-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={guardando}
                    onClick={() => cambiarEstado(solicitud, 'aceptar')}
                  >
                    {guardando ? 'Actualizando…' : 'Aceptar solicitud'}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={guardando}
                    onClick={() => {
                      setError('');
                      setSeleccionada(solicitud);
                      dialog.current.showModal();
                    }}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="content-panel empty-state">
          <h2>Todavía no recibiste solicitudes</h2>
          <p>Cuando un paciente te envíe un pedido, va a aparecer acá.</p>
        </div>
      )}
      <dialog
        className="content-panel solicitud-reject-dialog"
        ref={dialog}
        aria-label="Confirmar rechazo de solicitud"
        onCancel={(event) => {
          if (ocupado.current) event.preventDefault();
          else setSeleccionada(null);
        }}
      >
        <h2>¿Rechazar esta solicitud?</h2>
        <p>
          El pedido de {seleccionada?.paciente?.nombre || 'este paciente'} quedará como rechazado.
        </p>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="solicitud-card-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={guardando}
            onClick={() => {
              dialog.current.close();
              setSeleccionada(null);
            }}
          >
            Volver
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={guardando || !seleccionada}
            onClick={() => cambiarEstado(seleccionada, 'rechazar')}
          >
            {guardando ? 'Rechazando…' : 'Sí, rechazar'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
