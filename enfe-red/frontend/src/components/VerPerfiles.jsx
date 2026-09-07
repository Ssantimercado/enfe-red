import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

const API_URL = "http://localhost:5000";

function VerPerfiles() {
  const { id } = useParams();
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const obtenerPerfil = async () => {
      try {
        setCargando(true);
        
        // 1. Buscamos el token
        const token = localStorage.getItem("token");

        // 2. Hacemos la petición protegida
        const respuesta = await axios.get(`${API_URL}/api/usuarios/${id}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
        setPerfil(respuesta.data);
        setError(null);
      } catch (err) {
        if (err.response?.status === 404) {
          setError("No se encontró este perfil de enfermero.");
        } else {
          setError("Ocurrió un error al cargar el perfil.");
        }
      } finally {
        setCargando(false);
      }
    };

    obtenerPerfil();
  }, [id]);

  // Pantallas de carga y error
  if (cargando) return <p style={{ textAlign: 'center', marginTop: '20px' }}>Cargando perfil...</p>;
  if (error) return <p style={{ textAlign: 'center', color: 'red', marginTop: '20px' }}>{error}</p>;

  // Renderizado del perfil
  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', fontFamily: 'sans-serif' }}>
      <h1 style={{ color: '#2c3e50', borderBottom: '2px solid #3498db', paddingBottom: '10px' }}>
        {perfil.nombre} {perfil.apellido}
      </h1>
      
      <div style={{ marginTop: '20px' }}>
        <h3 style={{ color: '#34495e' }}>Datos profesionales</h3>
        <ul style={{ listStyleType: 'none', padding: '0', lineHeight: '2' }}>
          <li>
            <strong>Matrícula:</strong> {perfil.matricula || "No registrada"}
          </li>
          <li>
            <strong>Especialidad:</strong> {perfil.especialidad || "No especificada"}
          </li>
          <li>
            <strong>Email:</strong> {perfil.email}
          </li>
        </ul>
      </div>
    </div>
  );
}

export default VerPerfiles;