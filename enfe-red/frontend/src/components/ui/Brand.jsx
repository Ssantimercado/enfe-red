import { Link } from 'react-router-dom';
export default function Brand({ to = '/home' }) {
  return (
    <Link className="brand" to={to} aria-label="Enfe-Red, inicio">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      {/* Mismo nombre que en el documento del proyecto: Enfe-Red. */}
      <span>
        Enfe-<span className="brand-light">Red</span>
      </span>
    </Link>
  );
}
