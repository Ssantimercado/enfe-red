import { useEffect, useState } from 'react';
import { requestApi as api } from '../api';
import Icon from './ui/Icon';

function fechaLegible(fecha) {
  const [year, month, day] = fecha.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function HistorialServicios({ userId, nurse }) {
  const [abierto, setAbierto] = useState(false);
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const [calificando, setCalificando] = useState(null);
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState('');
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
  const palabras = comentario.trim() ? comentario.trim().split(/\s+/).length : 0;

  function iniciarCalificacion(idSolicitud) {
    setCalificando(idSolicitud);
    setEstrellas(0);
    setComentario('');
    setErrorCalificacion('');
    setMensaje('');
  }

  async function enviarCalificacion(event, solicitud) {
    event.preventDefault();
    if (guardando || !estrellas || palabras > 250) return;
    setGuardando(true);
    setErrorCalificacion('');
    setMensaje('');
    try {
      const resultado = await api(`/solicitudes/${solicitud.idSolicitud}/calificaciones`, {
        method: 'POST',
        body: { estrellas, comentario },
      });
      if (!resultado.calificacion?.idCalificacion) {
        throw new Error('El servidor no devolvió la calificación guardada.');
      }
      setSolicitudes((actuales) => actuales.map((item) => (
        item.idSolicitud === solicitud.idSolicitud
          ? { ...item, calificaciones: [...(item.calificaciones || []), resultado.calificacion] }
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
            <div className="service-history-list">
              {solicitudes.map((solicitud) => {
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
                          Tu calificación: <strong>{'★'.repeat(propia.estrellas)}{'☆'.repeat(5 - propia.estrellas)}</strong>
                          <span> · {propia.comentario}</span>
                        </p>
                      ) : (
                        <button
                          className="text-link"
                          type="button"
                          onClick={() => iniciarCalificacion(solicitud.idSolicitud)}
                        >
                          Calificar {nurse ? 'paciente' : 'enfermero'}
                        </button>
                      )}
                      {recibida && (
                        <p>
                          Calificación recibida: <strong>{'★'.repeat(recibida.estrellas)}{'☆'.repeat(5 - recibida.estrellas)}</strong>
                          <span> · {recibida.comentario}</span>
                        </p>
                      )}
                      {calificando === solicitud.idSolicitud && (
                        <form
                          className="service-rating-form"
                          onSubmit={(event) => enviarCalificacion(event, solicitud)}
                        >
                          <fieldset className="service-rating-stars">
                            <legend>Calificación (1 a 5 estrellas)</legend>
                            {Array.from({ length: 5 }, (_, index) => index + 1).map((valor) => (
                              <label key={valor}>
                                <input
                                  type="radio"
                                  name={`calificacion-${solicitud.idSolicitud}`}
                                  value={valor}
                                  checked={estrellas === valor}
                                  onChange={() => setEstrellas(valor)}
                                  required
                                />
                                <span aria-hidden="true">{valor <= estrellas ? '★' : '☆'}</span>
                                <span className="service-rating-label">{valor}</span>
                              </label>
                            ))}
                          </fieldset>
                          <label className="field">
                            Comentario (máximo 250 palabras)
                            <textarea
                              value={comentario}
                              onChange={(event) => setComentario(event.target.value)}
                              aria-describedby={`comentario-palabras-${solicitud.idSolicitud}`}
                              required
                            />
                          </label>
                          <p id={`comentario-palabras-${solicitud.idSolicitud}`} className="filter-hint">
                            {palabras}/250 palabras
                          </p>
                          {errorCalificacion && (
                            <p className="notice notice-error" role="alert">{errorCalificacion}</p>
                          )}
                          <div className="service-rating-actions">
                            <button
                              className="button button-primary"
                              type="submit"
                              disabled={guardando || !estrellas || !palabras || palabras > 250}
                            >
                              {guardando ? 'Guardando…' : 'Enviar calificación'}
                            </button>
                            <button
                              className="button button-secondary"
                              type="button"
                              disabled={guardando}
                              onClick={() => setCalificando(null)}
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="service-history-empty">
              Todavía no hay servicios aceptados cuya fecha y hora hayan pasado.
            </p>
          )
        )}
      </div>
      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
    </section>
  );
}
