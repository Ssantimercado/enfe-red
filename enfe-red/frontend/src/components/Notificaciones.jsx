import { useEffect, useRef, useState } from 'react';
import { requestApi as api } from '../api';
import Icon from './ui/Icon';

function fechaLegible(valor) {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) return valor || '';
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// SCRUM-64: la campana permanece oculta hasta que el endpoint de Renzo responda,
// para no mostrar un contador que no proviene de datos reales.
export default function Notificaciones({ userId }) {
  const [disponible, setDisponible] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [notificaciones, setNotificaciones] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const [marcando, setMarcando] = useState(null);
  const [intento, setIntento] = useState(0);
  const contenedor = useRef(null);
  const disparador = useRef(null);

  useEffect(() => {
    if (!Number.isInteger(userId)) return undefined;
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api(`/notificaciones/${userId}`, { signal: controller.signal })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('La respuesta de notificaciones no es válida.');
        setNotificaciones(items);
        setDisponible(true);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [userId, intento]);

  useEffect(() => {
    if (!abierto) return undefined;
    function cerrarFuera(event) {
      if (!contenedor.current?.contains(event.target)) setAbierto(false);
    }
    function cerrarConEscape(event) {
      if (event.key !== 'Escape') return;
      setAbierto(false);
      disparador.current?.focus();
    }
    document.addEventListener('mousedown', cerrarFuera);
    document.addEventListener('keydown', cerrarConEscape);
    return () => {
      document.removeEventListener('mousedown', cerrarFuera);
      document.removeEventListener('keydown', cerrarConEscape);
    };
  }, [abierto]);

  if (!disponible) return null;

  const sinLeer = notificaciones.filter((item) => !item.leida).length;

  function alternar() {
    if (!abierto) setIntento((value) => value + 1);
    setAbierto((value) => !value);
  }

  async function marcarLeida(idNotificacion) {
    if (marcando) return;
    setMarcando(idNotificacion);
    setError('');
    try {
      await api(`/notificaciones/${idNotificacion}/leer`, { method: 'PUT' });
      setNotificaciones((actuales) => actuales.map((item) => (
        item.idNotificacion === idNotificacion ? { ...item, leida: true } : item
      )));
    } catch (err) {
      setError(err.message);
    } finally {
      setMarcando(null);
    }
  }

  return (
    <div className="notification-menu" ref={contenedor}>
      <button
        ref={disparador}
        className="icon-button notification-trigger"
        type="button"
        aria-expanded={abierto}
        aria-controls="notification-panel"
        aria-label={sinLeer
          ? `Notificaciones, ${sinLeer} sin leer`
          : 'Notificaciones'}
        title="Notificaciones"
        onClick={alternar}
      >
        <Icon name="bell" size={19} />
        {sinLeer > 0 && (
          <span className="notification-count" aria-hidden="true">
            {sinLeer > 9 ? '9+' : sinLeer}
          </span>
        )}
      </button>
      {abierto && (
        <div id="notification-panel" className="notification-panel" aria-busy={cargando}>
          <h2>Notificaciones</h2>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}{' '}
              <button className="text-link" type="button" onClick={() => setIntento((value) => value + 1)}>
                Reintentar
              </button>
            </div>
          )}
          {cargando && !notificaciones.length ? (
            <p className="notification-empty" role="status">Cargando notificaciones…</p>
          ) : notificaciones.length ? (
            <ul className="notification-list">
              {notificaciones.map((item) => (
                <li key={item.idNotificacion}>
                  {item.leida ? (
                    <div className="notification-item">
                      <span>{item.mensaje}</span>
                      <time dateTime={item.fechaHora}>{fechaLegible(item.fechaHora)}</time>
                    </div>
                  ) : (
                    <button
                      className="notification-item unread"
                      type="button"
                      disabled={marcando === item.idNotificacion}
                      onClick={() => marcarLeida(item.idNotificacion)}
                    >
                      <span>{item.mensaje}</span>
                      <time dateTime={item.fechaHora}>
                        {marcando === item.idNotificacion
                          ? 'Marcando como leída…'
                          : `${fechaLegible(item.fechaHora)} · Sin leer`}
                      </time>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !error && <p className="notification-empty">No tenés notificaciones por ahora.</p>
          )}
        </div>
      )}
    </div>
  );
}
