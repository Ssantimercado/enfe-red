import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';

const METRICAS = [
  ['total_usuarios', 'Usuarios registrados'],
  ['pacientes', 'Pacientes'],
  ['enfermeros', 'Enfermeros'],
  ['usuarios_suspendidos', 'Cuentas suspendidas'],
  ['matriculas_pendientes', 'Matrículas pendientes'],
  ['total_solicitudes', 'Solicitudes'],
];

export default function PanelAdmin() {
  const [metricas, setMetricas] = useState(null);
  const [pendientes, setPendientes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [cargandoMatriculas, setCargandoMatriculas] = useState(true);
  const [error, setError] = useState('');
  const [errorMatriculas, setErrorMatriculas] = useState('');
  const [mensajeMatriculas, setMensajeMatriculas] = useState('');
  const [actualizando, setActualizando] = useState(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    setMetricas(null);
    api('/admin/metricas', { signal: controller.signal })
      .then((data) => {
        const validas = METRICAS.every(([key]) =>
          Number.isInteger(data[key]) && data[key] >= 0,
        );
        if (!validas) throw new Error('La respuesta de métricas no tiene el formato esperado.');
        if (!controller.signal.aborted) setMetricas(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [intento]);

  useEffect(() => {
    const controller = new AbortController();
    setCargandoMatriculas(true);
    setErrorMatriculas('');
    api('/admin/enfermeros/pendientes', { signal: controller.signal })
      .then((data) => {
        if (!Array.isArray(data.enfermeros)) {
          throw new Error('La respuesta de matrículas pendientes no tiene el formato esperado.');
        }
        if (!controller.signal.aborted) setPendientes(data.enfermeros);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setErrorMatriculas(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargandoMatriculas(false);
      });
    return () => controller.abort();
  }, [intento]);

  async function actualizarMatricula(enfermero, verificado) {
    setActualizando(enfermero.idEnfermero);
    setErrorMatriculas('');
    setMensajeMatriculas('');
    try {
      await api(`/admin/enfermeros/${enfermero.idEnfermero}/matricula`, {
        method: 'PUT',
        body: { verificado },
      });
      setPendientes((items) => items.filter((item) => item.idEnfermero !== enfermero.idEnfermero));
      setMensajeMatriculas(verificado
        ? `Matrícula de ${[enfermero.nombre, enfermero.apellido].filter(Boolean).join(' ')} aprobada. Ya puede aparecer en la búsqueda.`
        : `Matrícula de ${[enfermero.nombre, enfermero.apellido].filter(Boolean).join(' ')} rechazada.`);
      setIntento((value) => value + 1);
    } catch (err) {
      setErrorMatriculas(err.message);
    } finally {
      setActualizando(null);
    }
  }

  return (
    <div className="page-container admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Panel de administración</h1>
          <p>Un resumen de las cuentas y la actividad de Enfe-red.</p>
        </div>
        <Link className="button button-primary" to="/admin/usuarios">
          Gestionar usuarios
        </Link>
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
        <p role="status">Cargando métricas…</p>
      ) : metricas ? (
        <section className="admin-metrics-grid" aria-label="Métricas de la plataforma">
          {METRICAS.map(([key, label]) => (
            <article className="content-panel admin-metric-card" key={key}>
              <span>{label}</span>
              <strong>{metricas[key].toLocaleString('es-AR')}</strong>
            </article>
          ))}
        </section>
      ) : null}

      <section className="admin-verification-section" aria-labelledby="admin-verification-title">
        <div className="admin-verification-heading">
          <div>
            <span className="eyebrow">REVISIÓN DE MATRÍCULAS</span>
            <h2 id="admin-verification-title">Enfermeros pendientes de validación</h2>
            <p>Al aprobar una matrícula, el perfil queda habilitado para aparecer en la búsqueda y el mapa.</p>
          </div>
          <span className="admin-pending-count">{pendientes.length} pendiente{pendientes.length === 1 ? '' : 's'}</span>
        </div>
        {mensajeMatriculas && <p className="notice notice-success" role="status">{mensajeMatriculas}</p>}
        {errorMatriculas && (
          <div className="notice notice-error" role="alert">
            {errorMatriculas}{' '}
            <button className="text-link" type="button" onClick={() => setIntento((value) => value + 1)}>
              Reintentar
            </button>
          </div>
        )}
        {cargandoMatriculas ? (
          <p role="status">Cargando matrículas pendientes…</p>
        ) : errorMatriculas ? null : pendientes.length === 0 ? (
          <div className="content-panel empty-state"><p>No hay matrículas pendientes de revisión.</p></div>
        ) : (
          <div className="admin-pending-list" aria-busy={actualizando !== null}>
            {pendientes.map((enfermero) => (
              <article className="content-panel admin-pending-card" key={enfermero.idEnfermero}>
                <div>
                  <h3>{[enfermero.nombre, enfermero.apellido].filter(Boolean).join(' ') || 'Enfermero sin nombre'}</h3>
                  <p>{enfermero.email}</p>
                  <dl className="admin-pending-details">
                    <div><dt>Matrícula</dt><dd>{enfermero.matricula || 'Sin informar'}</dd></div>
                    <div><dt>Especialidad</dt><dd>{enfermero.especialidad || 'Sin informar'}</dd></div>
                  </dl>
                </div>
                <div className="admin-pending-actions">
                  <button className="button button-secondary" type="button" disabled={actualizando !== null} onClick={() => actualizarMatricula(enfermero, false)}>
                    {actualizando === enfermero.idEnfermero ? 'Guardando…' : 'Rechazar'}
                  </button>
                  <button className="button button-primary" type="button" disabled={actualizando !== null} onClick={() => actualizarMatricula(enfermero, true)}>
                    {actualizando === enfermero.idEnfermero ? 'Guardando…' : 'Aprobar matrícula'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
