import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';
import { fechaLegible } from '../fechas';
import { errorSolicitud, obtenerSolicitudesPaciente } from '../services/solicitudes';
import { AccionesPaciente, DetalleEstado, calificacionesDelHistorial } from './AccionesSolicitud';
import CancelarSolicitud from './CancelarSolicitud';
import useActualizacionPeriodica from './useActualizacionPeriodica';
import './Solicitudes.css';

// SCRUM-58.3: el paciente consulta el estado de todas sus solicitudes.
const EN_CURSO = ['Pendiente', 'Aceptada'];

function mensajeError(error) {
  if (!error.response && error.message && error.message !== 'Network Error') return error.message;
  return errorSolicitud(error);
}

function TarjetaSolicitud({ solicitud, calificacion, onActualizada, onCalificada }) {
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
      <DetalleEstado solicitud={solicitud} calificada={Boolean(calificacion)} />
      <dl className="solicitud-summary">
        <dt>Profesional</dt>
        <dd>{profesional || 'No informado'}</dd>
        <dt>Fecha y hora</dt>
        <dd>{fechaLegible(solicitud.fecha, solicitud.hora)}</dd>
        <dt>Dirección</dt>
        <dd>{solicitud.direccionAtencion}</dd>
      </dl>
      <AccionesPaciente
        solicitud={solicitud}
        calificacion={calificacion}
        onActualizada={onActualizada}
        onCalificada={onCalificada}
      />
      <CancelarSolicitud
        solicitud={solicitud}
        onCancelada={(idSolicitud, actualizada) => onActualizada(
          actualizada || { ...solicitud, estado: 'Cancelada', canceladaPor: 'paciente' },
        )}
      />
    </article>
  );
}

export default function EstadoSolicitudes() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [calificaciones, setCalificaciones] = useState({});
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const idPaciente = useRef(null);
  const consulta = useRef(null);
  // Cada cambio hecho en pantalla suma uno: una consulta que empezó antes no lo pisa.
  const version = useRef(0);

  async function traerCalificaciones(items, signal) {
    if (!items.some((item) => item.estado === 'Realizada')) return;
    try {
      const encontradas = await calificacionesDelHistorial(signal);
      if (!signal.aborted) setCalificaciones((actuales) => ({ ...actuales, ...encontradas }));
    } catch {
      // Sin historial se ofrece calificar igual: el backend no acepta una segunda reseña.
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api('/perfil/paciente', { signal: controller.signal })
      .then((perfil) => {
        if (!perfil.idPaciente) throw new Error('No se encontró tu perfil de paciente.');
        idPaciente.current = perfil.idPaciente;
        return obtenerSolicitudesPaciente(perfil.idPaciente, controller.signal);
      })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('La respuesta de solicitudes no es válida.');
        if (!controller.signal.aborted) {
          setSolicitudes(items);
          traerCalificaciones(items, controller.signal);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted && err.name !== 'CanceledError') setError(mensajeError(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [intento]);

  useEffect(() => {
    const pendiente = consulta;
    return () => pendiente.current?.abort();
  }, []);

  // Se reemplaza solo la lista: los diálogos abiertos siguen montados en su tarjeta.
  useActualizacionPeriodica(() => {
    if (!idPaciente.current) return;
    consulta.current?.abort();
    const controller = new AbortController();
    consulta.current = controller;
    const inicio = version.current;
    const realizadasConocidas = new Set(solicitudes
      .filter((item) => item.estado === 'Realizada').map((item) => item.idSolicitud));
    obtenerSolicitudesPaciente(idPaciente.current, controller.signal)
      .then((items) => {
        if (!Array.isArray(items) || controller.signal.aborted || version.current !== inicio) return;
        setSolicitudes(items);
        setError('');
        const nuevas = items.filter((item) => item.estado === 'Realizada' && !realizadasConocidas.has(item.idSolicitud));
        traerCalificaciones(nuevas, controller.signal);
      })
      .catch(() => {
        // Si falla en segundo plano se sigue mostrando la última lista.
      });
  }, !cargando && !error);

  function actualizar(actualizada) {
    version.current += 1;
    setSolicitudes((items) => items.map((item) => (
      item.idSolicitud === actualizada.idSolicitud ? actualizada : item
    )));
  }

  function calificada(calificacion) {
    version.current += 1;
    setCalificaciones((actuales) => ({ ...actuales, [calificacion.idSolicitud]: calificacion }));
  }

  const enCurso = solicitudes.filter((item) => EN_CURSO.includes(item.estado));
  // Las cerradas, de la más reciente a la más antigua.
  const anteriores = solicitudes.filter((item) => !EN_CURSO.includes(item.estado)).reverse();
  const tarjeta = (item) => (
    <TarjetaSolicitud
      key={item.idSolicitud}
      solicitud={item}
      calificacion={calificaciones[item.idSolicitud]}
      onActualizada={actualizar}
      onCalificada={calificada}
    />
  );

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
          <Link className="button button-primary" to="/cartilla">Buscar otro profesional</Link>
        </div>
      ) : (
        <>
          <section aria-labelledby="solicitudes-en-curso">
            <h2 id="solicitudes-en-curso" className="solicitudes-section-title">En curso ({enCurso.length})</h2>
            {enCurso.length ? (
              <div className="solicitudes-grid">{enCurso.map(tarjeta)}</div>
            ) : (
              <p className="solicitudes-section-empty">No tenés solicitudes pendientes ni aceptadas.</p>
            )}
          </section>
          {anteriores.length > 0 && (
            <section aria-labelledby="solicitudes-anteriores">
              <h2 id="solicitudes-anteriores" className="solicitudes-section-title">Anteriores ({anteriores.length})</h2>
              <div className="solicitudes-grid">{anteriores.map(tarjeta)}</div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
