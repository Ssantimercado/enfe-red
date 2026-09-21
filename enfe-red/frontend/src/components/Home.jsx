import React from 'react';
import { useNavigate } from 'react-router-dom';

const Home = () => {
  const navigate = useNavigate();

  // Leemos el rol que guardamos en el navegador. 
  // (Si por algún motivo no lo encuentra, lo toma como 'paciente' por precaución)
  const rolUsuario = localStorage.getItem('rol') || 'paciente';

  const handleLogout = () => {
    localStorage.removeItem('token'); 
    localStorage.removeItem('rol'); // También borramos el rol al salir
    navigate('/login'); 
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      {/* Tarjeta Principal */}
      <div style={{ width: '100%', maxWidth: '500px', backgroundColor: '#ffffff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)', textAlign: 'center' }}>
        
        {/* Cabecera */}
        <div style={{ marginBottom: '35px' }}>
          <h1 style={{ color: '#2c3e50', fontSize: '32px', margin: '0 0 10px 0', fontWeight: '800' }}>
            Panel <span style={{ color: '#3498db' }}>Principal</span>
          </h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>
            Gestioná tus servicios de enfermería a domicilio
          </p>
        </div>

        {/* Contenedor de Botones Dinámicos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '35px' }}>
          
          {/* ==========================================
              VISTA PARA EL PACIENTE
              ========================================== */}
          {rolUsuario.toLowerCase() === 'paciente' && (
            <>
              <button 
                onClick={() => navigate('/perfil-paciente')}
                style={{ width: '100%', padding: '16px', fontSize: '16px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(52, 152, 219, 0.2)' }}
              >
                👤 Mi Perfil
              </button>

              <button 
                onClick={() => navigate('/cartilla')}
                style={{ width: '100%', padding: '16px', fontSize: '16px', backgroundColor: '#1abc9c', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(26, 188, 156, 0.2)' }}
              >
                🩺 Ver Cartilla de Enfermeros
              </button>
            </>
          )}

          {/* ==========================================
              VISTA PARA EL ENFERMERO
              ========================================== */}
          {rolUsuario.toLowerCase() === 'enfermero' && (
            <button 
              onClick={() => navigate('/perfil-enfermero')}
              style={{ width: '100%', padding: '16px', fontSize: '16px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(46, 204, 113, 0.2)' }}
            >
              ⚕️ Mi Perfil Profesional
            </button>
          )}

        </div>

        {/* Separador */}
        <div style={{ height: '1px', backgroundColor: '#e2e8f0', marginBottom: '25px' }}></div>

        {/* Botón de Cerrar Sesión Estilizado */}
        <button 
          onClick={handleLogout}
          style={{ padding: '12px 24px', fontSize: '15px', backgroundColor: '#fee2e2', color: '#ef4444', border: '1px solid #f87171', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', transition: '0.3s' }}
        >
          Cerrar Sesión
        </button>

      </div>
    </div>
  );
};

export default Home;