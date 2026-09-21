import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const PerfilEnfermero = () => {
  const [datosEnfermero, setDatosEnfermero] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  const navigate = useNavigate();
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
        }
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
      setError("");
      const response = await fetch(
        "http://localhost:5000/api/perfil/enfermero",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(form),
        }
      );
      if (!response.ok) throw new Error("Error al guardar los cambios");
      
      const data = await response.json();
      setDatosEnfermero(data);
      setEditando(false);
      setMensaje("¡Perfil actualizado correctamente!");
      
      setTimeout(() => setMensaje(""), 3000);
    } catch (err) {
      setError(err.message);
    }
  };

  if (!datosEnfermero && !error) return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <h3 style={{ color: '#2ecc71', fontWeight: '600' }}>⏳ Cargando tu perfil profesional...</h3>
    </div>
  );

  if (error && !datosEnfermero) return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', fontFamily: "'Segoe UI', Roboto, sans-serif", flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ backgroundColor: '#fee2e2', padding: '20px 40px', borderRadius: '12px', border: '1px solid #f87171', color: '#ef4444', textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 15px 0' }}>⚠️ {error}</h3>
        <button onClick={() => navigate('/login')} style={{ padding: '10px 20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          Ir al Login
        </button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '40px 20px', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
          <h2 style={{ color: '#2c3e50', margin: 0, fontSize: '28px', fontWeight: '800' }}>
            Perfil <span style={{ color: '#2ecc71' }}>Profesional</span>
          </h2>
          <button 
            onClick={() => navigate('/home')}
            style={{ padding: '8px 16px', backgroundColor: '#ffffff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
          >
            ← Volver al Panel
          </button>
        </div>

        {mensaje && (
          <div style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0', marginBottom: '20px', textAlign: 'center', fontWeight: '600' }}>
            ✅ {mensaje}
          </div>
        )}
        {error && (
          <div style={{ backgroundColor: '#fee2e2', color: '#ef4444', padding: '12px', borderRadius: '8px', border: '1px solid #f87171', marginBottom: '20px', textAlign: 'center', fontWeight: '600' }}>
            ❌ {error}
          </div>
        )}

        <div style={{ backgroundColor: '#ffffff', padding: '35px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' }}>
          
          {editando ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '15px', marginBottom: '5px' }}>
                <h3 style={{ color: '#1e293b', margin: 0 }}>Editar mis datos</h3>
              </div>

              <div style={{ display: 'flex', gap: '15px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <label style={{ marginBottom: '6px', fontWeight: '600', color: '#475569', fontSize: '14px' }}>Nombre</label>
                  <input name="nombre" value={form.nombre || ""} onChange={handleChange} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <label style={{ marginBottom: '6px', fontWeight: '600', color: '#475569', fontSize: '14px' }}>Apellido</label>
                  <input name="apellido" value={form.apellido || ""} onChange={handleChange} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }} />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{ marginBottom: '6px', fontWeight: '600', color: '#475569', fontSize: '14px' }}>Especialidad</label>
                <input name="especialidad" value={form.especialidad || ""} onChange={handleChange} placeholder="Ej: Pediatría, Cuidados Intensivos..." style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <label style={{ marginBottom: '6px', fontWeight: '600', color: '#475569', fontSize: '14px' }}>Matrícula Profesional</label>
                <input name="matricula" value={form.matricula || ""} onChange={handleChange} style={{ padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }} />
              </div>

              <div style={{ display: 'flex', gap: '15px', marginTop: '15px' }}>
                <button onClick={handleGuardar} style={{ flex: 1, padding: '14px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                  💾 Guardar Cambios
                </button>
                <button onClick={() => setEditando(false)} style={{ flex: 1, padding: '14px', backgroundColor: '#ffffff', color: '#ef4444', border: '1px solid #f87171', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '25px', marginBottom: '30px' }}>
                <div style={{ width: '80px', height: '80px', backgroundColor: '#dcfce7', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#166534', fontSize: '28px', fontWeight: '800' }}>
                  {datosEnfermero.nombre?.charAt(0)}{datosEnfermero.apellido?.charAt(0)}
                </div>
                <div>
                  <h1 style={{ color: '#1e293b', margin: '0 0 5px 0', fontSize: '26px' }}>
                    {datosEnfermero.nombre} {datosEnfermero.apellido}
                  </h1>
                  <span style={{ backgroundColor: '#e2e8f0', color: '#475569', padding: '5px 12px', borderRadius: '20px', fontSize: '14px', fontWeight: '700' }}>
                    {datosEnfermero.email}
                  </span>
                </div>
              </div>

              <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '25px' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#334155', fontSize: '18px' }}>Información Registrada</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                    <span style={{ color: '#64748b', fontWeight: '600' }}>Matrícula:</span>
                    <span style={{ color: '#1e293b', fontWeight: '700' }}>{datosEnfermero.matricula || "No registrada"}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748b', fontWeight: '600' }}>Especialidad:</span>
                    <span style={{ color: '#166534', fontWeight: '700', backgroundColor: '#dcfce7', padding: '2px 10px', borderRadius: '10px' }}>
                      {datosEnfermero.especialidad || "No especificada"}
                    </span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setEditando(true)} 
                style={{ width: '100%', padding: '16px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 6px rgba(52, 152, 219, 0.2)' }}
              >
                ✏️ Editar Perfil
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PerfilEnfermero;