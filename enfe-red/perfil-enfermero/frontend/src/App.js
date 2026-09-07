import React, { useEffect, useState } from 'react';

function App() {
  const [perfil, setPerfil] = useState(null);

  useEffect(() => {
    fetch('http://localhost:5000/api/perfil/1')
      .then((res) => res.json())
      .then((data) => setPerfil(data))
      .catch((err) => console.error(err));
  }, []);

  if (!perfil) return <p style={{ textAlign: 'center', marginTop: '50px' }}>Cargando perfil...</p>;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={perfil.disponible ? styles.badgeActive : styles.badgeInactive}>
            {perfil.disponible ? 'Disponible' : 'No disponible'}
          </span>
          <h2 style={styles.name}>{perfil.nombre} {perfil.apellido}</h2>
          <p style={styles.specialty}>{perfil.especialidad}</p>
        </div>

        <div style={styles.body}>
          <p><strong>Matrícula:</strong> {perfil.matricula_profesional}</p>
          <p><strong>Experiencia:</strong> {perfil.experiencia_anios} años</p>
          <p><strong>Ubicación:</strong> {perfil.ciudad}, {perfil.direccion}</p>
          <p><strong>Email:</strong> {perfil.email}</p>
          <p><strong>Teléfono:</strong> {perfil.telefono}</p>
          
          <hr style={styles.divider} />
          
          <p style={styles.description}>"{perfil.descripcion}"</p>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f0f2f5', fontFamily: 'Arial, sans-serif' },
  card: { backgroundColor: '#ffffff', borderRadius: '12px', padding: '24px', width: '380px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' },
  header: { borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '16px' },
  name: { margin: '8px 0 4px 0', color: '#1a1a1a', fontSize: '22px' },
  specialty: { margin: 0, color: '#007bff', fontWeight: 'bold' },
  badgeActive: { backgroundColor: '#e6f4ea', color: '#137333', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' },
  badgeInactive: { backgroundColor: '#fce8e6', color: '#c5221f', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' },
  body: { color: '#4a4a4a', fontSize: '14px', lineHeight: '1.6' },
  divider: { border: 'none', borderTop: '1px solid #eee', margin: '16px 0' },
  description: { fontStyle: 'italic', color: '#666' }
};

export default App;