import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";

const API_URL = "http://localhost:5000";

function VerPerfiles() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [perfil, setPerfil] = useState(null);
  const [horarios, setHorarios] = useState([]); // <-- NUEVO ESTADO PARA LOS HORARIOS
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const obtenerDatos = async () => {
      try {
        setCargando(true);
        const token = localStorage.getItem("token");
        const config = { headers: { Authorization: `Bearer ${token}` } };

        // 1. Cargar Perfil
        const respuestaPerfil = await axios.get(`${API_URL}/api/usuarios/${id}`, config);
        setPerfil(respuestaPerfil.data);
        setError(null);

        // 2. Cargar Horarios de este enfermero (Preparado para el backend de Renzo)
        try {
          // Acá se asume que Renzo va a crear esta ruta pública o compartida para leer los horarios de un ID
          const respuestaHorarios = await axios.get(`${API_URL}/api/usuarios/${id}/horarios`, config);
          setHorarios(respuestaHorarios.data || []);
        } catch (errHorarios) {
          console.log("Los horarios aún no están disponibles o el endpoint falta.");
          setHorarios([]); // Lo dejamos vacío si falla, para que no rompa la página del perfil
        }

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

    obtenerDatos();
  }, [id]);

  // Pantallas de carga y error estilizadas
  if (cargando) return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', fontFamily: "'Segoe UI', Roboto, sans-serif" }}>
      <h3 style={{ color: '#3498db', fontWeight: '600' }}>⏳ Cargando perfil del profesional...</h3>
    </div>
  );

  if (error) return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '100px', fontFamily: "'Segoe UI', Roboto, sans-serif", flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ backgroundColor: '#fee2e2', padding: '20px 40px', borderRadius: '12px', border: '1px solid #f87171', color: '#ef4444', textAlign: 'center' }}>
        <h3 style={{ margin: '0 0 15px 0' }}>⚠️ {error}</h3>
        <button onClick={() => navigate('/cartilla')} style={{ padding: '10px 20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          Volver a la Cartilla
        </button>
      </div>
    </div>
  );

  // Filtramos solo los días que el enfermero marcó como activos
  const diasActivos = horarios.filter(h => h.activo);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '40px 20px', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        
        {/* Botón Volver */}
        <div style={{ marginBottom: '25px', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={() => navigate('/cartilla')}
            style={{ padding: '8px 16px', backgroundColor: '#ffffff', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}
          >
            ← Volver a la Cartilla
          </button>
        </div>

        {/* Tarjeta Principal */}
        <div style={{ backgroundColor: '#ffffff', padding: '35px', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #f1f5f9' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '25px', marginBottom: '30px' }}>
            {/* Avatar circular */}
            <div style={{ width: '80px', height: '80px', backgroundColor: '#e0f2fe', borderRadius: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', color: '#0284c7', fontSize: '28px', fontWeight: '800' }}>
              {perfil.nombre?.charAt(0)}{perfil.apellido?.charAt(0)}
            </div>
            <div>
              <h1 style={{ color: '#1e293b', margin: '0 0 5px 0', fontSize: '26px' }}>
                {perfil.nombre} {perfil.apellido}
              </h1>
              <span style={{ backgroundColor: '#dcfce7', color: '#166534', padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: '700' }}>
                🩺 {perfil.especialidad || 'General'}
              </span>
            </div>
          </div>

          <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '25px' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#334155', fontSize: '18px' }}>Datos Profesionales</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                <span style={{ color: '#64748b', fontWeight: '600' }}>Matrícula:</span>
                <span style={{ color: '#1e293b', fontWeight: '700' }}>{perfil.matricula || "No registrada"}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '10px' }}>
                <span style={{ color: '#64748b', fontWeight: '600' }}>Especialidad:</span>
                <span style={{ color: '#1e293b', fontWeight: '700' }}>{perfil.especialidad || "No especificada"}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b', fontWeight: '600' }}>Email de contacto:</span>
                <span style={{ color: '#1e293b', fontWeight: '700' }}>{perfil.email}</span>
              </div>
            </div>
          </div>

          {/* ==========================================
              NUEVA SECCIÓN: HORARIOS DEL ENFERMERO
              ========================================== */}
          <div style={{ backgroundColor: '#f0fdf4', padding: '20px', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#166534', fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              🕒 Horarios de Atención
            </h3>
            
            {diasActivos.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {diasActivos.map((dia, index) => (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: index !== diasActivos.length - 1 ? '1px solid #dcfce7' : 'none', paddingBottom: index !== diasActivos.length - 1 ? '10px' : '0' }}>
                    <span style={{ color: '#15803d', fontWeight: '700' }}>{dia.dia_semana}</span>
                    <span style={{ color: '#1e293b', fontWeight: '600' }}>
                      {dia.hora_inicio} a {dia.hora_fin} hs
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#64748b', padding: '10px 0', fontStyle: 'italic' }}>
                El profesional aún no ha configurado sus horarios.
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

export default VerPerfiles;