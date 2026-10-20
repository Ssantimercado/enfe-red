import { useState } from 'react';
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
    <aside className="aviso-cookies" role="region" aria-label="Aviso sobre cookies y almacenamiento">
      <p>
        Enfe-red no usa cookies publicitarias ni de seguimiento. Guardamos en tu navegador solo lo
        necesario para mantener tu sesión iniciada.{' '}
        <Link to="/privacidad">Conocé más en la Política de privacidad</Link>.
      </p>
      <button className="button button-primary" type="button" onClick={aceptar}>
        Entendido
      </button>
    </aside>
  );
}
