import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  cerrarSesion,
  puedeRenovarSesion,
  registrarNavegacion,
  renovarSesion,
  rutaDeLogin,
  sesionActual,
} from './api';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import Login from './components/Login';
import Home from './components/Home';
import Register from './components/Register';
import RecuperarPassword from './components/RecuperarPassword';
import AppShell from './components/AppShell';
import Landing from './components/Landing';
import AvisoCookies from './components/AvisoCookies';
import CargaPantalla from './components/ui/CargaPantalla';
import './App.css';

// Carga por partes: el código de estas pantallas se descarga recién cuando se abren,
// así la primera vista llega antes en celulares con poca señal.
const PerfilPaciente = lazy(() => import('./components/PerfilPaciente'));
const PerfilEnfermero = lazy(() => import('./components/PerfilEnfermero'));
const VerPerfiles = lazy(() => import('./components/VerPerfiles'));
const ListaEnfermeros = lazy(() => import('./components/ListaEnfermeros'));
const SolicitarServicio = lazy(() => import('./components/SolicitarServicio'));
const ConfirmacionSolicitud = lazy(() => import('./components/ConfirmacionSolicitud'));
const SolicitudesEnfermero = lazy(() => import('./components/SolicitudesEnfermero'));
const EstadoSolicitudes = lazy(() => import('./components/EstadoSolicitudes'));
const AdminUsuarios = lazy(() => import('./components/AdminUsuarios'));
const PanelAdmin = lazy(() => import('./components/PanelAdmin'));
const AdminResenas = lazy(() => import('./components/AdminResenas'));
const AdminAuditoria = lazy(() => import('./components/AdminAuditoria'));
const Privacidad = lazy(() => import('./components/Legal').then((m) => ({ default: m.Privacidad })));
const Terminos = lazy(() => import('./components/Legal').then((m) => ({ default: m.Terminos })));

const TITULO_INICIAL = 'Enfered · Cuidado cerca de vos';
const TITULOS = [
  [/^\/login$/, 'Iniciar sesión'],
  [/^\/registro$/, 'Crear cuenta'],
  [/^\/recuperar-password$/, 'Recuperar contraseña'],
  [/^\/terminos$/, 'Términos y condiciones'],
  [/^\/privacidad$/, 'Política de privacidad'],
  [/^\/home$/, 'Inicio'],
  [/^\/cartilla$/, 'Cartilla'],
  [/^\/perfil\/[^/]+\/solicitar$/, 'Pedir un turno'],
  [/^\/perfil\/[^/]+$/, 'Perfil del profesional'],
  [/^\/solicitudes\/[^/]+$/, 'Comprobante de solicitud'],
  [/^\/solicitudes-enfermero$/, 'Solicitudes recibidas'],
  [/^\/mis-solicitudes$/, 'Mis solicitudes'],
  [/^\/perfil-paciente$/, 'Mi perfil'],
  [/^\/perfil-enfermero$/, 'Mi perfil profesional'],
  [/^\/admin$/, 'Panel de administración'],
  [/^\/admin\/usuarios$/, 'Usuarios'],
  [/^\/admin\/resenas$/, 'Moderación de reseñas'],
  [/^\/admin\/auditoria$/, 'Auditoría'],
];

function EntryRoute() {
  const session = sesionActual();
  return (
    <Navigate
      to={session ? (session.rol === 'administrador' ? '/admin' : '/home') : '/login'}
      replace
    />
  );
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const target = () => document.getElementById(hash.slice(1));
      const scroll = () => target()?.scrollIntoView({ block: 'start' });
      if (target()) {
        scroll();
        return;
      }
      // El perfil carga sus secciones después de consultar la API.
      const observer = new window.MutationObserver(() => {
        if (target()) {
          scroll();
          observer.disconnect();
        }
      });
      observer.observe(document.getElementById('root'), {
        childList: true,
        subtree: true,
      });
      return () => observer.disconnect();
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, hash]);
  return null;
}

function enfocar(elemento) {
  if (!elemento) return false;
  if (!elemento.hasAttribute('tabindex')) elemento.setAttribute('tabindex', '-1');
  elemento.focus({ preventScroll: true });
  return true;
}

// Título de la pestaña por pantalla y, al navegar, foco en el título para que el lector
// de pantalla anuncie la página nueva en lugar de quedarse en el enlace tocado.
function TituloYFoco() {
  const { pathname, hash } = useLocation();
  const primeraVista = useRef(true);
  useEffect(() => {
    const titulo = TITULOS.find(([patron]) => patron.test(pathname))?.[1];
    document.title = titulo ? `${titulo} · Enfered` : TITULO_INICIAL;
    if (primeraVista.current) {
      primeraVista.current = false;
      return undefined;
    }
    if (hash) return undefined;
    const buscarTitulo = () => document.querySelector('#contenido h1') || document.querySelector('h1');
    if (enfocar(buscarTitulo())) return undefined;
    // Las pantallas por partes o que consultan la API muestran el título un momento después.
    const observer = new window.MutationObserver(() => {
      if (enfocar(buscarTitulo())) observer.disconnect();
    });
    observer.observe(document.getElementById('root'), { childList: true, subtree: true });
    const espera = window.setTimeout(() => {
      observer.disconnect();
      enfocar(document.getElementById('contenido'));
    }, 2000);
    return () => {
      observer.disconnect();
      window.clearTimeout(espera);
    };
  }, [pathname, hash]);
  return null;
}

