import { useEffect, useRef, useState } from 'react';
import { requestApi as api, sesionActual } from '../api';

// SCRUM-63 (Santiago): chat asociado a una solicitud. Contrato en backend/SPRINT5-INTEGRACION.md.
export const INTERVALO_CHAT_MS = 3000;
const MAX_CONTENIDO = 2000;

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

export default function ChatServicio({ solicitud, contraparte }) {
  const { idSolicitud, estado } = solicitud;
  const habilitado = estado === 'Aceptada';
  const userId = Number(sesionActual()?.sub);
  const [mensajes, setMensajes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState('');
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState('');
  const lista = useRef(null);
  const ocupado = useRef(false);

  useEffect(() => {
    let activo = true;
    let consultando = false;
    let controller = null;
    setMensajes([]);
    setCargando(true);
    setErrorCarga('');

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
        if (activo && err.name !== 'AbortError') setErrorCarga(err.message);
      } finally {
        consultando = false;
        if (activo) setCargando(false);
      }
    }

    consultar();
    // Una conversación cerrada ya no recibe mensajes: se consulta una sola vez.
    const timer = habilitado
      ? window.setInterval(() => consultar({ periodica: true }), INTERVALO_CHAT_MS)
      : null;
    return () => {
      activo = false;
      if (timer) window.clearInterval(timer);
      controller?.abort();
    };
  }, [idSolicitud, habilitado]);

  const ultimoId = mensajes.at(-1)?.idMensaje;
  useEffect(() => {
    // Desplaza solo el contenedor del chat, sin mover la página.
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [ultimoId]);

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
      setErrorEnvio(err.message);
    } finally {
      ocupado.current = false;
      setEnviando(false);
    }
  }

  const largo = texto.trim().length;
  const idAyuda = `chat-ayuda-${idSolicitud}`;

  return (
    <section className="content-panel chat-servicio" aria-labelledby={`chat-titulo-${idSolicitud}`}>
      <div className="panel-heading">
        <div>
          <h2 id={`chat-titulo-${idSolicitud}`}>Mensajes del servicio</h2>
          <p>
            {habilitado
              ? `Coordiná los detalles de la atención${contraparte ? ` con ${contraparte}` : ''}.`
              : 'La conversación quedó cerrada. Podés leer los mensajes anteriores.'}
          </p>
        </div>
      </div>

      {errorCarga && (
        <p className="notice notice-error" role="alert">
          {mensajes.length ? 'No pudimos actualizar los mensajes. Reintentamos en unos segundos.' : errorCarga}
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
          <p className="chat-vacio" role="status">Cargando mensajes…</p>
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

      {habilitado && (
        <form className="chat-formulario" onSubmit={enviar}>
          <label className="field">
            Escribí tu mensaje
            <textarea
              value={texto}
              maxLength={MAX_CONTENIDO}
              rows={2}
              aria-describedby={idAyuda}
              disabled={enviando}
              onChange={(event) => setTexto(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) enviar(event);
              }}
            />
          </label>
          <p id={idAyuda} className="filter-hint">
            Enter envía · Shift + Enter agrega una línea · {largo}/{MAX_CONTENIDO}
          </p>
          {errorEnvio && <p className="notice notice-error" role="alert">{errorEnvio}</p>}
          <button className="button button-primary" type="submit" disabled={enviando || !largo}>
            {enviando ? 'Enviando…' : 'Enviar mensaje'}
          </button>
        </form>
      )}
    </section>
  );
}
