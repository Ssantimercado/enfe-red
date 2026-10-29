import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { errorSolicitud, guardarUbicacionAtencion } from '../services/solicitudes';

const LocationPicker = lazy(() => import('./LocationPicker'));

// HU16: el paciente marca o corrige en el mapa el lugar de atención de un turno en curso
// (por ejemplo, un pedido anterior a la ubicación obligatoria). El enfermero lo ve enseguida.
export default function LugarAtencionPaciente({ solicitud, onActualizada }) {
  const actual = solicitud.ubicacionAtencion;
  const [abierto, setAbierto] = useState(false);
  const [punto, setPunto] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [listo, setListo] = useState('');
  const id = `lugar-${solicitud.idSolicitud}`;
  // Al abrir, el botón se reemplaza por el mapa (y al cerrar, al revés): el foco acompaña el cambio.
  const moverFoco = useRef(false);
  const editor = useRef(null);
  const boton = useRef(null);
  const avisoListo = useRef(null);
  useEffect(() => {
    if (!moverFoco.current) return;
    moverFoco.current = false;
    if (abierto) editor.current?.focus();
    else (avisoListo.current || boton.current)?.focus();
  }, [abierto]);

  function abrir() {
    setPunto(actual ? { lat: actual.latitud, lng: actual.longitud } : null);
    setError('');
    setListo('');
    moverFoco.current = true;
    setAbierto(true);
  }

  function cerrar() {
    moverFoco.current = true;
    setAbierto(false);
  }

  async function guardar() {
    if (guardando) return;
    if (!punto) {
      setError('Tocá el mapa o usá tu ubicación actual para marcar el lugar.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const respuesta = await guardarUbicacionAtencion(solicitud.idSolicitud, punto.lat, punto.lng);
      cerrar();
      setListo('Listo, el profesional ya puede ver el lugar en el mapa.');
      if (respuesta?.solicitud) onActualizada?.(respuesta.solicitud);
    } catch (err) {
      setError(errorSolicitud(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="lugar-atencion-paciente">
      {!actual && !abierto && (
        <p className="notice notice-info">
          Este pedido no tiene el lugar marcado en el mapa. Marcalo para que el profesional sepa cómo llegar.
        </p>
      )}
      {listo && <p ref={avisoListo} tabIndex={-1} className="notice notice-success" role="status">{listo}</p>}
      {!abierto ? (
        <div className="solicitud-card-actions">
          <button
            ref={boton}
            className={`button ${actual ? 'button-secondary' : 'button-primary'}`}
            type="button"
            aria-expanded="false"
            aria-controls={id}
            onClick={abrir}
          >
            {actual ? 'Cambiar el lugar de atención' : 'Marcar el lugar en el mapa'}
          </button>
        </div>
      ) : (
        <div id={id} ref={editor} tabIndex={-1} className="lugar-atencion-editor" aria-label="Marcar el lugar de atención">
          <Suspense fallback={<p role="status">Cargando mapa…</p>}>
            <LocationPicker
              latitude={punto?.lat}
              longitude={punto?.lng}
              conMiUbicacion
              helpText="Tocá el mapa en el lugar exacto donde te atienden, o usá tu ubicación actual si estás ahí."
              onChange={(lat, lng) => { if (!guardando) setPunto({ lat, lng }); }}
            />
          </Suspense>
          {error && <p className="notice notice-error" role="alert">{error}</p>}
          <div className="solicitud-card-actions">
            <button className="button button-primary" type="button" aria-disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar lugar'}
            </button>
            <button className="button button-secondary" type="button" disabled={guardando} onClick={cerrar}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
