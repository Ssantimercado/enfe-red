import {
  Link,
  NavLink,
  Outlet,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { cerrarSesion, sesionActual } from '../api';
import Brand from './ui/Brand';
import Icon from './ui/Icon';
import Notificaciones from './Notificaciones';
export default function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = sesionActual();
  const admin = session?.rol === 'administrador';
  const nurse = session?.rol === 'enfermero';
  const profile = nurse ? '/perfil-enfermero' : '/perfil-paciente';
  function logout() {
    cerrarSesion();
    navigate('/login', { replace: true });
  }
  return (
    <div className={`app-shell ${admin ? 'admin-shell' : ''}`}>
      <a className="skip-link" href="#contenido">
        Ir al contenido
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav className="main-nav" aria-label="Navegación principal">
            {admin ? (
              <>
                <NavLink to="/admin">
                  <Icon name="home" size={18} />
                  Panel
                </NavLink>
                <NavLink to="/admin/usuarios">
                  <Icon name="user" size={18} />
                  Usuarios
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/home">
                  <Icon name="home" size={18} />
                  Inicio
                </NavLink>
                <NavLink
                  to="/cartilla"
                  className={({ isActive }) =>
                    isActive || location.pathname.startsWith('/perfil/')
                      ? 'active'
                      : undefined
                  }
                >
                  <Icon name="search" size={18} />
                  <span className="nav-long-label">
                    {nurse ? 'Pacientes asignados' : 'Buscar profesionales'}
                  </span>
                  <span className="nav-short-label">
                    {nurse ? 'Pacientes' : 'Buscar'}
                  </span>
                </NavLink>
                <NavLink to={profile}>
                  <Icon name="user" size={18} />
                  Mi perfil
                </NavLink>
              </>
            )}
          </nav>
          <div className="account-actions">
            {!admin && (
              <>
                <Link
                  className="button button-secondary nurse-requests-link"
                  to={nurse ? '/solicitudes-enfermero' : '/mis-solicitudes'}
                  aria-label={nurse ? 'Ver solicitudes recibidas' : 'Ver mis solicitudes'}
                >
                  <Icon name="briefcase" size={17} />
                  <span className="nurse-requests-label">{nurse ? 'Solicitudes' : 'Mis solicitudes'}</span>
                </Link>
                <Notificaciones userId={Number(session?.sub)} />
              </>
            )}
            <Link className="account-link" to={admin ? '/admin' : profile}>
              <span className="account-avatar">
                <Icon name="user" size={18} />
              </span>
              <span>{admin ? 'Administración' : nurse ? 'Profesional' : 'Mi cuenta'}</span>
            </Link>
            <button
              className="icon-button logout-button"
              onClick={logout}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
            >
              <Icon name="logout" size={19} />
            </button>
          </div>
        </div>
      </header>
      <main id="contenido" className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <Brand />
        <p>Enfermería a domicilio, cerca de vos.</p>
        <span>Hecho para cuidar.</span>
      </footer>
    </div>
  );
}
