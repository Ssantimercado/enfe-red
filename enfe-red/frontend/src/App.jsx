import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./components/Login";
import Home from "./components/Home";
import PerfilPaciente from "./components/PerfilPaciente";
import PerfilEnfermero from "./components/PerfilEnfermero";
import Register from "./components/Register";
import RecuperarPassword from "./components/RecuperarPassword";
import VerPerfiles from "./components/VerPerfiles";
import ListaEnfermeros from "./components/ListaEnfermeros";

function App() {
  // Verificamos si existe el token en el almacenamiento del navegador
  const tieneToken = () => {
    return localStorage.getItem('token') !== null;
  };

  return (
    <BrowserRouter>
      <Routes>
        {/* RUTA RAÍZ: Si hay token va al Home, si no, va al Login */}
        <Route 
          path="/" 
          element={tieneToken() ? <Navigate to="/home" /> : <Navigate to="/login" />} 
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
          element={tieneToken() ? <Home /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/perfil-paciente" 
          element={tieneToken() ? <PerfilPaciente /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/perfil-enfermero" 
          element={tieneToken() ? <PerfilEnfermero /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/perfil/:id" 
          element={tieneToken() ? <VerPerfiles /> : <Navigate to="/login" />} 
        />
        <Route 
          path="/cartilla" 
          element={tieneToken() ? <ListaEnfermeros /> : <Navigate to="/login" />} 
        />
      </Routes>
      
    </BrowserRouter>
  );
}

export default App;