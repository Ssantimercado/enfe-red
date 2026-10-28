import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { requestApi as api } from '../api';
import Icon from './ui/Icon';

const CADA_MS = 45000;

// Etiqueta corta arriba del mensaje para reconocer de un vistazo de qué se trata.
const TIPOS = {
  aceptada: 'Turno aceptado',
  rechazada: 'Turno rechazado',
  mensaje: 'Mensaje nuevo',
  cancelada: 'Turno cancelado',
  nueva: 'Solicitud nueva',
  reprogramada: 'Turno reprogramado',
  realizada: 'Atención realizada',
  vencida: 'Venció sin respuesta',
  matricula: 'Tu matrícula',
  ubicacion: 'Lugar de atención',
};

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

function destinoDe(item) {
  if (item.idSolicitud) return `/solicitudes/${item.idSolicitud}`;
  if (item.tipo === 'matricula') return '/perfil-enfermero';
  return null;
}

// SCRUM-64: la campana permanece oculta hasta que el endpoint de Renzo responda,
// para no mostrar un contador que no proviene de datos reales. Una vez visible,
// una consulta fallida no la esconde: se siguen mostrando las últimas notificaciones.
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
  const navigate = useNavigate();

  useEffect(() => {
    if (!Number.isInteger(userId)) return undefined;
    let controller;
    let timer;
    function consultar() {
      controller?.abort();
      const actual = new AbortController();
      controller = actual;
      setCargando(true);
      api(`/notificaciones/${userId}`, { signal: actual.signal })
        .then((items) => {
          if (!Array.isArray(items)) throw new Error('La respuesta de notificaciones no es válida.');
          setNotificaciones(items);
          setDisponible(true);
          setError('');
        })
        .catch((err) => {
          if (!actual.signal.aborted) setError(err.message);
        })
        .finally(() => {
          if (!actual.signal.aborted) setCargando(false);
        });
    }
    // Con la pestaña oculta no se consulta: se pone al día apenas la persona vuelve.
    function programar() {
      timer = window.setTimeout(() => {
        if (!document.hidden) consultar();
        programar();
      }, CADA_MS);
    }
    function alVolver() {
      if (!document.hidden) consultar();
    }
    consultar();
    programar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      controller?.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', alVolver);
    };
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

  async function marcarLeida(item) {
    if (marcando) return;
    setMarcando(item.idNotificacion);
    setError('');
    try {
      await api(`/notificaciones/${item.idNotificacion}/leer`, { method: 'PUT' });
      setNotificaciones((actuales) => actuales.map((actual) => (
        actual.idNotificacion === item.idNotificacion ? { ...actual, leida: true } : actual
      )));
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setMarcando(null);
    }
  }

  async function abrir(item) {
    const destino = destinoDe(item);
    if (!item.leida) {
      const marcada = await marcarLeida(item);
      // Sin destino, el error queda a la vista en el panel; con destino se abre igual.
      if (!marcada && !destino) return;
    }
    if (!destino) return;
    setAbierto(false);
    navigate(destino);
  }

  async function marcarTodas() {
    if (marcando) return;
    setMarcando('todas');
    setError('');
    try {
      await api('/notificaciones/leer-todas', { method: 'PUT' });
      setNotificaciones((actuales) => actuales.map((item) => ({ ...item, leida: true })));
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
          <div className="notification-panel-heading">
            <h2>Notificaciones</h2>
            {sinLeer > 0 && (
              <button
                className="text-link"
                type="button"
                disabled={Boolean(marcando)}
                onClick={marcarTodas}
              >
                {marcando === 'todas' ? 'Marcando…' : 'Marcar todas como leídas'}
              </button>
            )}
          </div>
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
              {notificaciones.map((item) => {
                const destino = destinoDe(item);
                const contenido = (
                  <>
                    {TIPOS[item.tipo] && <strong className="notification-type">{TIPOS[item.tipo]}</strong>}
                    <span>{item.mensaje}</span>
                    <time dateTime={item.fechaHora}>
                      {marcando === item.idNotificacion
                        ? 'Marcando como leída…'
                        : `${fechaLegible(item.fechaHora)}${item.leida ? '' : ' · Sin leer'}${destino ? ' · Tocá para ver' : ''}`}
                    </time>
                  </>
                );
                return (
                  <li key={item.idNotificacion}>
                    {item.leida && !destino ? (
                      <div className="notification-item">{contenido}</div>
                    ) : (
                      <button
                        className={`notification-item ${item.leida ? '' : 'unread'}`}
                        type="button"
                        disabled={marcando === item.idNotificacion}
                        onClick={() => abrir(item)}
                      >
                        {contenido}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            !error && <p className="notification-empty">No tenés notificaciones por ahora.</p>
          )}
        </div>
      )}
    </div>
  );
}