// Un 401 en cualquier pedido vuelve al login con la navegación del router, sin recargar.
function ConectarSesion() {
  const navigate = useNavigate();
  useEffect(() => {
    registrarNavegacion((destino) => navigate(destino, { replace: true }));
    return () => registrarNavegacion(null);
  }, [navigate]);
  return null;
}

function RutaProtegida({ children, rol }) {
  const [, update] = useState(0);
  const [fallo, setFallo] = useState(null);
  const location = useLocation();
  const session = sesionActual();
  const expiration = session?.exp;
  const renovable = !session && !fallo && puedeRenovarSesion();
  useEffect(() => {
    if (!expiration) {
      if (fallo !== 'sinConexion' && !puedeRenovarSesion()) cerrarSesion();
      return undefined;
    }
    const restante = expiration * 1000 - Date.now();
    // Un minuto antes de vencer se renueva en segundo plano, sin desmontar la pantalla.
    const renovacion = restante > 60000 && puedeRenovarSesion()
      ? window.setTimeout(
        () => renovarSesion().then((r) => r.ok && update((value) => value + 1)),
        Math.min(restante - 60000, 2147483647),
      )
      : null;
    const timer = window.setTimeout(
      () => update((value) => value + 1),
      Math.min(restante + 100, 2147483647),
    );
    return () => {
      window.clearTimeout(renovacion);
      window.clearTimeout(timer);
    };
  }, [expiration, fallo]);
  useEffect(() => {
    if (!renovable) return undefined;
    let activo = true;
    renovarSesion().then((resultado) => {
      if (!activo) return;
      if (resultado.ok) update((value) => value + 1);
      else if (resultado.sinConexion) setFallo('sinConexion');
      else {
        cerrarSesion();
        setFallo(/no está activa/i.test(resultado.mensaje || '') ? 'suspendida' : 'expirada');
      }
    });
    return () => {
      activo = false;
    };
  }, [renovable]);
  if (!session && renovable) return <CargaPantalla texto="Recuperando tu sesión…" />;
  if (!session && fallo === 'sinConexion')
    return (
      <div className="carga-pantalla" role="alert">
        <p>No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.</p>
        <button className="button button-primary" type="button" onClick={() => setFallo(null)}>
          Reintentar
        </button>
      </div>
    );
  if (!session)
    return (
      <Navigate
        to={rutaDeLogin(fallo === 'suspendida' ? 'suspendida' : 'expirada', location.pathname + location.search)}
        replace
      />
    );
  if (rol && session.rol !== rol) {
    return <Navigate to={session.rol === 'administrador' ? '/admin' : '/home'} replace />;
  }
  if (!rol && session.rol === 'administrador') return <Navigate to="/admin" replace />;
  return children;
}

function RutaProtegidaAdmin({ children }) {
  return <RutaProtegida rol="administrador">{children}</RutaProtegida>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <TituloYFoco />
      <ConectarSesion />
      <Suspense fallback={<CargaPantalla />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/registro" element={<Register />} />
          <Route path="/recuperar-password" element={<RecuperarPassword />} />
          <Route path="/terminos" element={<Terminos />} />
          <Route path="/privacidad" element={<Privacidad />} />
          <Route
            element={
              <RutaProtegida>
                <AppShell />
              </RutaProtegida>
            }
          >
            <Route path="/home" element={<Home />} />
            <Route path="/perfil/:id/solicitar" element={<RutaProtegida rol="paciente"><SolicitarServicio /></RutaProtegida>} />
            <Route path="/solicitudes/:idSolicitud" element={<ConfirmacionSolicitud />} />
            <Route path="/solicitudes-enfermero" element={<RutaProtegida rol="enfermero"><SolicitudesEnfermero /></RutaProtegida>} />
            <Route path="/mis-solicitudes" element={<RutaProtegida rol="paciente"><EstadoSolicitudes /></RutaProtegida>} />
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
          <Route
            element={
              <RutaProtegidaAdmin>
                <AppShell />
              </RutaProtegidaAdmin>
            }
          >
            <Route path="/admin" element={<PanelAdmin />} />
            <Route path="/admin/usuarios" element={<AdminUsuarios />} />
            <Route path="/admin/resenas" element={<AdminResenas />} />
            <Route path="/admin/auditoria" element={<AdminAuditoria />} />
          </Route>
          <Route path="*" element={<EntryRoute />} />
        </Routes>
      </Suspense>
      <AvisoCookies />
    </BrowserRouter>
  );
}
