import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const ListaEnfermeros = () => {
  const [enfermeros, setEnfermeros] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  
  const navigate = useNavigate();

  useEffect(() => {
    const fetchEnfermeros = async () => {
      try {
        const token = localStorage.getItem('token');
        
        const response = await fetch('http://localhost:5000/api/enfermeros', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();

        if (response.ok) {
          setEnfermeros(data);
        } else {
          setError(data.error || 'Error al cargar los enfermeros');
        }
      } catch (err) {
        setError('Error de conexión con el servidor');
      } finally {
        setCargando(false);
      }
    };

    fetchEnfermeros();
  }, []);

  if (cargando) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <h3 style={{ color: '#3498db', fontWeight: '600' }}>⏳ Cargando cartilla de profesionales...</h3>
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '70vh', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ backgroundColor: '#fee2e2', padding: '20px 40px', borderRadius: '12px', border: '1px solid #f87171', color: '#ef4444', textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 15px 0' }}>⚠️ {error}</h3>
        <button onClick={() => navigate('/home')} style={{ padding: '10px 20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          Volver al Inicio
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '40px 20px', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      <div style={{ maxWidth: '750px', margin: '0 auto' }}>
        
        {/* Cabecera con título y botón volver */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
          <div>
            <h2 style={{ color: '#2c3e50', margin: '0 0 5px 0', fontSize: '28px', fontWeight: '800' }}>
              Enfermeros <span style={{ color: '#3498db' }}>Disponibles</span>
            </h2>
            <p style={{ color: '#7f8c8d', margin: 0, fontSize: '14px' }}>Seleccioná un profesional para ver su perfil completo</p>
          </div>
          <button 
            onClick={() => navigate('/home')}
            style={{ padding: '10px 18px', backgroundColor: '#ffffff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
          >
            ← Volver al Panel
          </button>
        </div>
        
        {enfermeros.length === 0 ? (
          <div style={{ backgroundColor: '#ffffff', padding: '40px', borderRadius: '16px', textAlign: 'center', boxShadow: '0 4px 10px rgba(0,0,0,0.03)', border: '1px solid #f1f5f9' }}>
            <p style={{ color: '#64748b', fontSize: '15px', margin: 0 }}>No hay enfermeros registrados en este momento.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {enfermeros.map((enf) => (
              <div 
                key={enf.usuario_id} 
                style={{ 
                  backgroundColor: '#ffffff', 
                  padding: '22px 25px', 
                  borderRadius: '16px', 
                  boxShadow: '0 4px 12px rgba(0,0,0,0.04)', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  border: '1px solid #f1f5f9',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  
                  {/* Avatar circular moderno */}
                  <div style={{ width: '55px', height: '55px', backgroundColor: '#e0f2fe', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#0284c7', fontSize: '20px', fontWeight: '800', flexShrink: 0 }}>
                    {enf.nombre.charAt(0)}{enf.apellido.charAt(0)}
                  </div>
                  
                  <div>
                    <h3 style={{ margin: '0 0 6px 0', color: '#1e293b', fontSize: '18px', fontWeight: '700' }}>
                      {enf.nombre} {enf.apellido}
                    </h3>
                    <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: '600', display: 'inline-block' }}>
                      🩺 {enf.especialidad || 'General'}
                    </span>
                  </div>
                </div>
                
                {/* Botón de acción pro */}
                <button 
                  onClick={() => navigate(`/perfil/${enf.usuario_id}`)}
                  style={{ padding: '12px 20px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(52, 152, 219, 0.2)', fontSize: '14px', flexShrink: 0 }}
                >
                  Ver Perfil
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ListaEnfermeros;