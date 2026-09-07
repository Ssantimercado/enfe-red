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
        const respuesta = await axios.get(`${API_URL}/api/usuarios/${id}`);
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

  if (cargando) return <p>Cargando perfil...</p>;
  if (error) return <p>{error}</p>;

  return (
    <div className="contenedor-perfil">
      <h1>
        {perfil.nombre} {perfil.apellido}
      </h1>
      <div className="tarjeta-info">
        <h3>Datos profesionales</h3>
        <ul>
          <li>
            <strong>Matrícula:</strong> {perfil.matricula || "No registrada"}
          </li>
          <li>
            <strong>Especialidad:</strong>{" "}
            {perfil.especialidad || "No especificada"}
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
