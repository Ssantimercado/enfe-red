import { Link } from 'react-router-dom';
export default function Brand({ to = '/home' }) {
  return (
    <Link className="brand" to={to} aria-label="Enfe-red, inicio">
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span>
        Enfe<span className="brand-light">red</span>
        <span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
