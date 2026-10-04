import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const PerfilEnfermero = () => {
  // Estados del Perfil
  const [datosEnfermero, setDatosEnfermero] = useState(null);
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState({});
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");

  // Estados del Formulario de Horarios
  const [horariosList, setHorariosList] = useState([]);
  const [cargandoHorariosList, setCargandoHorariosList] = useState(true);
  const [diaSeleccionado, setDiaSeleccionado] = useState("Lunes");
  const [estadoInicial, setEstadoInicial] = useState("Disponible");
  const [horaDesde, setHoraDesde] = useState("08:00");
  const [horaHasta, setHoraHasta] = useState("16:00");
  const [mensajeHorarios, setMensajeHorarios] = useState("");
  const [guardandoHorarios, setGuardandoHorarios] = useState(false);

  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  // Función para pedir los horarios guardados
  const obtenerHorarios = async () => {
    try {
      setCargandoHorariosList(true);
      const res = await fetch("http://localhost:5000/api/perfil/enfermero/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setHorariosList(data);
      }
    } catch (err) {
      console.error("Error al cargar horarios:", err);
    } finally {
      setCargandoHorariosList(false);
    }
  };

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
      await obtenerHorarios();
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
  // 3. AGREGAR HORARIO
  // ==========================================
  const handleAgregarHorario = async (e) => {
    e.preventDefault();
    setGuardandoHorarios(true);
    setMensajeHorarios("");

    const nuevoHorario = {
      dia: diaSeleccionado,
      estado: estadoInicial,
      hora_inicio: horaDesde,
      hora_fin: horaHasta
    };

    try {
      const response = await fetch("http://localhost:5000/api/perfil/enfermero/horarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(nuevoHorario),
      });
      
      if (!response.ok) {
        if (response.status === 404) throw new Error("La ruta del backend aún no existe");
        throw new Error("Error al guardar el horario en la base de datos");
      }
      
      setMensajeHorarios("✅ ¡Horario agregado con éxito!");
      
      // Volvemos a pedir los horarios actualizados a la BD
      await obtenerHorarios();
    } catch (err) {
      setMensajeHorarios(`⚠️ Aviso: ${err.message}`);
    } finally {
      setGuardandoHorarios(false);
      setTimeout(() => setMensajeHorarios(""), 4000);
    }
  };

  // Helper para el color del badge de estado
  const getBadgeStyle = (estado) => {
    if (estado?.includes("Disponible")) {
      return { backgroundColor: '#dcfce7', color: '#166534' };
    } else if (estado?.includes("Ocupado")) {
      return { backgroundColor: '#fee2e2', color: '#991b1b' };
    }
    return { backgroundColor: '#fef3c7', color: '#92400e' };
  };

  // ==========================================
  // RENDERIZADOS CONDICIONALES
  // ==========================================
  if (!datosEnfermero && !error) return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <h3 style={{ color: '#0077b6', fontWeight: '600' }}>⏳ Cargando tu perfil profesional...</h3>
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
          <h2 style={{ color: '#0077b6', margin: 0, fontSize: '28px', fontWeight: '800' }}>
            Panel <span style={{ color: '#0088cc' }}>Profesional</span>
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
                <button onClick={handleGuardar} style={{ flex: 1, padding: '14px', backgroundColor: '#0088cc', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' }}>
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
                <div style={{ width: '80px', height: '80px', backgroundColor: '#e0f2fe', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#0077b6', fontSize: '28px', fontWeight: '800' }}>
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
                    <span style={{ color: '#0077b6', fontWeight: '700', backgroundColor: '#e0f2fe', padding: '2px 10px', borderRadius: '10px' }}>
                      {datosEnfermero.especialidad || "No especificada"}
                    </span>
                  </div>
                </div>
              </div>

              <button 
                onClick={() => setEditando(true)} 
                style={{ width: '100%', padding: '16px', backgroundColor: '#0088cc', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', boxShadow: '0 4px 6px rgba(0, 136, 204, 0.2)' }}
              >
                ✏️ Editar Perfil
              </button>
            </div>
          )}
        </div>

        {/* ==========================================
            TARJETA 2: GESTIÓN DE HORARIOS Y DISPONIBILIDAD
            ========================================== */}
        <div style={{ backgroundColor: '#ffffff', padding: '35px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' }}>
          
          <h3 style={{ color: '#0077b6', margin: '0 0 25px 0', fontSize: '22px', fontWeight: '800', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            📅 Gestión de Horarios y Disponibilidad
          </h3>

          {/* FORMULARIO AGREGAR HORARIO */}
          <form onSubmit={handleAgregarHorario} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Fila 1: Día y Estado Inicial */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ color: '#0077b6', fontWeight: 'bold', fontSize: '14px' }}>Día:</label>
                <select 
                  value={diaSeleccionado} 
                  onChange={(e) => setDiaSeleccionado(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#3b3e40', color: '#ffffff', border: '1px solid #2b2d2f', borderRadius: '8px', padding: '10px 14px', fontSize: '15px', outline: 'none' }}
                >
                  <option value="Lunes">Lunes</option>
                  <option value="Martes">Martes</option>
                  <option value="Miércoles">Miércoles</option>
                  <option value="Jueves">Jueves</option>
                  <option value="Viernes">Viernes</option>
                  <option value="Sábado">Sábado</option>
                  <option value="Domingo">Domingo</option>
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ color: '#0077b6', fontWeight: 'bold', fontSize: '14px' }}>Estado Inicial:</label>
                <select 
                  value={estadoInicial} 
                  onChange={(e) => setEstadoInicial(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#3b3e40', color: '#ffffff', border: '1px solid #2b2d2f', borderRadius: '8px', padding: '10px 14px', fontSize: '15px', outline: 'none' }}
                >
                  <option value="Disponible">Disponible</option>
                  <option value="Ocupado / Reservado">Ocupado / Reservado</option>
                  <option value="En Pausa / No disponible">En Pausa / No disponible</option>
                </select>
              </div>
            </div>

            {/* Fila 2: Desde y Hasta */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ color: '#0077b6', fontWeight: 'bold', fontSize: '14px' }}>Desde:</label>
                <input 
                  type="time" 
                  value={horaDesde} 
                  onChange={(e) => setHoraDesde(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#3b3e40', color: '#ffffff', border: '1px solid #2b2d2f', borderRadius: '8px', padding: '10px 14px', fontSize: '15px', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }}
                />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ color: '#0077b6', fontWeight: 'bold', fontSize: '14px' }}>Hasta:</label>
                <input 
                  type="time" 
                  value={horaHasta} 
                  onChange={(e) => setHoraHasta(e.target.value)}
                  style={{ width: '100%', backgroundColor: '#3b3e40', color: '#ffffff', border: '1px solid #2b2d2f', borderRadius: '8px', padding: '10px 14px', fontSize: '15px', outline: 'none', boxSizing: 'border-box', colorScheme: 'dark' }}
                />
              </div>
            </div>

            {/* Botón Agregar */}
            <button 
              type="submit" 
              disabled={guardandoHorarios}
              style={{ width: '100%', padding: '14px', backgroundColor: '#0088cc', color: '#ffffff', border: 'none', borderRadius: '8px', cursor: guardandoHorarios ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '10px', boxShadow: '0 4px 6px rgba(0, 136, 204, 0.2)' }}
            >
              {guardandoHorarios ? "⏳ Guardando..." : "+ Agregar Horario"}
            </button>
          </form>

          {mensajeHorarios && (
            <div style={{ marginTop: '15px', color: mensajeHorarios.includes('✅') ? '#166534' : '#b45309', backgroundColor: mensajeHorarios.includes('✅') ? '#dcfce7' : '#fef3c7', padding: '10px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', fontSize: '14px' }}>
              {mensajeHorarios}
            </div>
          )}

          {/* LISTADO DE HORARIOS REGISTRADOS */}
          <div style={{ marginTop: '30px', borderTop: '2px dashed #e2e8f0', paddingTop: '20px' }}>
            <h4 style={{ margin: '0 0 15px 0', color: '#334155', fontSize: '16px', fontWeight: '700' }}>
              📋 Mis Horarios Configurados
            </h4>

            {cargandoHorariosList ? (
              <p style={{ color: '#64748b', fontSize: '14px', fontStyle: 'italic' }}>Cargando horarios...</p>
            ) : horariosList.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {horariosList.map((item, index) => (
                  <div 
                    key={index} 
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}
                  >
                    <div>
                      <strong style={{ color: '#0077b6', fontSize: '15px', marginRight: '8px' }}>
                        {item.dia || item.dia_semana}
                      </strong>
                      <span style={{ color: '#334155', fontSize: '14px', fontWeight: '600' }}>
                        {item.hora_inicio} a {item.hora_fin} hs
                      </span>
                    </div>
                    <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', ...getBadgeStyle(item.estado) }}>
                      {item.estado || 'Disponible'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: '#64748b', fontSize: '14px', fontStyle: 'italic', margin: 0 }}>
                Aún no has configurado ningún horario. Usa el formulario de arriba para agregar uno.
              </p>
            )}
          </div>

        </div>

      </div>
    </div>
  );
};

export default PerfilEnfermero;