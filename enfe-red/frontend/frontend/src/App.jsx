import { useEffect, useState } from 'react';
import GestorDisponibilidad from './components/GestorDisponibilidad';

function App() {
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('http://localhost:5000/api/perfil/1')
      .then((res) => {
        if (!res.ok) throw new Error('Error al obtener los datos del perfil');
        return res.json();
      })
      .then((data) => setPerfil(data))
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return (
      <div style={styles.centerContainer}>
        <div style={styles.errorCard}>
          <p style={{ margin: 0 }}>⚠️ {error}</p>
        </div>
      </div>
    );
  }

  if (!perfil) {
    return (
      <div style={styles.centerContainer}>
        <p style={{ color: '#0284c7', fontWeight: 'bold' }}>Cargando perfil del enfermero...</p>
      </div>
    );
  }

  return (
    <div style={styles.pageBackground}>
      <div style={styles.card}>
        {/* Encabezado con Ícono/Avatar */}
        <div style={styles.header}>
          <div style={styles.avatarContainer}>
            <svg
              style={styles.avatarIcon}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
              />
            </svg>
          </div>
          <h2 style={styles.name}>
            {perfil.nombre} {perfil.apellido}
          </h2>
          <span style={styles.badgeEspecialidad}>
            {perfil.especialidad || 'Enfermero/a Profesional'}
          </span>
        </div>

        {/* Indicador de Estado General */}
        <div style={styles.statusRow}>
          <span
            style={{
              ...styles.statusDot,
              backgroundColor: perfil.disponible ? '#22c55e' : '#ef4444',
            }}
          />
          <span style={styles.statusText}>
            {perfil.disponible ? 'Disponible para turnos' : 'No disponible'}
          </span>
        </div>

        {/* Detalle de Información */}
        <div style={styles.infoSection}>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <span style={styles.label}>Email</span>
              <span style={styles.value}>{perfil.email || 'No registrado'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Teléfono</span>
              <span style={styles.value}>{perfil.telefono || 'No registrado'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Matrícula</span>
              <span style={styles.value}>{perfil.matricula_profesional || 'N/A'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Experiencia</span>
              <span style={styles.value}>{perfil.experiencia_anios} años</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Ciudad</span>
              <span style={styles.value}>{perfil.ciudad || 'No especificada'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.label}>Dirección</span>
              <span style={styles.value}>{perfil.direccion || 'No especificada'}</span>
            </div>
          </div>

          {perfil.descripcion && (
            <div style={styles.descriptionBox}>
              <span style={styles.label}>Sobre mí</span>
              <p style={styles.descriptionText}>{perfil.descripcion}</p>
            </div>
          )}
        </div>

        {/* Componente de Gestión de Disponibilidad y Horarios */}
        <GestorDisponibilidad enfermeroId={perfil.id} />
      </div>
    </div>
  );
}

// Objeto de estilos en tonos Azules y Blancos
const styles = {
  pageBackground: {
    backgroundColor: '#f0f9ff',
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '20px',
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  centerContainer: {
    backgroundColor: '#f0f9ff',
    minHeight: '100vh',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    boxShadow: '0 10px 25px -5px rgba(14, 165, 233, 0.15)',
    width: '100%',
    maxWidth: '520px',
    padding: '32px',
    border: '1px solid #e0f2fe',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: '20px',
  },
  avatarContainer: {
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    backgroundColor: '#e0f2fe',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '16px',
    border: '3px solid #0284c7',
  },
  avatarIcon: {
    width: '52px',
    height: '52px',
    color: '#0284c7',
  },
  name: {
    margin: '0 0 6px 0',
    color: '#0c4a6e',
    fontSize: '24px',
    fontWeight: '700',
  },
  badgeEspecialidad: {
    backgroundColor: '#bae6fd',
    color: '#0369a1',
    padding: '4px 12px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: '600',
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '24px',
    padding: '8px 16px',
    backgroundColor: '#f8fafc',
    borderRadius: '8px',
  },
  statusDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
  },
  statusText: {
    fontSize: '14px',
    color: '#334155',
    fontWeight: '500',
  },
  infoSection: {
    borderTop: '1px solid #f0f9ff',
    paddingTop: '20px',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
  },
  label: {
    fontSize: '12px',
    color: '#0284c7',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '4px',
  },
  value: {
    fontSize: '14px',
    color: '#1e293b',
    fontWeight: '500',
  },
  descriptionBox: {
    marginTop: '20px',
    paddingTop: '16px',
    borderTop: '1px solid #e0f2fe',
  },
  descriptionText: {
    fontSize: '14px',
    color: '#475569',
    marginTop: '6px',
    lineHeight: '1.5',
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    color: '#991b1b',
    padding: '16px 24px',
    borderRadius: '12px',
    border: '1px solid #fecaca',
  },
};

export default App;