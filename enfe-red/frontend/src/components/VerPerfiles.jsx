import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";

const API_URL = "http://localhost:5000";

function VerPerfiles() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const obtenerPerfil = async () => {
      try {
        setCargando(true);
        
        const token = localStorage.getItem("token");

        const respuesta = await axios.get(`${API_URL}/api/usuarios/${id}`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        
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

          <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
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

        </div>
      </div>
    </div>
  );
}

export default VerPerfiles;