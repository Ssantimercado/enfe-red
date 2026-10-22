import { Link } from 'react-router-dom';
import './Navbar.css';

export default function Navbar() {
  return (
    <header className="enfe-navbar">
      <nav aria-label="Navegación principal">
        <Link className="enfe-navbar__brand" to="/" aria-label="Enfered, inicio">
          ENFE<span>-RED</span>
        </Link>
      </nav>
    </header>
  );
}
