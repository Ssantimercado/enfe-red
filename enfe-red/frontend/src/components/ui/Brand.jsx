import { Link } from 'react-router-dom';
export default function Brand({ to = '/home' }) {
  return (
    <Link className="brand" to={to} aria-label="Enfered, inicio">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      {/* Logotipo "Enfered." de la marca Enfered. */}
      <span>
        Enfe<span className="brand-light">red</span>
        <span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
