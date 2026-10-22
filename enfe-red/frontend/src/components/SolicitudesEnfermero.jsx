import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api, enlaceWhatsapp } from '../api';
import { fechaLegible, turnoFuturo } from '../fechas';
import {
  aceptarSolicitud,
  cancelarTurnoEnfermero,
  errorSolicitud,
  finalizarSolicitud,
  obtenerSolicitudesEnfermero,
  rechazarSolicitud,
} from '../services/solicitudes';
import ChatServicio from './ChatServicio';
import { DetalleEstado } from './AccionesSolicitud';
import useActualizacionPeriodica from './useActualizacionPeriodica';
import './Solicitudes.css';

// El chat se habilita al aceptar; después de cerrar queda como registro de lectura.
const CHAT_VISIBLE = ['Aceptada', 'Realizada', 'Cancelada'];
const ACCIONES = {
  aceptar: { enviar: aceptarSolicitud, exito: 'Solicitud aceptada.' },
  rechazar: { enviar: rechazarSolicitud, exito: 'Solicitud rechazada.' },
  // SCRUM-59.3: marcar como realizada habilita la reseña del paciente (HU11).
  finalizar: { enviar: finalizarSolicitud, exito: 'Servicio marcado como realizado.' },
  cancelar: {
    enviar: (id, motivo) => cancelarTurnoEnfermero(id, motivo),
    exito: 'Turno cancelado. Le avisamos al paciente con el motivo que escribiste.',
    propio: true,
  },
};
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 200;
const MENSAJE_MOTIVO = 'Contale al paciente por qué cancelás el turno (entre 5 y 200 caracteres).';

function mensajeError(error) {
  if (!error.response && error.message && error.message !== 'Network Error') {
    return error.message;
  }
  return errorSolicitud(error);
}

// Las pendientes primero (son las que esperan respuesta); el resto conserva el orden por fecha.
function ordenar(items) {
  return [...items].sort((a, b) => (b.estado === 'Pendiente') - (a.estado === 'Pendiente'));
}

