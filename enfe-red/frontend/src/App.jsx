import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./components/Login";
import PerfilPaciente from "./components/PerfilPaciente";
import PerfilEnfermero from "./components/PerfilEnfermero";
import Register from "./components/Register";
import RecuperarPassword from "./components/RecuperarPassword";
import VerPerfiles from "./components/VerPerfiles";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/recuperar-password" element={<RecuperarPassword />} />
        <Route path="/perfil-paciente" element={<PerfilPaciente />} />
        <Route path="/perfil-enfermero" element={<PerfilEnfermero />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/perfil/:id" element={<VerPerfiles />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
