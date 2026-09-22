import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

// Plantilla base para los días de la semana
const diasBase = [
  { dia_semana: 'Lunes', activo: false, hora_inicio: '08:00', hora_fin: '18:00' },
  { dia_semana: 'Martes', activo: false, hora_inicio: '08:00', hora_fin: '18:00' },
  { dia_semana: 'Miércoles', activo: false, hora_inicio: '08:00', hora_fin: '18:00' },
  { dia_semana: 'Jueves', activo: false, hora_inicio: '08:00', hora_fin: '18:00' },
  { dia_semana: 'Viernes', activo: false, hora_inicio: '08:00', hora_fin: '18:00' },
  { dia_semana: 'Sábado', activo: false, hora_inicio: '09:00', hora_fin: '14:00' },
  { dia_semana: 'Domingo', activo: false, hora_inicio: '09:00', hora_fin: '14:00' }
];

const PerfilEnfermero = () => {
  // Estados del Perfil
  const [datosEnfermero, setDatosEnfermero] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  // Estados de los Horarios
  const [horarios, setHorarios] = useState(diasBase);
  const [mensajeHorarios, setMensajeHorarios] = useState("");
  const [guardandoHorarios, setGuardandoHorarios] = useState(false);

  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  // ==========================================
  // 1. CARGA DE DATOS AL INICIAR
  // ==========================================
  useEffect(() => {
    const cargarDatos = async () => {
      if (!token) {
        setError("Acceso denegado. Iniciá sesión primero.");
        return;
      }
      
      // Cargar Perfil
      try {
        const resPerfil = await fetch("http://localhost:5000/api/perfil/enfermero", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resPerfil.ok) throw new Error("Error al obtener los datos del enfermero");
        const dataPerfil = await resPerfil.json();
        setDatosEnfermero(dataPerfil);
        setForm(dataPerfil);
      } catch (err) {
        setError(err.message);
      }

      // Cargar Horarios
      try {
        const resHorarios = await fetch("http://localhost:5000/api/perfil/enfermero/horarios", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resHorarios.ok) {
          const dataHorarios = await resHorarios.json();
          if (dataHorarios && dataHorarios.length > 0) {
            const horariosCargados = diasBase.map(base => {
              const encontrado = dataHorarios.find(d => d.dia_semana === base.dia_semana);
              return encontrado ? { ...base, ...encontrado } : base;
            });
            setHorarios(horariosCargados);
          }
        }
      } catch (err) {
        console.log("Aún no hay horarios guardados o el endpoint no está listo.");
      }
    };

    cargarDatos();
  }, [token]);

  // ==========================================
  // 2. MANEJO DEL PERFIL PROFESIONAL
  // ==========================================
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleGuardar = async () => {
    try {
      setError("");
      const response = await fetch("http://localhost:5000/api/perfil/enfermero", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
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

  // ==========================================
  // 3. MANEJO DE LA DISPONIBILIDAD
  // ==========================================
  const handleHorarioChange = (index, campo, valor) => {
    const nuevosHorarios = [...horarios];
    nuevosHorarios[index][campo] = valor;
    setHorarios(nuevosHorarios);
  };

  const handleGuardarHorarios = async () => {
    setGuardandoHorarios(true);
    setMensajeHorarios("");
    try {
      const response = await fetch("http://localhost:5000/api/perfil/enfermero/horarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ horarios: horarios }),
      });
      
      if (!response.ok) {
        if(response.status === 404) throw new Error("La ruta del backend aún no existe (Falta Renzo)");
        throw new Error("Error al guardar los horarios en la base de datos");
      }
      
      setMensajeHorarios("✅ ¡Tus horarios se guardaron con éxito!");
    } catch (err) {
      setMensajeHorarios(`⚠️ Simulación local (Aviso: ${err.message})`);
    } finally {
      setGuardandoHorarios(false);
      setTimeout(() => setMensajeHorarios(""), 4000);
    }
  };

  // ==========================================
  // RENDERIZADOS CONDICIONALES
  // ==========================================
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
      
      <div style={{ maxWidth: '650px', margin: '0 auto' }}>
        
        {/* Cabecera general */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
          <h2 style={{ color: '#2c3e50', margin: 0, fontSize: '28px', fontWeight: '800' }}>
            Panel <span style={{ color: '#2ecc71' }}>Profesional</span>
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

        {/* ==========================================
            TARJETA 1: PERFIL PROFESIONAL
            ========================================== */}
        <div style={{ backgroundColor: '#ffffff', padding: '35px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9', marginBottom: '30px' }}>
          
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

        {/* ==========================================
            TARJETA 2: GESTIÓN DE DISPONIBILIDAD
            ========================================== */}
        <div style={{ backgroundColor: '#ffffff', padding: '35px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' }}>
          
          <div style={{ borderBottom: '2px solid #f1f5f9', paddingBottom: '15px', marginBottom: '20px' }}>
            <h3 style={{ color: '#1e293b', margin: 0, fontSize: '20px' }}>🕒 Mi Disponibilidad Horaria</h3>
            <p style={{ color: '#64748b', margin: '5px 0 0 0', fontSize: '14px' }}>Marcá los días que trabajás y definí tu horario</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {horarios.map((dia, index) => (
              <div 
                key={dia.dia_semana} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  padding: '16px', 
                  backgroundColor: dia.activo ? '#f0fdf4' : '#f8fafc', 
                  borderRadius: '12px', 
                  border: `1px solid ${dia.activo ? '#bbf7d0' : '#e2e8f0'}`,
                  transition: 'all 0.3s ease'
                }}
              >
                {/* Switch y Día */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '140px' }}>
                  <input 
                    type="checkbox" 
                    checked={dia.activo} 
                    onChange={(e) => handleHorarioChange(index, 'activo', e.target.checked)} 
                    style={{ width: '20px', height: '20px', cursor: 'pointer', accentColor: '#2ecc71' }} 
                  />
                  <span style={{ fontWeight: '700', fontSize: '15px', color: dia.activo ? '#166534' : '#64748b' }}>
                    {dia.dia_semana}
                  </span>
                </div>

                {/* Controles de Hora (Se apagan si el día no está activo) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: dia.activo ? 1 : 0.4, pointerEvents: dia.activo ? 'auto' : 'none' }}>
                  <input 
                    type="time" 
                    value={dia.hora_inicio} 
                    onChange={(e) => handleHorarioChange(index, 'hora_inicio', e.target.value)} 
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', color: '#1e293b', fontWeight: '600', backgroundColor: '#ffffff', colorScheme: 'light' }} 
                  />
                  <span style={{ color: '#64748b', fontWeight: 'bold' }}>a</span>
                  <input 
                    type="time" 
                    value={dia.hora_fin} 
                    onChange={(e) => handleHorarioChange(index, 'hora_fin', e.target.value)} 
                    style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', outline: 'none', color: '#1e293b', fontWeight: '600', backgroundColor: '#ffffff', colorScheme: 'light' }} 
                  />
                </div>
              </div>
            ))}
          </div>

          <button 
            onClick={handleGuardarHorarios} 
            disabled={guardandoHorarios}
            style={{ width: '100%', padding: '16px', backgroundColor: '#2ecc71', color: 'white', border: 'none', borderRadius: '8px', cursor: guardandoHorarios ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '25px', boxShadow: '0 4px 6px rgba(46, 204, 113, 0.2)' }}
          >
            {guardandoHorarios ? "⏳ Guardando..." : "💾 Guardar Horarios"}
          </button>

          {mensajeHorarios && (
            <div style={{ marginTop: '15px', color: mensajeHorarios.includes('✅') ? '#166534' : '#b45309', backgroundColor: mensajeHorarios.includes('✅') ? '#dcfce7' : '#fef3c7', padding: '10px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', fontSize: '14px' }}>
              {mensajeHorarios}
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

export default PerfilEnfermero;