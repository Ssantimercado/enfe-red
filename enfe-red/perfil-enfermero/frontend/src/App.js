import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get('http://127.0.0.1:5000/api/perfil/1')
      .then(response => {
        setPerfil(response.data);
      })
      .catch(err => {
        console.error("Error obteniendo el perfil:", err);
        setError("No se pudo cargar el perfil del enfermero.");
      });
  }, []);

  if (error) {
    return <div className="error-message" style={{ textAlign: 'center', marginTop: '50px' }}>{error}</div>;
  }

  if (!perfil) {
    return <div className="loading" style={{ textAlign: 'center', marginTop: '50px' }}>Cargando perfil...</div>;
  }

  return (
    <div className="App">
      <div className="perfil-container">
        <div className="perfil-header">
          <img src={perfil.foto_url} alt={`Foto de ${perfil.nombre_completo}`} className="perfil-foto" />
          <h1 className="perfil-nombre">{perfil.nombre_completo}</h1>
          <p className="perfil-edad">{perfil.edad} años</p>
        </div>

        <div className="perfil-body">
          <div className="perfil-seccion">
            <h2>Títulos y Formación</h2>
            <ul className="perfil-lista">
              {perfil.titulos.map((titulo, index) => (
                <li key={index}>{titulo}</li>
              ))}
            </ul>
          </div>

          <div className="perfil-seccion">
            <h2>Dirección</h2>
            <p className="perfil-dato">{perfil.direccion}</p>
          </div>

          <div className="perfil-seccion">
            <h2>Certificado Profesional</h2>
            {perfil.certificado_profesional_verificado ? (
              <div className="certificado-verificado">
                ✓ Verificado y Vigente
              </div>
            ) : (
              <div className="certificado-pendiente">
                ⚠ Pendiente de Verificación
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;