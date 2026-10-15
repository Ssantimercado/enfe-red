import { useEffect, useState } from 'react';
import { cerrarSesion, sesionActual } from './api';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom';
import Login from './components/Login';
import Home from './components/Home';
import PerfilPaciente from './components/PerfilPaciente';
import PerfilEnfermero from './components/PerfilEnfermero';
import Register from './components/Register';
import RecuperarPassword from './components/RecuperarPassword';
import VerPerfiles from './components/VerPerfiles';
import ListaEnfermeros from './components/ListaEnfermeros';
import AppShell from './components/AppShell';
import Landing from './components/Landing';
import './App.css';

function EntryRoute() {
  return <Navigate to={sesionActual() ? '/home' : '/login'} replace />;
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (pathname === '/' && hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, hash]);
  return null;
}

function RutaProtegida({ children, rol }) {
  const [, update] = useState(0);
  const location = useLocation();
  const session = sesionActual();
  const expiration = session?.exp;
  useEffect(() => {
    if (!expiration) {
      cerrarSesion();
      return;
    }
    const timer = window.setTimeout(
      () => update((value) => value + 1),
      Math.min(expiration * 1000 - Date.now() + 100, 2147483647),
    );
    return () => window.clearTimeout(timer);
  }, [expiration]);
  if (!session)
    return (
      <Navigate
        to="/login?sesion=expirada"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  if (rol && session.rol !== rol) return <Navigate to="/home" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/recuperar-password" element={<RecuperarPassword />} />
        <Route
          element={
            <RutaProtegida>
              <AppShell />
            </RutaProtegida>
          }
        >
          <Route path="/home" element={<Home />} />
          <Route
            path="/perfil-paciente"
            element={
              <RutaProtegida rol="paciente">
                <PerfilPaciente />
              </RutaProtegida>
            }
          />
          <Route
            path="/perfil-enfermero"
            element={
              <RutaProtegida rol="enfermero">
                <PerfilEnfermero />
              </RutaProtegida>
            }
          />
          <Route path="/perfil/:id" element={<VerPerfiles />} />
          <Route path="/cartilla" element={<ListaEnfermeros />} />
        </Route>
        <Route path="*" element={<EntryRoute />} />
      </Routes>
    </BrowserRouter>
  );
}
