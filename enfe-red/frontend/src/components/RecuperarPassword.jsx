import { useState } from "react";
import axios from "axios";

export default function RecuperarPassword() {
  const [paso, setPaso] = useState(1);
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [mensaje, setMensaje] = useState("");

  const solicitarCodigo = async (e) => {
    e.preventDefault();
    try {
      // Le pega a la ruta de Flask que vas a crear ahora
      await axios.post("http://localhost:5000/api/recuperar-password", {
        email,
      });
      setMensaje(
        "Si el correo es válido, enviamos un código. Revisá la consola de Python.",
      );
      setPaso(2);
    } catch (error) {
      setMensaje("Hubo un error al procesar la solicitud.");
    }
  };

  const resetearPassword = async (e) => {
    e.preventDefault();
    try {
      await axios.post("http://localhost:5000/api/reset-password", {
        email,
        codigo,
        nueva_password: nuevaPassword,
      });
      setMensaje("¡Contraseña actualizada con éxito! Ya podés iniciar sesión.");
      setPaso(1); // Acá después podés redirigirlo al Login
    } catch (error) {
      setMensaje("El código es incorrecto o ya expiró.");
    }
  };

  return (
    <div
      style={{
        maxWidth: "400px",
        margin: "50px auto",
        fontFamily: "sans-serif",
      }}
    >
      <h2>Recuperar Contraseña</h2>
      {mensaje && <p style={{ color: "blue" }}>{mensaje}</p>}

      {paso === 1 ? (
        <form
          onSubmit={solicitarCodigo}
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        >
          <label>Email registrado:</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit">Enviar código</button>
        </form>
      ) : (
        <form
          onSubmit={resetearPassword}
          style={{ display: "flex", flexDirection: "column", gap: "15px" }}
        >
          <label>Código de seguridad:</label>
          <input
            type="text"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
          />
          <label>Nueva contraseña:</label>
          <input
            type="password"
            value={nuevaPassword}
            onChange={(e) => setNuevaPassword(e.target.value)}
            required
          />
          <button type="submit">Cambiar contraseña</button>
        </form>
      )}
    </div>
  );
}
