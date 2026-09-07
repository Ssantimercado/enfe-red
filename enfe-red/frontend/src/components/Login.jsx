import { useState } from 'react';
import { useNavigate } from 'react-router-dom'; // 1. Importamos el hook de navegación

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  // 2. Inicializamos el navegador
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
        alert('¡Login exitoso! Token guardado en tu navegador.');
        setEmail('');
        setPassword('');

        navigate('/home');
        
        // Opcional: Redirigir al perfil del paciente después de un login exitoso
        // navigate('/perfil/paciente'); 

    } catch (err) {
        setError(err.message);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ textAlign: 'center', color: '#2c3e50' }}>Ingresar a ENFE-RED</h2>
      
      {error && (
        <div style={{ backgroundColor: '#ffcccc', padding: '10px', borderRadius: '5px', marginBottom: '15px', color: '#cc0000', textAlign: 'center' }}>
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: '5px', fontWeight: 'bold' }}>Email:</label>
            <input 
                type="email" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                required 
                style={{ padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ marginBottom: '5px', fontWeight: 'bold' }}>Contraseña:</label>
            <input 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required 
                style={{ padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
        </div>

        <button 
            type="submit" 
            style={{ padding: '12px', backgroundColor: '#3498db', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px', marginTop: '10px' }}
        >
          Iniciar Sesión
        </button>
        
        {/* Reemplazá el botón anterior por este bloque */}
          <div style={{ textAlign: 'center', marginTop: '15px' }}>
            <span style={{ color: '#7f8c8d', fontSize: '14px' }}>¿No tenés cuenta? </span>
            <button 
              type="button" 
              onClick={() => navigate('/registro')} 
              style={{ 
                background: 'none', 
                border: 'none', 
                color: '#3498db', 
                fontWeight: 'bold', 
                cursor: 'pointer', 
                padding: '0', 
                fontSize: '14px',
                textDecoration: 'underline' 
              }}
              >
                Crear cuenta
              </button>
              </div>
        
      </form>
    </div>
  );
};

export default Login;