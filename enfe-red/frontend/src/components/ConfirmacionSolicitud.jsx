import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { enlaceWhatsapp, sesionActual } from '../api';
import { fechaLegible } from '../fechas';
import { obtenerSolicitud, errorSolicitud } from '../services/solicitudes';
import {
  AccionesPaciente, DetalleEstado, NOTA_WHATSAPP_PACIENTE, calificacionesDelHistorial, mensajeWhatsappEnfermero,
  whatsappParaPaciente,
} from './AccionesSolicitud';
import CancelarSolicitud from './CancelarSolicitud';
import ChatServicio, { CHAT_ABIERTO, CHAT_VISIBLE } from './ChatServicio';
import useActualizacionPeriodica from './useActualizacionPeriodica';
import './Solicitudes.css';

const UbicacionAtencion = lazy(() => import('./UbicacionAtencion'));

export default function ConfirmacionSolicitud() {
  const { idSolicitud } = useParams();
  // Al llegar recién enviada desde el formulario se confirma arriba de todo que el pedido salió. Se guarda en el
  // estado y se borra del historial: al recargar o volver con Atrás el aviso no reaparece.
  const location = useLocation();
  const navigate = useNavigate();
  const [enviada] = useState(() => location.state?.recienEnviada ? location.state : null);
  const avisoEnviada = useRef(null);
  useEffect(() => {
    if (location.state?.recienEnviada) navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);
  // El paciente y el enfermero asignado ven el mismo comprobante; el backend valida el acceso.
  const enfermero = sesionActual()?.rol === 'enfermero';
  const otraParte = (s) => (enfermero ? s?.paciente : s?.enfermero);
  const nombreOtraParte = (s) => [otraParte(s)?.nombre, otraParte(s)?.apellido].filter(Boolean).join(' ');
  const [solicitud, setSolicitud] = useState(null);
  // El foco va al aviso (y no al título) para que el lector de pantalla confirme que el pedido salió.
  const mostrarEnviada = Boolean(enviada) && solicitud?.estado === 'Pendiente';
  useEffect(() => {
    if (mostrarEnviada) avisoEnviada.current?.focus();
  }, [mostrarEnviada]);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);
  const [calificaciones, setCalificaciones] = useState({});
  const realizada = !enfermero && solicitud?.estado === 'Realizada';
  useEffect(() => {
    const controller = new AbortController();
    setSolicitud(null);
    setError('');
    obtenerSolicitud(idSolicitud, controller.signal).then(data => {
      if (!data.idSolicitud) throw new Error('Respuesta inválida');
      setSolicitud(data);
    }).catch(err => { if (!controller.signal.aborted) setError(errorSolicitud(err)); });
    return () => controller.abort();
  }, [idSolicitud, intento]);
  useActualizacionPeriodica(() => {
    obtenerSolicitud(idSolicitud)
      .then((data) => { if (String(data?.idSolicitud) === String(idSolicitud)) setSolicitud(data); })
      // Si falla, queda lo que ya se mostraba y se reintenta en la próxima vuelta.
      .catch(() => {});
  }, CHAT_ABIERTO.includes(solicitud?.estado));
  useEffect(() => {
    if (!realizada) return undefined;
    const controller = new AbortController();
    calificacionesDelHistorial(controller.signal)
      .then((encontradas) => { if (!controller.signal.aborted) setCalificaciones((actuales) => ({ ...encontradas, ...actuales })); })
      // Sin historial se ofrece calificar igual: el backend no acepta una segunda reseña.
      .catch(() => {});
    return () => controller.abort();
  }, [realizada, idSolicitud]);
  function irAlChat() {
    const chat = document.getElementById(`chat-${idSolicitud}`);
    chat?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    chat?.querySelector('textarea')?.focus({ preventScroll: true });
  }
  // AppShell ya tiene el <main>: acá va un contenedor común para no anidarlo.
  return <div className="page-container solicitud-page">
    <header className="page-heading"><h1>Comprobante de solicitud</h1></header>
    {mostrarEnviada && <p ref={avisoEnviada} tabIndex={-1} className="notice notice-success solicitud-enviada">
      <strong>¡Listo! Tu pedido le llegó a {enviada.profesional || 'el profesional'}.</strong> Te avisamos en la campana y en
      Mis solicitudes cuando lo acepte.{' '}
      {/* El chat queda más abajo: en el celular no se ve sin bajar. */}
      <button type="button" className="text-link" onClick={irAlChat}>Escribile por el chat mientras tanto</button>
    </p>}
    <section className="content-panel">
    {error ? <><p role="alert" className="notice notice-error">{error}</p><button className="button button-secondary" onClick={() => setIntento(i => i + 1)}>Reintentar consulta</button></> : !solicitud ? <p role="status">Cargando comprobante…</p> : <>
      <p className="notice notice-info" role="status">Estado: <strong>{solicitud.estado}</strong></p>
      {solicitud.estado === 'Pendiente'
        ? <p>{enfermero ? 'El pedido espera tu respuesta en Solicitudes.' : 'Tu pedido está registrado y espera la aceptación del enfermero.'}</p>
        : <DetalleEstado solicitud={solicitud} enfermero={enfermero} calificada={Boolean(calificaciones[solicitud.idSolicitud])} />}
      <dl className="solicitud-summary">
        <dt>Número</dt><dd>{solicitud.idSolicitud}</dd>
        <dt>{enfermero ? 'Paciente' : 'Profesional'}</dt><dd>{nombreOtraParte(solicitud) || 'No informado'}</dd>
        <dt>Servicio</dt><dd>{solicitud.servicio?.tipoServicio || 'No informado'}</dd>
        <dt>Fecha</dt><dd>{fechaLegible(solicitud.fecha)}</dd>
        <dt>Hora</dt><dd>{solicitud.horaFin ? `De ${solicitud.hora} a ${solicitud.horaFin} hs` : `${solicitud.hora} hs`}</dd>
        <dt>Dirección</dt><dd>{solicitud.direccionAtencion}</dd>
        <dt>Precio estimado</dt><dd>{solicitud.servicio?.precioEstimado != null ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(solicitud.servicio.precioEstimado) : 'A consultar'}</dd>
      </dl>
      {enfermero && CHAT_ABIERTO.includes(solicitud.estado) && (
        <Suspense fallback={<p role="status">Cargando mapa…</p>}>
          <UbicacionAtencion
            ubicacion={solicitud.ubicacionAtencion}
            direccion={solicitud.direccionAtencion}
            paciente={nombreOtraParte(solicitud)}
          />
        </Suspense>
      )}
      {!enfermero && <AccionesPaciente
        comprobante
        solicitud={solicitud}
        calificacion={calificaciones[solicitud.idSolicitud]}
        onActualizada={setSolicitud}
        onCalificada={(calificacion) => setCalificaciones(actuales => ({ ...actuales, [calificacion.idSolicitud]: calificacion }))}
      />}
      <CancelarSolicitud key={solicitud.idSolicitud} solicitud={solicitud} onCancelada={(id, actualizada) => setSolicitud(actual => actualizada || { ...actual, estado: 'Cancelada', canceladaPor: 'paciente' })} />
    </>}
    {enfermero
      ? <Link className="button button-secondary" to="/solicitudes-enfermero">Volver a solicitudes</Link>
      : <Link className="button button-secondary" to="/mis-solicitudes">Volver a mis solicitudes</Link>}
    </section>
    {solicitud && CHAT_VISIBLE.includes(solicitud.estado) && (
      <ChatServicio
        key={solicitud.idSolicitud}
        solicitud={solicitud}
        contraparte={nombreOtraParte(solicitud)}
        whatsapp={enfermero
          ? (solicitud.estado === 'Aceptada'
            ? enlaceWhatsapp(solicitud.paciente?.telefono, mensajeWhatsappEnfermero(solicitud))
            : null)
          : whatsappParaPaciente(solicitud)}
        notaWhatsapp={enfermero ? '' : NOTA_WHATSAPP_PACIENTE}
        onEstadoCambiado={(actual) => setSolicitud(previa => ({ ...previa, ...actual }))}
      />
    )}
  </div>;
}
