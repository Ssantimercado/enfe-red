import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { cerrarSesion, sesionActual } from './api';
import Login from "./components/Login";
import Home from "./components/Home";
import PerfilPaciente from "./components/PerfilPaciente";
import PerfilEnfermero from "./components/PerfilEnfermero";
import Register from "./components/Register";
import RecuperarPassword from "./components/RecuperarPassword";
import VerPerfiles from "./components/VerPerfiles";
import ListaEnfermeros from "./components/ListaEnfermeros";
import Navbar from "./components/Navbar";

function RutaProtegida({ children, rol }) {
  const [, actualizar] = useState(0);
  const location = useLocation();
  const sesion = sesionActual();
  const vencimiento = sesion?.exp;
  useEffect(() => {
    if (!vencimiento) {
      cerrarSesion();
      return;
    }
    const timer = window.setTimeout(() => actualizar((value) => value + 1),
      Math.min(vencimiento * 1000 - Date.now() + 100, 2147483647));
    return () => window.clearTimeout(timer);
  }, [vencimiento]);
  if (!sesion) return <Navigate to="/login?sesion=expirada" replace state={{ from: location.pathname + location.search }} />;
  if (rol && sesion.rol !== rol) return <Navigate to="/home" replace />;
  return children;
}

function App() {

  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        {/* RUTA RAÍZ: al abrir la aplicación siempre comenzamos en Login */}
        <Route 
          path="/" 
          element={<Navigate to={sesionActual() ? '/home' : '/login'} replace />}
        />
        
        {/* ==========================================
            RUTAS PÚBLICAS (No requieren sesión)
            ========================================== */}
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/recuperar-password" element={<RecuperarPassword />} />

        {/* ==========================================
            RUTAS PROTEGIDAS (Requieren sesión activa)
            ========================================== */}
        <Route 
          path="/home" 
          element={<RutaProtegida><Home /></RutaProtegida>}
        />
        <Route 
          path="/perfil-paciente" 
          element={<RutaProtegida rol="paciente"><PerfilPaciente /></RutaProtegida>}
        />
        <Route 
          path="/perfil-enfermero" 
          element={<RutaProtegida rol="enfermero"><PerfilEnfermero /></RutaProtegida>}
        />
        <Route 
          path="/perfil/:id" 
          element={<RutaProtegida><VerPerfiles /></RutaProtegida>}
        />
        <Route 
          path="/cartilla" 
          element={<RutaProtegida><ListaEnfermeros /></RutaProtegida>}
        />
        <Route path="*" element={<Navigate to={sesionActual() ? '/home' : '/login'} replace />} />
      </Routes>
      
    </BrowserRouter>
  );
}

export default App;
