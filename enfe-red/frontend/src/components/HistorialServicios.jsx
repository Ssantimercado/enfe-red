import { useEffect, useState } from 'react';
import { requestApi as api } from '../api';
import Icon from './ui/Icon';
import ModalCalificacion from './ModalCalificacion';
import { EstrellasLectura } from './SelectorEstrellas';

function fechaLegible(fecha) {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

const FILTROS_VACIOS = { desde: '', hasta: '', estado: '' };

export default function HistorialServicios({ userId, nurse }) {
  const [abierto, setAbierto] = useState(false);
  const [filtros, setFiltros] = useState(FILTROS_VACIOS);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const [calificando, setCalificando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorCalificacion, setErrorCalificacion] = useState('');
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    if (!abierto) return undefined;
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api(`/usuarios/${userId}/historial`, { signal: controller.signal })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('La respuesta del historial no es válida.');
        setSolicitudes(items);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [abierto, intento, userId]);

  const titulo = nurse ? 'Historial de pacientes' : 'Historial de enfermeros';
  // Las opciones salen de la respuesta: el backend decide qué estados integran el historial.
  const estados = [...new Set(solicitudes.map((item) => item.estado).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'es'));
  const rangoInvalido = Boolean(filtros.desde && filtros.hasta && filtros.desde > filtros.hasta);
  const filtrando = Boolean(filtros.desde || filtros.hasta || filtros.estado);
  const visibles = rangoInvalido
    ? solicitudes
    : solicitudes.filter((item) => (
      (!filtros.desde || item.fecha >= filtros.desde)
      && (!filtros.hasta || item.fecha <= filtros.hasta)
      && (!filtros.estado || item.estado === filtros.estado)
    ));

  function cambiarFiltro(campo, valor) {
    setFiltros((actuales) => ({ ...actuales, [campo]: valor }));
  }

  function iniciarCalificacion(solicitud) {
    setCalificando(solicitud);
    setErrorCalificacion('');
    setMensaje('');
  }

  async function enviarCalificacion({ estrellas, comentario }) {
    const solicitud = calificando;
    if (guardando || !solicitud) return;
    setGuardando(true);
    setErrorCalificacion('');
    setMensaje('');
    try {
      let calificacion;
      if (nurse) {
        const resultado = await api(`/solicitudes/${solicitud.idSolicitud}/calificaciones`, {
          method: 'POST',
          body: { estrellas, comentario },
        });
        calificacion = resultado.calificacion;
      } else {
        // SCRUM-66.2: el paciente publica una reseña del enfermero (endpoint de Santiago).
        const resultado = await api('/resenas', {
          method: 'POST',
          body: { idSolicitud: solicitud.idSolicitud, puntuacion: estrellas, comentario },
        });
        calificacion = resultado.resena && {
          idCalificacion: resultado.resena.idResena,
          idSolicitud: resultado.resena.idSolicitud,
          idUsuarioAutor: userId,
          estrellas: resultado.resena.puntuacion,
          comentario: resultado.resena.comentario,
          fecha: resultado.resena.fecha,
        };
      }
      if (!calificacion?.idCalificacion) {
        throw new Error('El servidor no devolvió la calificación guardada.');
      }
      setSolicitudes((actuales) => actuales.map((item) => (
        item.idSolicitud === solicitud.idSolicitud
          ? { ...item, calificaciones: [...(item.calificaciones || []), calificacion] }
          : item
      )));
      setCalificando(null);
      setMensaje('Tu calificación se guardó correctamente.');
    } catch (err) {
      setErrorCalificacion(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <section className="content-panel service-history">
      <div className="panel-heading">
        <div>
          <h2>{titulo}</h2>
          <p>
            {nurse
              ? 'Consultá las atenciones aceptadas cuya fecha y hora ya pasó.'
              : 'Consultá los servicios aceptados cuya fecha y hora ya pasó.'}
          </p>
        </div>
        <button
          className="button button-secondary"
          type="button"
          aria-expanded={abierto}
          aria-controls="service-history-list"
          onClick={() => setAbierto((value) => !value)}
        >
          {abierto ? 'Ocultar historial' : `Ver ${titulo.toLowerCase()}`}
          <Icon name="arrow" size={16} />
        </button>
      </div>
      <div id="service-history-list" aria-busy={cargando} hidden={!abierto}>
        {abierto && (
          cargando ? (
            <p role="status">Cargando historial…</p>
          ) : error ? (
            <div className="notice notice-error" role="alert">
              {error}
              <button className="text-link" onClick={() => setIntento((value) => value + 1)}>
                Reintentar
              </button>
            </div>
          ) : solicitudes.length ? (
            <>
            <div className="service-history-filters" role="group" aria-label="Filtrar historial">
              <div className="field">
                <span>Fecha de atención</span>
                <div className="price-range">
                  <label>
                    <span className="range-label">Desde</span>
                    <input
                      type="date"
                      aria-label="Fecha desde"
                      aria-describedby={rangoInvalido ? 'historial-fechas' : undefined}
                      aria-invalid={rangoInvalido}
                      max={filtros.hasta || undefined}
                      value={filtros.desde}
                      onChange={(event) => cambiarFiltro('desde', event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="range-label">Hasta</span>
                    <input
                      type="date"
                      aria-label="Fecha hasta"
                      aria-describedby={rangoInvalido ? 'historial-fechas' : undefined}
                      aria-invalid={rangoInvalido}
                      min={filtros.desde || undefined}
                      value={filtros.hasta}
                      onChange={(event) => cambiarFiltro('hasta', event.target.value)}
                    />
                  </label>
                </div>
                {rangoInvalido && (
                  <span id="historial-fechas" className="field-error" role="alert">
                    La fecha desde no puede ser posterior a la fecha hasta.
                  </span>
                )}
              </div>
              <div className="field">
                <label htmlFor="historial-estado">Estado</label>
                <select
                  id="historial-estado"
                  value={filtros.estado}
                  onChange={(event) => cambiarFiltro('estado', event.target.value)}
                >
                  <option value="">Todos los estados</option>
                  {estados.map((estado) => (
                    <option key={estado}>{estado}</option>
                  ))}
                </select>
              </div>
              <div className="service-history-filters-summary">
                <p role="status">
                  {filtrando
                    ? `${visibles.length} de ${solicitudes.length} servicios`
                    : `${solicitudes.length} ${solicitudes.length === 1 ? 'servicio' : 'servicios'}`}
                </p>
                {filtrando && (
                  <button className="text-link" type="button" onClick={() => setFiltros(FILTROS_VACIOS)}>
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>
            {visibles.length ? (
            <div className="service-history-list">
              {visibles.map((solicitud) => {
                const persona = nurse ? solicitud.paciente : solicitud.enfermero;
                const calificaciones = solicitud.calificaciones || [];
                const propia = calificaciones.find((item) => item.idUsuarioAutor === userId);
                const recibida = calificaciones.find((item) => item.idUsuarioCalificado === userId);
                return (
                  <article className="service-history-item" key={solicitud.idSolicitud}>
                    <div>
                      <h3>
                        {persona?.nombre} {persona?.apellido}
                      </h3>
                      <p>{solicitud.servicio?.tipoServicio || 'Servicio solicitado'}</p>
                    </div>
                    <dl>
                      <div>
                        <dt>Fecha</dt>
                        <dd>{fechaLegible(solicitud.fecha)} · {solicitud.hora}</dd>
                      </div>
                      <div>
                        <dt>Estado</dt>
                        <dd>{solicitud.estado}</dd>
                      </div>
                    </dl>
                    <div className="service-rating">
                      {propia ? (
                        <p>
                          Tu calificación: <EstrellasLectura valor={propia.estrellas} />
                          <span> · {propia.comentario}</span>
                        </p>
                      ) : solicitud.estado === 'Realizada' ? (
                        <button
                          className="text-link"
                          type="button"
                          onClick={() => iniciarCalificacion(solicitud)}
                        >
                          Calificar {nurse ? 'paciente' : 'enfermero'}
                        </button>
                      ) : (
                        // HU11: la reseña se habilita una vez finalizada la atención.
                        <p className="filter-hint">
                          {nurse
                            ? 'Marcá el servicio como realizado desde Solicitudes para poder calificar.'
                            : 'Vas a poder calificar cuando el enfermero marque el servicio como realizado.'}
                        </p>
                      )}
                      {recibida && (
                        <p>
                          Calificación recibida: <EstrellasLectura valor={recibida.estrellas} />
                          <span> · {recibida.comentario}</span>
                        </p>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
            ) : (
              <p className="service-history-empty">
                Ningún servicio coincide con los filtros elegidos.
              </p>
            )}
            </>
          ) : (
            <p className="service-history-empty">
              Todavía no hay servicios aceptados cuya fecha y hora hayan pasado.
            </p>
          )
        )}
      </div>
      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
      {calificando && (
        <ModalCalificacion
          key={calificando.idSolicitud}
          id={`calificacion-${calificando.idSolicitud}`}
          titulo={nurse ? 'Calificar paciente' : 'Calificar enfermero'}
          descripcion={[
            [
              (nurse ? calificando.paciente : calificando.enfermero)?.nombre,
              (nurse ? calificando.paciente : calificando.enfermero)?.apellido,
            ].filter(Boolean).join(' '),
            calificando.servicio?.tipoServicio,
            fechaLegible(calificando.fecha),
          ].filter(Boolean).join(' · ')}
          guardando={guardando}
          error={errorCalificacion}
          onEnviar={enviarCalificacion}
          onCerrar={() => setCalificando(null)}
        />
      )}
    </section>
  );
}
