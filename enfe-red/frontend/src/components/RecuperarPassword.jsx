import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

export default function RecuperarPassword() {
  const [paso, setPaso] = useState(1);
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [nuevaPassword, setNuevaPassword] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [tipoMensaje, setTipoMensaje] = useState("info"); // 'info' o 'error'

  const navigate = useNavigate();

  const solicitarCodigo = async (e) => {
    e.preventDefault();
    setMensaje("");
    try {
      await axios.post("http://localhost:5000/api/recuperar-password", {
        email,
      });
      setMensaje("Si el correo es válido, enviamos un código. Revisá la consola de Python.");
      setTipoMensaje("success");
      setPaso(2);
    } catch (error) {
      setMensaje("Hubo un error al procesar la solicitud.");
      setTipoMensaje("error");
    }
  };

  const resetearPassword = async (e) => {
    e.preventDefault();
    setMensaje("");
    try {
      await axios.post("http://localhost:5000/api/reset-password", {
        email,
        codigo,
        nueva_password: nuevaPassword,
      });
      setMensaje("¡Contraseña actualizada con éxito! Redirigiendo al login...");
      setTipoMensaje("success");
      
      // Redirigir al login después de 2 segundos para que alcance a leer el mensaje
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (error) {
      setMensaje("El código es incorrecto o ya expiró.");
      setTipoMensaje("error");
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      <div style={{ width: '100%', maxWidth: '420px', backgroundColor: '#ffffff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)' }}>
        
        {/* Cabecera */}
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <h2 style={{ color: '#2c3e50', fontSize: '26px', margin: '0 0 8px 0', fontWeight: '800' }}>
            Recuperar <span style={{ color: '#3498db' }}>Contraseña</span>
          </h2>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '14px' }}>
            {paso === 1 ? "Ingresá tu mail para recibir las instrucciones" : "Ingresá el código y tu nueva contraseña"}
          </p>
        </div>

        {/* Alertas de Mensajes */}
        {mensaje && (
          <div style={{ 
            backgroundColor: tipoMensaje === 'success' ? '#dcfce7' : '#fee2e2', 
            color: tipoMensaje === 'success' ? '#166534' : '#ef4444', 
            padding: '12px', 
            borderRadius: '8px', 
            marginBottom: '20px', 
            textAlign: 'center', 
            fontSize: '14px', 
            fontWeight: '600',
            border: `1px solid ${tipoMensaje === 'success' ? '#bbf7d0' : '#f87171'}`
          }}>
            {tipoMensaje === 'success' ? '✅ ' : '⚠️ '} {mensaje}
          </div>
        )}

        {paso === 1 ? (
          <form onSubmit={solicitarCodigo} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <label style={{ marginBottom: '8px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Correo Electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="ejemplo@correo.com"
                style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', outline: 'none' }}
              />
            </div>
            
            <button 
              type="submit"
              style={{ padding: '16px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 6px rgba(52, 152, 219, 0.2)' }}
            >
              Enviar código
            </button>
          </form>
        ) : (
          <form onSubmit={resetearPassword} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <label style={{ marginBottom: '8px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Código de seguridad</label>
              <input
                type="text"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                required
                placeholder="Ej: 123456"
                style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', outline: 'none' }}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              <label style={{ marginBottom: '8px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Nueva contraseña</label>
              <input
                type="password"
                value={nuevaPassword}
                onChange={(e) => setNuevaPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', outline: 'none' }}
              />
            </div>

            <button 
              type="submit"
              style={{ padding: '16px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 6px rgba(46, 204, 113, 0.2)' }}
            >
              Cambiar contraseña
            </button>
          </form>
        )}

        {/* Enlace para volver al login */}
        <div style={{ textAlign: 'center', marginTop: '25px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
          <button 
            type="button" 
            onClick={() => navigate('/login')} 
            style={{ background: 'none', border: 'none', color: '#64748b', fontWeight: '600', cursor: 'pointer', padding: '0', fontSize: '14px' }}
          >
            ← Volver al Login
          </button>
        </div>

      </div>
    </div>
  );
}