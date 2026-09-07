import { useState, useEffect } from "react";

const PerfilPaciente = () => {
  const [datosPaciente, setDatosPaciente] = useState(null);
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
        "http://localhost:5000/api/perfil/paciente",
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!response.ok)
        throw new Error("Error al obtener los datos del paciente");
      const data = await response.json();
      setDatosPaciente(data);
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
        "http://localhost:5000/api/perfil/paciente",
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
      setDatosPaciente(data);
      setEditando(false);
      setMensaje("Perfil actualizado correctamente");
    } catch (err) {
      setError(err.message);
    }
  };

  if (error) return <div className="text-red-500">{error}</div>;
  if (!datosPaciente) return <div>Cargando perfil...</div>;

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
          Teléfono:
          <input
            name="telefono"
            value={form.telefono || ""}
            onChange={handleChange}
          />
        </label>
        <label>
          Dirección:
          <input
            name="direccion"
            value={form.direccion || ""}
            onChange={handleChange}
          />
        </label>
        <label>
          Historial médico:
          <textarea
            name="historial_medico"
            value={form.historial_medico || ""}
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
        Bienvenido, {datosPaciente.nombre} {datosPaciente.apellido}
      </h1>
      {mensaje && <p className="text-green-500">{mensaje}</p>}
      <div className="tarjeta-info">
        <h3>Tus Datos de Paciente</h3>
        <ul>
          <li>
            <strong>Email:</strong> {datosPaciente.email}
          </li>
          <li>
            <strong>Teléfono:</strong>{" "}
            {datosPaciente.telefono || "No registrado"}
          </li>
          <li>
            <strong>Dirección:</strong>{" "}
            {datosPaciente.direccion || "No registrada"}
          </li>
          <li>
            <strong>Historial Médico:</strong>{" "}
            {datosPaciente.historial_medico || "Sin historial previo"}
          </li>
        </ul>
      </div>
      <button onClick={() => setEditando(true)}>Editar Perfil</button>
    </div>
  );
};

export default PerfilPaciente;
