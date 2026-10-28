import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import './Legal.css';

// Aviso informativo: no hay cookies de seguimiento, solo almacenamiento necesario para la sesión.
const CLAVE = 'avisoAlmacenamiento';
const VERSION = '1';

function yaVisto() {
  try {
    return localStorage.getItem(CLAVE) === VERSION;
  } catch {
    return false;
  }
}

export default function AvisoCookies() {
  const [visible, setVisible] = useState(() => !yaVisto());
  const aviso = useRef(null);
  // El aviso es fijo: se mide cuánto tapa desde abajo para reservar ese espacio y que el foco nunca quede debajo.
  useEffect(() => {
    const nodo = aviso.current;
    if (!nodo) return undefined;
    const raiz = document.documentElement;
    const medir = () => raiz.style.setProperty('--aviso-alto', `${Math.ceil(window.innerHeight - nodo.getBoundingClientRect().top)}px`);
    medir();
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(medir) : null;
    observador?.observe(nodo);
    window.addEventListener('resize', medir);
    return () => {
      observador?.disconnect();
      window.removeEventListener('resize', medir);
      raiz.style.removeProperty('--aviso-alto');
    };
  }, [visible]);
  if (!visible) return null;
  function aceptar() {
    try {
      localStorage.setItem(CLAVE, VERSION);
    } catch {
      // Si el navegador bloquea el almacenamiento, el aviso se cierra solo en esta visita.
    }
    setVisible(false);
  }
  return (
    <aside ref={aviso} className="aviso-cookies" role="region" aria-label="Aviso sobre cookies y almacenamiento">
      <p>
        Enfered no usa cookies publicitarias ni de seguimiento. Guardamos en tu navegador solo lo
        necesario para mantener tu sesión iniciada.{' '}
        <Link to="/privacidad">Conocé más en la Política de privacidad</Link>.
      </p>
      <button className="button button-primary" type="button" onClick={aceptar}>
        Entendido
      </button>
    </aside>
  );
}
