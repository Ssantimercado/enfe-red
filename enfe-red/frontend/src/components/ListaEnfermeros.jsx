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

  if (cargando) return <h3 style={{ textAlign: 'center' }}>Cargando cartilla...</h3>;
  if (error) return <h3 style={{ color: 'red', textAlign: 'center' }}>{error}</h3>;

  return (
    <div style={{ maxWidth: '800px', margin: '2rem auto', padding: '0 1rem' }}>
      <h2 style={{ color: '#2c3e50', borderBottom: '2px solid #3498db', paddingBottom: '10px' }}>
        Enfermeros Disponibles
      </h2>
      
      {enfermeros.length === 0 ? (
        <p>No hay enfermeros registrados en este momento.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
          {enfermeros.map((enf) => (
            <div 
              key={enf.usuario_id} 
              style={{ padding: '15px', border: '1px solid #ccc', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              <div>
                <h3 style={{ margin: '0 0 5px 0' }}>{enf.nombre} {enf.apellido}</h3>
                <p style={{ margin: '0', color: '#7f8c8d' }}>
                  Especialidad: {enf.especialidad || 'General'}
                </p>
              </div>
              
              {/* Este botón mágicamente te lleva al VerPerfiles.jsx */}
              <button 
                onClick={() => navigate(`/perfil/${enf.usuario_id}`)}
                style={{ padding: '10px 15px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Ver Perfil
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ListaEnfermeros;