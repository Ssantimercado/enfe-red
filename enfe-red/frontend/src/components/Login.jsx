import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const navigate = useNavigate(); 

  const handleSubmit = async (e) => {
    e.preventDefault(); 
    setError('');

    try {
        const response = await fetch('http://localhost:5000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Error al iniciar sesión');
        }

        localStorage.setItem('token', data.token);
        if (data.rol) {
            localStorage.setItem('rol', data.rol);
        }
        
        setEmail('');
        setPassword('');

        navigate('/home'); 

    } catch (err) {
        setError(err.message);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh', fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif" }}>
      
      <div style={{ width: '100%', maxWidth: '420px', backgroundColor: '#ffffff', padding: '40px', borderRadius: '16px', boxShadow: '0 10px 25px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '35px' }}>
          <h2 style={{ color: '#2c3e50', fontSize: '28px', margin: '0 0 8px 0', fontWeight: '800' }}>
            Bienvenido a <span style={{ color: '#3498db' }}>ENFE-RED</span>
          </h2>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '15px' }}>Ingresá tus credenciales para continuar</p>
        </div>
        
        {error && (
          <div style={{ backgroundColor: '#fee2e2', padding: '12px', borderRadius: '8px', marginBottom: '25px', color: '#ef4444', textAlign: 'center', fontSize: '14px', border: '1px solid #f87171' }}>
            <strong>⚠️ {error}</strong>
          </div>
        )}
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Input de Email */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ marginBottom: '8px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Correo Electrónico</label>
              <input 
                  type="email" 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)} 
                  required
                  placeholder="ejemplo@correo.com"
                  style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }}
              />
          </div>

          {/* Input de Contraseña */}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label style={{ marginBottom: '8px', fontWeight: '600', color: '#34495e', fontSize: '14px' }}>Contraseña</label>
              <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  required 
                  placeholder="••••••••"
                  style={{ padding: '14px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px', backgroundColor: '#f8fafc', color: '#1e293b', outline: 'none' }}
              />
          </div>

          <button 
              type="submit" 
              style={{ padding: '16px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '10px', boxShadow: '0 4px 6px rgba(52, 152, 219, 0.2)' }}
          >
            Iniciar Sesión
          </button>
          
          <div style={{ textAlign: 'center', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #e2e8f0' }}>
            <span style={{ color: '#64748b', fontSize: '14px' }}>¿No tenés cuenta? </span>
            <button 
              type="button" 
              onClick={() => navigate('/registro')} 
              style={{ background: 'none', border: 'none', color: '#3498db', fontWeight: 'bold', cursor: 'pointer', padding: '0', fontSize: '14px' }}
            >
              Crear cuenta nueva
            </button>
          </div>
          
        </form>
      </div>
    </div>
  );
};

export default Login;