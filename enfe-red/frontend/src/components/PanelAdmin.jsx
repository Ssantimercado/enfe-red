import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';
import MiCuenta from './MiCuenta';
import DialogoMotivo from './DialogoMotivo';
import { fechaHora, nombreCompleto, quienReviso } from './adminComun';

const METRICAS = [
  ['total_usuarios', 'Usuarios registrados'],
  ['pacientes', 'Pacientes'],
  ['enfermeros', 'Enfermeros'],
  ['usuarios_suspendidos', 'Cuentas suspendidas'],
  ['matriculas_pendientes', 'Matrículas pendientes'],
  ['total_solicitudes', 'Solicitudes'],
];
// Mismo orden en que avanza una solicitud; "Vencida" es la que nadie respondió a tiempo.
const ESTADOS_SOLICITUD = [
  ['Pendiente', 'Pendientes'],
  ['Aceptada', 'Aceptadas'],
  ['Realizada', 'Realizadas'],
  ['Rechazada', 'Rechazadas'],
  ['Cancelada', 'Canceladas'],
  ['Vencida', 'Vencidas sin respuesta'],
];
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 300;
const MENSAJE_MOTIVO = 'Escribí el motivo del rechazo para que el profesional sepa qué corregir (entre 5 y 300 caracteres).';

const cantidadValida = (valor) => Number.isInteger(valor) && valor >= 0;

function conteoPorEstado(data) {
  const conteo = data?.solicitudes_por_estado;
  if (!conteo || typeof conteo !== 'object') return null;
  return ESTADOS_SOLICITUD.every(([estado]) => cantidadValida(conteo[estado])) ? conteo : null;
}

