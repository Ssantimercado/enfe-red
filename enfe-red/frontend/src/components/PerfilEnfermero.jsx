import { useState, useEffect } from "react";

const PerfilEnfermero = () => {
  const [datosEnfermero, setDatosEnfermero] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchPerfil = async () => {
      const token = localStorage.getItem("token");

      if (!token) {
        setError("Acceso denegado. Iniciá sesión primero.");
        return;
      }

      try {
        const response = await fetch(
          "http://localhost:5000/api/perfil/enfermero",
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error("Error al obtener los datos del enfermero");
        }

        const data = await response.json();
        setDatosEnfermero(data);
      } catch (err) {
        setError(err.message);
      }
    };

    fetchPerfil();
  }, []);

  if (error) return <div className="text-red-500">{error}</div>;
  if (!datosEnfermero) return <div>Cargando perfil...</div>;

  return (
    <div className="contenedor-perfil">
      <h1>
        Bienvenido/a, {datosEnfermero.nombre} {datosEnfermero.apellido}
      </h1>

      <div className="tarjeta-info">
        <h3>Tus Datos Profesionales</h3>
        <ul>
          <li>
            <strong>Email:</strong> {datosEnfermero.email}
          </li>
          <li>
            <strong>Matrícula:</strong>{" "}
            {datosEnfermero.matricula || "No registrada"}
          </li>
          <li>
            <strong>Especialidad:</strong>{" "}
            {datosEnfermero.especialidad || "No especificada"}
          </li>
        </ul>
      </div>

      {/* Botón temporal, más adelante Renzo conectará esto con su vista */}
      <button onClick={() => alert("Renzo programará esta parte")}>
        Editar Perfil
      </button>
    </div>
  );
};

export default PerfilEnfermero;
