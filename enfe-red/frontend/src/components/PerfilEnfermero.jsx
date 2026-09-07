import { useState, useEffect } from "react";

const PerfilEnfermero = () => {
  const [datosEnfermero, setDatosEnfermero] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const token = localStorage.getItem("token");

  const cargarPerfil = async () => {
    if (!token) {
      setError("Acceso denegado. Iniciá sesión primero.");
      return;
    }
    try {
      const response = await fetch(
        "http://localhost:5000/api/perfil/enfermero",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok)
        throw new Error("Error al obtener los datos del enfermero");
      const data = await response.json();
      setDatosEnfermero(data);
      setForm(data);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    cargarPerfil();
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleGuardar = async () => {
    try {
      const response = await fetch(
        "http://localhost:5000/api/perfil/enfermero",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        },
      );
      if (!response.ok) throw new Error("Error al guardar los cambios");
      const data = await response.json();
      setDatosEnfermero(data);
      setEditando(false);
      setMensaje("Perfil actualizado correctamente");
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <div className="text-red-500">{error}</div>;
  if (!datosEnfermero) return <div>Cargando perfil...</div>;

  if (editando) {
    return (
      <div className="contenedor-perfil">
        <h1>Editar mi perfil</h1>
        <label>
          Nombre:
          <input
            name="nombre"
            value={form.nombre || ""}
            onChange={handleChange}
          />
        </label>
        <label>
          Apellido:
          <input
            name="apellido"
            value={form.apellido || ""}
            onChange={handleChange}
          />
        </label>
        <label>
          Matrícula:
          <input
            name="matricula"
            value={form.matricula || ""}
            onChange={handleChange}
          />
        </label>
        <label>
          Especialidad:
          <input
            name="especialidad"
            value={form.especialidad || ""}
            onChange={handleChange}
          />
        </label>
        <button onClick={handleGuardar}>Guardar</button>
        <button onClick={() => setEditando(false)}>Cancelar</button>
      </div>
    );
  }

  return (
    <div className="contenedor-perfil">
      <h1>
        Bienvenido/a, {datosEnfermero.nombre} {datosEnfermero.apellido}
      </h1>
      {mensaje && <p className="text-green-500">{mensaje}</p>}
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
      <button onClick={() => setEditando(true)}>Editar Perfil</button>
    </div>
  );
};

export default PerfilEnfermero;