function textoRevision(enfermero) {
  if (!enfermero?.verificadoEn) return '';
  const quien = quienReviso(enfermero.verificadoPor);
  return `Última revisión: ${fechaHora(enfermero.verificadoEn)}${quien ? ` por ${quien}` : ''}.`;
}

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
  // { enfermero, verificado }: la matrícula que se está por aprobar o rechazar.
  const [revision, setRevision] = useState(null);
  const [errorDialogo, setErrorDialogo] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    setMetricas(null);
    api('/admin/metricas', { signal: controller.signal })
      .then((data) => {
        const validas = METRICAS.every(([key]) => cantidadValida(data[key]));
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

  function abrirRevision(enfermero, verificado) {
    setErrorDialogo('');
    setMensajeMatriculas('');
    setRevision({ enfermero, verificado });
  }

  async function actualizarMatricula(motivo) {
    const { enfermero, verificado } = revision;
    setActualizando(enfermero.idEnfermero);
    setErrorDialogo('');
    try {
      const data = await api(`/admin/enfermeros/${enfermero.idEnfermero}/matricula`, {
        method: 'PUT',
        body: verificado ? { verificado } : { verificado, motivo },
      });
      const resultado = { ...enfermero, ...data?.enfermero };
      const nombre = nombreCompleto(enfermero, 'el profesional');
      const cancelados = cantidadValida(resultado.turnosCancelados) ? resultado.turnosCancelados : 0;
      setPendientes((items) => items.filter((item) => item.idEnfermero !== enfermero.idEnfermero));
      setMensajeMatriculas([
        verificado
          ? `Matrícula de ${nombre} aprobada. Ya puede aparecer en la búsqueda.`
          : `Matrícula de ${nombre} rechazada. Le avisamos para que corrija sus datos.`,
        !verificado && resultado.motivoRechazo ? `Motivo: ${resultado.motivoRechazo}` : '',
        textoRevision(resultado),
        cancelados > 0
          ? `Se ${cancelados === 1 ? 'canceló 1 turno' : `cancelaron ${cancelados} turnos`} y avisamos a los pacientes.`
          : '',
      ].filter(Boolean).join(' '));
      setRevision(null);
      setIntento((value) => value + 1);
    } catch (err) {
      setErrorDialogo(err.message);
    } finally {
      setActualizando(null);
    }
  }

  const porEstado = conteoPorEstado(metricas);
  const denunciadas = cantidadValida(metricas?.resenas_denunciadas) ? metricas.resenas_denunciadas : null;

  return (
    <div className="page-container admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Panel de administración</h1>
          <p>Un resumen de las cuentas y la actividad de Enfered.</p>
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

      {denunciadas !== null && (
        <section
          className={`content-panel admin-alert-panel ${denunciadas > 0 ? 'has-pending' : ''}`}
          aria-labelledby="admin-denuncias-titulo"
        >
          <div>
            <h2 id="admin-denuncias-titulo">Reseñas denunciadas</h2>
            <p>
              {denunciadas === 0
                ? 'No hay denuncias esperando revisión.'
                : `${denunciadas === 1 ? 'Hay 1 reseña denunciada' : `Hay ${denunciadas.toLocaleString('es-AR')} reseñas denunciadas`} esperando que la revises.`}
            </p>
          </div>
          <Link
            className={denunciadas > 0 ? 'button button-primary' : 'button button-secondary'}
            to={denunciadas > 0 ? '/admin/resenas?filtro=denunciadas' : '/admin/resenas'}
          >
            {denunciadas > 0 ? 'Revisar denuncias' : 'Ver reseñas'}
          </Link>
        </section>
      )}

      {porEstado && (
        <section className="admin-states-section" aria-labelledby="admin-estados-titulo">
          <h2 id="admin-estados-titulo">Solicitudes por estado</h2>
          <ul className="admin-states-list">
            {ESTADOS_SOLICITUD.map(([estado, label]) => (
              <li className="content-panel" key={estado}>
                <span>{label}</span>
                <strong>{porEstado[estado].toLocaleString('es-AR')}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

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
            {pendientes.map((enfermero) => {
              const revisionAnterior = textoRevision(enfermero);
              return (
                <article className="content-panel admin-pending-card" key={enfermero.idEnfermero}>
                  <div>
                    <h3>{nombreCompleto(enfermero, 'Enfermero sin nombre')}</h3>
                    <p>{enfermero.email}</p>
                    <dl className="admin-pending-details">
                      <div><dt>Matrícula</dt><dd>{enfermero.matricula || 'Sin informar'}</dd></div>
                      <div><dt>Especialidad</dt><dd>{enfermero.especialidad || 'Sin informar'}</dd></div>
                    </dl>
                    {/* Si ya se había rechazado, el motivo ayuda a ver si corrigió lo que se le pidió. */}
                    {enfermero.motivoRechazo && (
                      <p className="admin-review-note">
                        <strong>Rechazo anterior:</strong> {enfermero.motivoRechazo}
                      </p>
                    )}
                    {revisionAnterior && <p className="admin-review-meta">{revisionAnterior}</p>}
                  </div>
                  <div className="admin-pending-actions">
                    <button className="button button-secondary" type="button" disabled={actualizando !== null} onClick={() => abrirRevision(enfermero, false)}>
                      Rechazar
                    </button>
                    <button className="button button-primary" type="button" disabled={actualizando !== null} onClick={() => abrirRevision(enfermero, true)}>
                      Aprobar matrícula
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <DialogoMotivo
        abierto={revision !== null}
        titulo={revision?.verificado ? '¿Aprobar esta matrícula?' : '¿Rechazar esta matrícula?'}
        descripcion={revision?.verificado
          ? `${nombreCompleto(revision.enfermero, 'El profesional')} (matrícula ${revision.enfermero.matricula || 'sin informar'}) va a aparecer en la búsqueda y en el mapa.`
          : `${nombreCompleto(revision?.enfermero, 'El profesional')} no va a aparecer en la búsqueda. Si tiene turnos pedidos o confirmados, se cancelan y les avisamos a los pacientes.`}
        etiqueta={revision && !revision.verificado
          ? '¿Por qué la rechazás? El profesional va a leer este motivo para corregir sus datos.'
          : undefined}
        minimo={MOTIVO_MIN}
        maximo={MOTIVO_MAX}
        mensajeMotivo={MENSAJE_MOTIVO}
        textoConfirmar={revision?.verificado ? 'Sí, aprobar' : 'Sí, rechazar'}
        guardando={actualizando !== null}
        error={errorDialogo}
        onConfirmar={actualizarMatricula}
        onCerrar={() => setRevision(null)}
      />
      <MiCuenta rol="administrador" />
    </div>
  );
}
