import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Register = () => {
  const [formData, setFormData] = useState({
    nombre: '',
    email: '',
    password: '',
    rol: 'paciente'
  });
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensaje('');
    setError('');

    try {
      const response = await fetch('http://localhost:5000/api/registro', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (response.ok) {
        setMensaje(data.mensaje || '¡Registro exitoso! Redirigiendo...');
        setFormData({ nombre: '', email: '', password: '', rol: 'paciente' });
        
        setTimeout(() => {
          navigate('/login'); 
        }, 1500);
      } else {
        setError(data.error || 'Error al registrar usuario');
      }
    } catch (err) {
      setError('No se pudo conectar con el servidor backend');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '85vh', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      <div style={{ width: '100%', maxWidth: '420px', backgroundColor: '#ffffff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h2 style={{ color: '#2c3e50', fontSize: '28px', margin: '0 0 8px 0', fontWeight: '800' }}>
            Crear <span style={{ color: '#3498db' }}>Cuenta</span>
          </h2>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '15px' }}>Registrate para empezar a usar ENFE-RED</p>
        </div>

        {mensaje && (
          <div style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '8px', marginBottom: '20px', textAlign: 'center', fontSize: '14px', fontWeight: '600', border: '1px solid #bbf7d0' }}>
            ✅ {mensaje}
          </div>
        )}
        {error && (
          <div style={{ backgroundColor: '#fee2e2', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '20px', textAlign: 'center', fontSize: '14px', fontWeight: '600', border: '1px solid #f87171' }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: '6px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Nombre y Apellido</label>
            <input
              type="text"
              name="nombre"
              value={formData.nombre}
              onChange={handleChange}
              required
              placeholder="Ej: Juan Pérez"
              style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: '6px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Correo Electrónico</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              placeholder="ejemplo@correo.com"
              style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: '6px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Contraseña</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              placeholder="••••••••"
              style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: '6px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Rol en la plataforma</label>
            <select 
              name="rol" 
              value={formData.rol} 
              onChange={handleChange}
              style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none', cursor: 'pointer' }}
            >
              <option value="paciente">Paciente</option>
              <option value="enfermero">Enfermero</option>
            </select>
          </div>

          <button 
            type="submit" 
            style={{ padding: '16px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '10px', boxShadow: '0 4px 6px rgba(52, 152, 219, 0.2)' }}
          >
            Registrarse
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '25px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
          <span style={{ color: '#64748b', fontSize: '14px' }}>¿Ya tenés una cuenta? </span>
          <button 
            type="button" 
            onClick={() => navigate('/login')} 
            style={{ background: 'none', border: 'none', color: '#3498db', fontWeight: 'bold', cursor: 'pointer', padding: '0', fontSize: '14px' }}
          >
            Iniciar Sesión
          </button>
        </div>

      </div>
    </div>
  );
};

export default Register;