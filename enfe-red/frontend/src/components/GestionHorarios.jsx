import React, { useState } from 'react';
import './GestionHorarios.css';

const GestionHorarios = () => {
  const [dia, setDia] = useState('Lunes');
  const [estado, setEstado] = useState('Disponible');
  const [horaDesde, setHoraDesde] = useState('08:00');
  const [horaHasta, setHoraHasta] = useState('16:00');

  const handleAgregarHorario = (e) => {
    e.preventDefault();
    const nuevoHorario = { dia, estado, horaDesde, horaHasta };
    console.log('Horario agregado:', nuevoHorario);
    // Aquí realizas el POST a tu backend Flask
  };

  return (
    <div className="horarios-container">
      <h2 className="horarios-title">
        <span role="img" aria-label="calendar">🗓️</span> Gestión de Horarios y Disponibilidad
      </h2>

      <form onSubmit={handleAgregarHorario} className="horarios-form">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Día:</label>
            <select 
              value={dia} 
              onChange={(e) => setDia(e.target.value)}
              className="dark-select"
            >
              <option value="Lunes">Lunes</option>
              <option value="Martes">Martes</option>
              <option value="Miércoles">Miércoles</option>
              <option value="Jueves">Jueves</option>
              <option value="Viernes">Viernes</option>
              <option value="Sábado">Sábado</option>
              <option value="Domingo">Domingo</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Estado Inicial:</label>
            <select 
              value={estado} 
              onChange={(e) => setEstado(e.target.value)}
              className="dark-select"
            >
              <option value="Disponible">Disponible</option>
              <option value="Ocupado / Reservado">Ocupado / Reservado</option>
              <option value="En Pausa / No disponible">En Pausa / No disponible</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Desde:</label>
            <input 
              type="time" 
              value={horaDesde} 
              onChange={(e) => setHoraDesde(e.target.value)}
              className="dark-input"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Hasta:</label>
            <input 
              type="time" 
              value={horaHasta} 
              onChange={(e) => setHoraHasta(e.target.value)}
              className="dark-input"
            />
          </div>
        </div>

        <button type="submit" className="btn-agregar">
          + Agregar Horario
        </button>
      </form>
    </div>
  );
};

export default GestionHorarios;