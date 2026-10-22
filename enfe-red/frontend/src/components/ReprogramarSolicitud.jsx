import { useEffect, useRef, useState } from 'react';
import { reprogramarSolicitud, errorSolicitud } from '../services/solicitudes';
import { fechaLegible, fechaMaximaISO, hoyISO, momentoDelTurno, turnoFuturo } from '../fechas';
import './Solicitudes.css';

// El paciente cambia el día o la hora de un turno que todavía no empezó.
// El backend vuelve a revisar la agenda del profesional y deja el pedido Pendiente.
export default function ReprogramarSolicitud({ solicitud, onReprogramada }) {
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState('');

  if (!['Pendiente', 'Aceptada'].includes(solicitud.estado) || !turnoFuturo(solicitud)) {
    return aviso ? <p className="notice notice-success solicitud-aviso" role="status">{aviso}</p> : null;
  }

  return (
    <div className="solicitud-reprogramar">
      {aviso && <p className="notice notice-success solicitud-aviso" role="status">{aviso}</p>}
      <button type="button" className="button button-secondary" onClick={() => { setAviso(''); setAbierto(true); }}>
        Reprogramar
      </button>
      {abierto && (
        <DialogoReprogramar
          solicitud={solicitud}
          onCerrar={() => setAbierto(false)}
          onReprogramada={(actualizada) => {
            setAbierto(false);
            setAviso(`Listo: pediste el turno para el ${fechaLegible(actualizada.fecha, actualizada.hora)}. El profesional tiene que confirmarlo.`);
            onReprogramada?.(actualizada);
          }}
        />
      )}
    </div>
  );
}

// Como ModalCalificacion, se monta al abrirse: cada vez empieza con el horario actual del turno.
function DialogoReprogramar({ solicitud, onCerrar, onReprogramada }) {
  const dialog = useRef(null);
  const campoFecha = useRef(null);
  const ocupado = useRef(false);
  const [datos, setDatos] = useState({ fecha: solicitud.fecha, hora: solicitud.hora });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const idTitulo = `reprogramar-${solicitud.idSolicitud}-titulo`;

  useEffect(() => {
    const actual = dialog.current;
    actual.showModal();
    campoFecha.current?.focus();
    return () => actual.close();
  }, []);

  function cerrar() {
    if (!ocupado.current) onCerrar();
  }

  async function guardar(event) {
    event.preventDefault();
    if (ocupado.current) return;
    const momento = momentoDelTurno(datos);
    if (!momento || momento <= new Date()) { setError('Elegí una fecha y hora futuras.'); return; }
    if (datos.fecha === solicitud.fecha && datos.hora === solicitud.hora) {
      setError('Elegí una fecha u hora distinta a la del turno actual.');
      return;
    }
    ocupado.current = true;
    setEnviando(true);
    setError('');
    try {
      const resultado = await reprogramarSolicitud(solicitud.idSolicitud, datos);
      const actualizada = resultado.solicitud;
      if (!actualizada?.idSolicitud) throw new Error('No pudimos confirmar el cambio. Revisá tus solicitudes.');
      onReprogramada(actualizada);
    } catch (err) {
      // Los errores de axios traen code; el resto es un Error propio con su texto.
      setError(err.response || err.code ? errorSolicitud(err) : err.message);
    } finally {
      ocupado.current = false;
      setEnviando(false);
    }
  }

  const cambiar = (event) => setDatos((actual) => ({ ...actual, [event.target.name]: event.target.value }));

  return (
    <dialog
      className="content-panel solicitud-dialogo"
      ref={dialog}
      aria-labelledby={idTitulo}
      onCancel={(event) => {
        // Escape cierra el diálogo salvo durante el envío.
        event.preventDefault();
        cerrar();
      }}
    >
      <form className="form-stack" onSubmit={guardar} aria-busy={enviando}>
        <div>
          <h2 id={idTitulo}>Cambiar día u hora</h2>
          <p>Ahora está pedido para el {fechaLegible(solicitud.fecha, solicitud.hora)}.</p>
          {solicitud.estado === 'Aceptada' && (
            <p className="notice notice-info">
              El profesional va a tener que confirmar el nuevo horario. Hasta que lo haga, el turno queda pendiente.
            </p>
          )}
        </div>
        <label className="field">
          Nueva fecha
          <input
            ref={campoFecha}
            type="date"
            name="fecha"
            lang="es-AR"
            min={hoyISO()}
            max={fechaMaximaISO()}
            required
            value={datos.fecha}
            onChange={cambiar}
            disabled={enviando}
          />
          {datos.fecha && <span className="field-hint">{fechaLegible(datos.fecha)}</span>}
        </label>
        <label className="field">
          Nueva hora
          <input type="time" name="hora" required value={datos.hora} onChange={cambiar} disabled={enviando} />
        </label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="solicitud-card-actions">
          <button className="button button-secondary" type="button" disabled={enviando} onClick={cerrar}>Volver</button>
          <button className="button button-primary" type="submit" disabled={enviando}>
            {enviando ? 'Guardando…' : 'Guardar nuevo horario'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
