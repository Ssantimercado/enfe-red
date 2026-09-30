import { useState, useEffect } from 'react';

export default function GestorDisponibilidad({ enfermeroId }) {
  const [disponibilidades, setDisponibilidades] = useState([]);
  const [dia, setDia] = useState('Lunes');
  const [inicio, setInicio] = useState('08:00');
  const [fin, setFin] = useState('16:00');
  const [estado, setEstado] = useState('Disponible');
  const [error, setError] = useState(null);

  const cargarDisponibilidades = () => {
    fetch(`http://localhost:5000/api/enfermeros/${enfermeroId}/disponibilidades`)
      .then((res) => res.json())
      .then((data) => setDisponibilidades(data.disponibilidades || []))
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    cargarDisponibilidades();
  }, [enfermeroId]);

  const handleAgregar = (e) => {
    e.preventDefault();
    setError(null);

    fetch('http://localhost:5000/api/disponibilidades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        enfermero_id: enfermeroId,
        dia_semana: dia,
        hora_inicio: inicio,
        hora_fin: fin,
        estado: estado,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al guardar');
        cargarDisponibilidades();
      })
      .catch((err) => setError(err.message));
  };

  const handleCambiarEstado = (id, nuevoEstado) => {
    fetch(`http://localhost:5000/api/disponibilidades/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado }),
    })
      .then(() => cargarDisponibilidades())
      .catch((err) => console.error(err));
  };

  const handleEliminar = (id) => {
    fetch(`http://localhost:5000/api/disponibilidades/${id}`, { method: 'DELETE' })
      .then(() => cargarDisponibilidades())
      .catch((err) => console.error(err));
  };

  const getBadgeColor = (est) => {
    if (est === 'Disponible') return { bg: '#dcfce7', text: '#15803d' };
    if (est === 'Ocupado') return { bg: '#fee2e2', text: '#b91c1c' };
    return { bg: '#fef3c7', text: '#b45309' }; // En Pausa
  };

  return (
    <div style={{ marginTop: '24px', borderTop: '2px solid #e0f2fe', paddingTop: '20px' }}>
      <h3 style={{ color: '#0369a1', marginBottom: '16px' }}>📅 Gestión de Horarios y Disponibilidad</h3>

      {/* Formulario Agregar */}
      <form onSubmit={handleAgregar} style={{ display: 'grid', gap: '10px', gridTemplateColumns: '1fr 1fr', marginBottom: '20px' }}>
        <div>
          <label style={labelStyle}>Día:</label>
          <select value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle}>
            {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>Estado Inicial:</label>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={inputStyle}>
            <option value="Disponible">Disponible</option>
            <option value="Ocupado">Ocupado / Reservado</option>
            <option value="En Pausa">En Pausa / No disponible</option>
          </select>
        </div>

        <div>
          <label style={labelStyle}>Desde:</label>
          <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} style={inputStyle} required />
        </div>

        <div>
          <label style={labelStyle}>Hasta:</label>
          <input type="time" value={fin} onChange={(e) => setFin(e.target.value)} style={inputStyle} required />
        </div>

        <button type="submit" style={buttonStyle}>+ Agregar Horario</button>
      </form>

      {error && <p style={{ color: '#ef4444', fontSize: '13px', marginBottom: '10px' }}>⚠️ {error}</p>}

      {/* Lista editable de Horarios */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {disponibilidades.map((item) => {
          const colors = getBadgeColor(item.estado);
          return (
            <div key={item.id} style={itemRowStyle}>
              <div>
                <strong>{item.dia_semana}:</strong> {item.hora_inicio} hs - {item.hora_fin} hs
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <select
                  value={item.estado}
                  onChange={(e) => handleCambiarEstado(item.id, e.target.value)}
                  style={{
                    backgroundColor: colors.bg,
                    color: colors.text,
                    border: 'none',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    fontWeight: 'bold',
                    cursor: 'pointer',
                  }}
                >
                  <option value="Disponible">Disponible</option>
                  <option value="Ocupado">Ocupado / Reservado</option>
                  <option value="En Pausa">En Pausa / No disponible</option>
                </select>

                <button onClick={() => handleEliminar(item.id)} style={deleteBtnStyle}>✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const labelStyle = { display: 'block', fontSize: '12px', color: '#0284c7', fontWeight: 'bold' };
const inputStyle = { width: '100%', padding: '6px', borderRadius: '6px', border: '1px solid #bae6fd', marginTop: '2px' };
const buttonStyle = { gridColumn: 'span 2', backgroundColor: '#0284c7', color: 'white', padding: '8px', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' };
const itemRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' };
const deleteBtnStyle = { backgroundColor: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', fontWeight: 'bold' };