export default function SolicitudesEnfermero() {
  const [solicitudes, setSolicitudes] = useState([]);
  const [seleccionada, setSeleccionada] = useState(null);
  const [cancelando, setCancelando] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [errorDialogo, setErrorDialogo] = useState('');
  // Aviso de la última acción, dentro de la tarjeta afectada: en el celular el de arriba no se ve.
  const [aviso, setAviso] = useState(null);
  const [intento, setIntento] = useState(0);
  const [chatAbierto, setChatAbierto] = useState(null);
  const dialog = useRef(null);
  const dialogCancelar = useRef(null);
  const ocupado = useRef(false);
  const idEnfermero = useRef(null);
  const consulta = useRef(null);
  // Cada cambio hecho en pantalla suma uno: una consulta que empezó antes no lo pisa.
  const version = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api('/perfil/enfermero', { signal: controller.signal })
      .then((perfil) => {
        if (!perfil.idEnfermero) throw new Error('No se encontró el perfil profesional.');
        idEnfermero.current = perfil.idEnfermero;
        return obtenerSolicitudesEnfermero(perfil.idEnfermero, controller.signal);
      })
      .then((items) => {
        if (!Array.isArray(items)) throw new Error('La respuesta de solicitudes no es válida.');
        if (!controller.signal.aborted) setSolicitudes(ordenar(items));
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(mensajeError(err));
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

  // El foco va al aviso para que un lector de pantalla (y la vista del celular) llegue a él.
  useEffect(() => {
    if (aviso) document.getElementById(`aviso-solicitud-${aviso.idSolicitud}`)?.focus();
  }, [aviso]);

  // Solo se reemplaza la lista: los diálogos y el chat abiertos no se cierran.
  useActualizacionPeriodica(() => {
    if (!idEnfermero.current || ocupado.current) return;
    consulta.current?.abort();
    const controller = new AbortController();
    consulta.current = controller;
    const inicio = version.current;
    obtenerSolicitudesEnfermero(idEnfermero.current, controller.signal)
      .then((items) => {
        if (!Array.isArray(items) || controller.signal.aborted || version.current !== inicio) return;
        setSolicitudes(ordenar(items));
      })
      .catch(() => {
        // Si falla en segundo plano se sigue mostrando la última lista.
      });
  }, !cargando && !error);

  async function cambiarEstado(solicitud, accion, ...datos) {
    if (ocupado.current) return;
    ocupado.current = true;
    setGuardando(true);
    setErrorDialogo('');
    setAviso(null);
    const enDialogo = accion === 'rechazar' || accion === 'cancelar';
    try {
      const resultado = await ACCIONES[accion].enviar(solicitud.idSolicitud, ...datos);
      const actualizada = resultado.solicitud;
      if (!actualizada?.idSolicitud) throw new Error('El servidor no devolvió la solicitud actualizada.');
      version.current += 1;
      setSolicitudes((items) => items.map((item) =>
        item.idSolicitud === actualizada.idSolicitud ? actualizada : item,
      ));
      setAviso({
        idSolicitud: actualizada.idSolicitud,
        exito: true,
        texto: ACCIONES[accion].propio ? ACCIONES[accion].exito : resultado.mensaje || ACCIONES[accion].exito,
      });
      setSeleccionada(null);
      setCancelando(null);
      dialog.current?.close();
      dialogCancelar.current?.close();
    } catch (err) {
      // El paciente cambió el horario: se muestra el nuevo en la tarjeta para que lo revise antes de aceptar.
      const actual = err.response?.data?.solicitud;
      if (actual?.idSolicitud === solicitud.idSolicitud) {
        version.current += 1;
        setSolicitudes((items) => items.map((item) => (item.idSolicitud === actual.idSolicitud ? actual : item)));
      }
      if (enDialogo) setErrorDialogo(mensajeError(err));
      else setAviso({ idSolicitud: solicitud.idSolicitud, exito: false, texto: mensajeError(err) });
    } finally {
      ocupado.current = false;
      setGuardando(false);
    }
  }

  function abrirCancelar(solicitud) {
    setErrorDialogo('');
    setMotivo('');
    setCancelando(solicitud);
    dialogCancelar.current.showModal();
  }

  function confirmarCancelacion(event) {
    event.preventDefault();
    const texto = motivo.trim();
    if (texto.length < MOTIVO_MIN || texto.length > MOTIVO_MAX) {
      setErrorDialogo(MENSAJE_MOTIVO);
      return;
    }
    cambiarEstado(cancelando, 'cancelar', texto);
  }

  const nombrePaciente = (solicitud) => [solicitud?.paciente?.nombre, solicitud?.paciente?.apellido].filter(Boolean).join(' ');

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
              {solicitud.estado !== 'Pendiente' && <DetalleEstado solicitud={solicitud} enfermero />}
              {aviso?.idSolicitud === solicitud.idSolicitud && (
                <p
                  id={`aviso-solicitud-${solicitud.idSolicitud}`}
                  className={`notice ${aviso.exito ? 'notice-success' : 'notice-error'} solicitud-aviso`}
                  role={aviso.exito ? 'status' : 'alert'}
                  tabIndex={-1}
                >
                  {aviso.texto}
                </p>
              )}
              <dl className="solicitud-summary">
                <dt>Paciente</dt>
                <dd>{solicitud.paciente?.nombre} {solicitud.paciente?.apellido}</dd>
                <dt>Teléfono</dt>
                <dd>
                  {solicitud.paciente?.telefono || 'No informado'}
                  {enlaceWhatsapp(solicitud.paciente?.telefono) && (
                    <>
                      {' · '}
                      <a
                        href={enlaceWhatsapp(
                          solicitud.paciente.telefono,
                          `Hola, te escribo desde Enfered por tu solicitud de ${solicitud.servicio?.tipoServicio || 'atención'} del ${fechaLegible(solicitud.fecha, solicitud.hora)}.`,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Escribir por WhatsApp
                      </a>
                    </>
                  )}
                </dd>
                <dt>Fecha y hora</dt>
                <dd>{fechaLegible(solicitud.fecha, solicitud.hora)}</dd>
                <dt>Dirección</dt>
                <dd>{solicitud.direccionAtencion}</dd>
              </dl>
              {solicitud.estado === 'Aceptada' && (
                !turnoFuturo(solicitud) ? (
                  <div className="solicitud-card-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={guardando}
                      onClick={() => cambiarEstado(solicitud, 'finalizar')}
                    >
                      {guardando ? 'Actualizando…' : 'Marcar como realizado'}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="solicitud-finalizar-hint">
                      Vas a poder marcarlo como realizado después del turno.
                    </p>
                    <div className="solicitud-card-actions">
                      <button
                        className="button button-secondary"
                        type="button"
                        disabled={guardando}
                        onClick={() => abrirCancelar(solicitud)}
                      >
                        Cancelar turno
                      </button>
                    </div>
                  </>
                )
              )}
              {CHAT_VISIBLE.includes(solicitud.estado) && (
                <div className="solicitud-card-actions">
                  <Link className="button button-secondary" to={`/solicitudes/${solicitud.idSolicitud}`}>
                    Ver comprobante
                  </Link>
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
                  key={solicitud.idSolicitud}
                  solicitud={solicitud}
                  onEstadoCambiado={(actual) => setSolicitudes((items) => items.map((item) => (
                    item.idSolicitud === actual.idSolicitud ? { ...item, estado: actual.estado } : item
                  )))}
                  contraparte={nombrePaciente(solicitud)}
                />
              )}
              {solicitud.estado === 'Pendiente' && (
                <div className="solicitud-card-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={guardando}
                    onClick={() => cambiarEstado(solicitud, 'aceptar', { fecha: solicitud.fecha, hora: solicitud.hora })}
                  >
                    {guardando ? 'Actualizando…' : 'Aceptar solicitud'}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={guardando}
                    onClick={() => {
                      setErrorDialogo('');
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
        {errorDialogo && seleccionada && <p className="notice notice-error" role="alert">{errorDialogo}</p>}
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
      <dialog
        className="content-panel solicitud-reject-dialog solicitud-dialogo"
        ref={dialogCancelar}
        aria-labelledby="cancelar-turno-titulo"
        onCancel={(event) => {
          if (ocupado.current) event.preventDefault();
          else setCancelando(null);
        }}
      >
        <form className="form-stack" onSubmit={confirmarCancelacion} aria-busy={guardando}>
          <div>
            <h2 id="cancelar-turno-titulo">¿Cancelar este turno?</h2>
            <p>
              Le vamos a avisar a {nombrePaciente(cancelando) || 'el paciente'} que no vas a poder ir
              {cancelando ? ` el ${fechaLegible(cancelando.fecha, cancelando.hora)}` : ''}.
            </p>
          </div>
          <label className="field">
            ¿Por qué cancelás? El paciente va a leer este mensaje.
            <textarea
              name="motivo"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
              minLength={MOTIVO_MIN}
              maxLength={MOTIVO_MAX}
              aria-describedby="cancelar-turno-cuenta"
              readOnly={guardando}
              required
            />
          </label>
          <p id="cancelar-turno-cuenta" className="field-hint">
            {motivo.trim().length}/{MOTIVO_MAX} caracteres (mínimo {MOTIVO_MIN}).
          </p>
          {errorDialogo && cancelando && <p className="notice notice-error" role="alert">{errorDialogo}</p>}
          <div className="solicitud-card-actions">
            <button
              className="button button-secondary"
              type="button"
              disabled={guardando}
              onClick={() => {
                dialogCancelar.current.close();
                setCancelando(null);
              }}
            >
              Volver
            </button>
            <button className="button button-primary" type="submit" disabled={guardando || !cancelando}>
              {guardando ? 'Cancelando…' : 'Sí, cancelar turno'}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
