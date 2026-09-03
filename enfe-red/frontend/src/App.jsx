import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login'; // Asegurate de que la ruta coincida con donde guardaste el archivo

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Si entran a la raíz del sitio, los mandamos automáticamente al login */}
        <Route path="/" element={<Navigate to="/login" />} />
        
        {/* La ruta oficial de tu pantalla de Login */}
        <Route path="/login" element={<Login />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;