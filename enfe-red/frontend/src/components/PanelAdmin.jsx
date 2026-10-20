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
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
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
    </div>
  );
}
