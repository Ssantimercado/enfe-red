import { useState } from 'react';

const Login = () => {
  // Estados para manejar lo que se escribe en los inputs
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Función que se ejecuta al darle al botón "Iniciar Sesión"
  const handleSubmit = async (e) => {
    e.preventDefault(); // Evita que la página recargue
    setError('');

    try {
        // Hacemos la petición a tu backend en Flask (puerto 5000)
        const response = await fetch('http://localhost:5000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        // Si Flask nos devuelve un error (ej. credenciales incorrectas)
        if (!response.ok) {
            throw new Error(data.error || 'Error al iniciar sesión');
        }

        // Si todo sale bien, guardamos el token y limpiamos el formulario
        localStorage.setItem('token', data.token);
        alert('¡Login exitoso! Token guardado en tu navegador.');
        setEmail('');
        setPassword('');

    } catch (err) {
        setError(err.message);
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '50px auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ textAlign: 'center', color: '#2c3e50' }}>Ingresar a ENFE-RED</h2>
      
      {/* Caja de error visual por si ponen mal la clave */}
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
        
      </form>
    </div>
  );
};

export default Login;
