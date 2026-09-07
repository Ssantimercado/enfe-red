import React from 'react';
import { useNavigate } from 'react-router-dom';

const Home = () => {
  const navigate = useNavigate();

  // Función para destruir la sesión
  const handleLogout = () => {
    localStorage.removeItem('token'); // 1. Borramos el rastro del usuario
    navigate('/login'); // 2. Lo mandamos afuera
  };

  return (
    <div style={{ maxWidth: '600px', margin: '4rem auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: '#2c3e50' }}>Bienvenido a ENFE-RED</h1>
      <p style={{ color: '#7f8c8d', marginBottom: '2rem' }}>
        Panel principal de gestión de servicios.
      </p>

      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '30px' }}>
        <button 
          onClick={() => navigate('/perfil-paciente')}
          style={{ padding: '15px 30px', fontSize: '16px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Mi Perfil (Paciente)
        </button>

        <button 
          onClick={() => navigate('/perfil-enfermero')}
          style={{ padding: '15px 30px', fontSize: '16px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}
        >
          Mi Perfil (Enfermero)
        </button>
      </div>

      {/* Botón de Cerrar Sesión */}
      <button 
        onClick={handleLogout}
        style={{ padding: '10px 20px', fontSize: '14px', backgroundColor: 'transparent', color: '#e74c3c', border: '2px solid #e74c3c', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
      >
        Cerrar Sesión
      </button>
    </div>
  );
};

export default Home;