import { useEffect, useRef, useState } from 'react';
import { requestApi as api, sesionActual } from '../api';

// SCRUM-63 (Santiago): chat asociado a una solicitud. Contrato en backend/SPRINT5-INTEGRACION.md.
export const INTERVALO_CHAT_MS = 3000;
const MAX_CONTENIDO = 2000;
// Se puede escribir desde que el paciente pide el turno hasta que el servicio se cierra.
export const CHAT_ABIERTO = ['Pendiente', 'Aceptada'];
// Cerrada la conversación, queda como registro de lectura.
export const CHAT_VISIBLE = [...CHAT_ABIERTO, 'Realizada', 'Cancelada', 'Rechazada', 'Vencida'];
// Sin permiso o sin solicitud no tiene sentido seguir consultando.
const ERRORES_PERMANENTES = [403, 404];

function horaLocal(fechaHora) {
  const fecha = new Date(fechaHora);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Une los mensajes nuevos sin duplicar los que ya estaban (polling y envío propio).
function unirMensajes(actuales, nuevos) {
  const porId = new Map(actuales.map((mensaje) => [mensaje.idMensaje, mensaje]));
  nuevos.forEach((mensaje) => porId.set(mensaje.idMensaje, mensaje));
  return [...porId.values()].sort((a, b) => a.idMensaje - b.idMensaje);
}

// En pantallas táctiles Enter agrega una línea; se envía con el botón.
const pantallaTactil = () => window.matchMedia?.('(pointer: coarse)').matches ?? false;

// whatsapp: enlace para seguir la charla por fuera; notaWhatsapp: qué decir cuando todavía no hay enlace.
// nivelTitulo: 2 en el comprobante; 4 dentro de una tarjeta que ya tiene su h3.
export default function ChatServicio({
  solicitud, contraparte, onEstadoCambiado, whatsapp = null, notaWhatsapp = '', nivelTitulo = 2,
}) {
  const Titulo = `h${nivelTitulo}`;
  const { idSolicitud } = solicitud;
  const [estado, setEstado] = useState(solicitud.estado);
  const habilitado = CHAT_ABIERTO.includes(estado);
  const userId = Number(sesionActual()?.sub);
  const [mensajes, setMensajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [bloqueado, setBloqueado] = useState(false);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const lista = useRef(null);
  const avisoCierre = useRef(null);
  const campo = useRef(null);
  const ocupado = useRef(false);
  const tactil = pantallaTactil();

  useEffect(() => {
    setEstado(solicitud.estado);
  }, [solicitud.estado]);

  useEffect(() => {
    if (bloqueado) return undefined;
    let activo = true;
    let consultando = false;
    let controller = null;
    let timer = null;

    async function consultar({ periodica = false } = {}) {
      // Con la pestaña oculta se pausa el polling; la carga inicial siempre consulta.
      if (consultando || (periodica && document.hidden)) return;
      consultando = true;
      controller = new AbortController();
      try {
        const items = await api(`/solicitudes/${idSolicitud}/mensajes`, { signal: controller.signal });
        if (!Array.isArray(items)) throw new Error('La respuesta de mensajes no es válida.');
        if (!activo) return;
        setMensajes((actuales) => unirMensajes(actuales, items));
        setErrorCarga('');
      } catch (err) {
        if (!activo || err.name === 'AbortError') return;
        setErrorCarga(err.message);
        if (ERRORES_PERMANENTES.includes(err.status)) {
          window.clearInterval(timer);
          setBloqueado(true);
        }
      } finally {
        consultando = false;
        if (activo) setCargando(false);
      }
    }

    consultar();
    // Una conversación cerrada ya no recibe mensajes: se consulta una sola vez.
    if (habilitado) {
      timer = window.setInterval(() => consultar({ periodica: true }), INTERVALO_CHAT_MS);
    }
    return () => {
      activo = false;
      window.clearInterval(timer);
      controller?.abort();
    };
  }, [idSolicitud, habilitado, bloqueado]);

  // Si la conversación se cerró al enviar, el campo desaparece: el foco va al aviso que lo explica.
  useEffect(() => {
    if (!habilitado && errorEnvio) avisoCierre.current?.focus();
  }, [habilitado, errorEnvio]);

  const ultimoId = mensajes.at(-1)?.idMensaje;
  useEffect(() => {
    // Desplaza solo el contenedor del chat, sin mover la página.
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [ultimoId]);

  // Si el envío choca con un cambio de estado (409), se consulta el estado real y se cierra el chat.
  async function revisarEstado() {
    try {
      const actual = await api(`/solicitudes/${idSolicitud}`);
      if (actual?.estado && !CHAT_ABIERTO.includes(actual.estado)) {
        setEstado(actual.estado);
        onEstadoCambiado?.(actual);
        return actual.estado;
      }
    } catch {
      // Se conserva el error original del envío.
    }
    return null;
  }

  async function enviar(event) {
    event.preventDefault();
    const contenido = texto.trim();
    if (ocupado.current || !habilitado || !contenido || contenido.length > MAX_CONTENIDO) return;
    ocupado.current = true;
    setEnviando(true);
    setErrorEnvio('');
    try {
      const mensaje = await api(`/solicitudes/${idSolicitud}/mensajes`, {
        method: 'POST',
        body: { contenido },
      });
      if (!mensaje?.idMensaje) throw new Error('El servidor no devolvió el mensaje enviado.');
      setMensajes((actuales) => unirMensajes(actuales, [mensaje]));
      setTexto('');
    } catch (err) {
      const nuevoEstado = err.status === 409 ? await revisarEstado() : null;
      setErrorEnvio(nuevoEstado
        ? `La solicitud pasó a ${nuevoEstado}: la conversación se cerró y tu mensaje no se envió.`
        : err.message);
    } finally {
      ocupado.current = false;
      setEnviando(false);
      campo.current?.focus();
    }
  }

  const largo = texto.trim().length;
  const idAyuda = `chat-ayuda-${idSolicitud}`;

  return (
    <section id={`chat-${idSolicitud}`} className="content-panel chat-servicio" aria-labelledby={`chat-titulo-${idSolicitud}`}>
      <div className="panel-heading">
        <div>
          <Titulo id={`chat-titulo-${idSolicitud}`}>Mensajes del servicio</Titulo>
          <p>
            {habilitado
              ? `Coordiná los detalles de la atención${contraparte ? ` con ${contraparte}` : ''}.`
              : 'La conversación quedó cerrada. Podés leer los mensajes anteriores.'}
          </p>
        </div>
      </div>

      {errorCarga && (
        <p className="notice notice-error" role="alert">
          {mensajes.length && !bloqueado
            ? 'No pudimos actualizar los mensajes. Reintentamos en unos segundos.'
            : errorCarga}
        </p>
      )}

      <div
        className="chat-mensajes"
        ref={lista}
        role="log"
        aria-live="polite"
        aria-busy={cargando}
        aria-label="Historial de mensajes"
        tabIndex={0}
      >
        {cargando && !mensajes.length ? (
          <p className="chat-vacio">Cargando mensajes…</p>
        ) : mensajes.length ? (
          mensajes.map((mensaje) => {
            const propio = mensaje.idEmisor === userId;
            return (
              <article
                key={mensaje.idMensaje}
                className={`chat-mensaje ${propio ? 'propio' : 'recibido'}`}
              >
                <span className="sr-only">{propio ? 'Vos' : contraparte || 'La otra persona'}: </span>
                <p>{mensaje.contenido}</p>
                <time dateTime={mensaje.fechaHora}>{horaLocal(mensaje.fechaHora)}</time>
              </article>
            );
          })
        ) : (
          !errorCarga && (
            <p className="chat-vacio">
              {habilitado ? 'Todavía no hay mensajes. Escribí el primero.' : 'No hubo mensajes en este servicio.'}
            </p>
          )
        )}
      </div>

      {errorEnvio && !habilitado && (
        <p ref={avisoCierre} tabIndex={-1} className="notice notice-error" role="alert">{errorEnvio}</p>
      )}

      {habilitado && !bloqueado && (
        <form className="chat-formulario" onSubmit={enviar}>
          <label className="field">
            Escribí tu mensaje
            <textarea
              ref={campo}
              value={texto}
              maxLength={MAX_CONTENIDO}
              rows={2}
              aria-describedby={idAyuda}
              // readOnly y no disabled: deshabilitar el campo le quitaría el foco.
              readOnly={enviando}
              aria-busy={enviando}
              onChange={(event) => setTexto(event.target.value)}
              onKeyDown={(event) => {
                // No enviar mientras se compone un acento o texto con IME.
                if (event.nativeEvent.isComposing || tactil) return;
                if (event.key === 'Enter' && !event.shiftKey) enviar(event);
              }}
            />
          </label>
          <p id={idAyuda} className="filter-hint">
            {tactil ? '' : 'Enter envía · Shift + Enter agrega una línea · '}
            {largo}/{MAX_CONTENIDO}
          </p>
          {errorEnvio && <p className="notice notice-error" role="alert">{errorEnvio}</p>}
          <button className="button button-primary" type="submit" disabled={enviando || !largo}>
            {enviando ? 'Enviando…' : 'Enviar mensaje'}
          </button>
        </form>
      )}

      {habilitado && (whatsapp ? (
        <p className="chat-whatsapp">
          Si te resulta más cómodo, también podés escribirle por WhatsApp.{' '}
          <a className="button button-secondary" href={whatsapp} target="_blank" rel="noopener noreferrer">
            Seguir por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        </p>
      ) : notaWhatsapp && <p className="filter-hint chat-whatsapp">{notaWhatsapp}</p>)}
    </section>
  );
}
