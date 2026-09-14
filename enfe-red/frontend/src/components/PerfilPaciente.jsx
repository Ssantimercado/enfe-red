
import { useState, useEffect } from 'react';

const PerfilPaciente = () => {
  const [datosPaciente, setDatosPaciente] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchPerfil = async () => {
      // Obtenemos el token que guardaste en tu Login
      const token = localStorage.getItem('token'); 
      
      if (!token) {
        setError('Acceso denegado. Iniciá sesión primero.');
        return;
      }

      try {
        const response = await fetch('http://localhost:5000/api/usuarios/perfil/paciente', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` // Le enviamos el JWT al backend
          }
        });

        if (!response.ok) {
          throw new Error('Error al obtener los datos del paciente');
        }

        const data = await response.json();
        setDatosPaciente(data);
      } catch (err) {
        setError(err.message);
      }
    };

    fetchPerfil();
  }, []);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!datosPaciente) return <div>Cargando perfil...</div>;

  return (
    <div className="contenedor-perfil">
      <h1>Bienvenido, {datosPaciente.nombre} {datosPaciente.apellido}</h1>
      
      <div className="tarjeta-info">
        <h3>Tus Datos de Paciente</h3>
        <ul>
          <li><strong>Email:</strong> {datosPaciente.email}</li>
          <li><strong>Teléfono:</strong> {datosPaciente.telefono || 'No registrado'}</li>
          <li><strong>Dirección:</strong> {datosPaciente.direccion || 'No registrada'}</li>
          <li><strong>Historial Médico:</strong> {datosPaciente.historial_medico || 'Sin historial previo'}</li>
        </ul>
      </div>
      
      {/* Botón temporal, más adelante Renzo conectará esto con su vista */}
      <button onClick={() => alert('Renzo programará esta parte')}>
        Editar Perfil
      </button>
    </div>
  );
};

export default PerfilPaciente;