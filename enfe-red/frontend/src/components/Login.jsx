import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import Icon from './ui/Icon';
import { API_URL, cerrarSesion } from '../api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok || !data.token)
        throw new Error(
          data.error || 'No pudimos iniciar tu sesión. Revisá tus datos.',
        );
      cerrarSesion();
      localStorage.setItem('token', data.token);
      localStorage.setItem('rol', data.rol || 'paciente');
      if (data.usuario)
        localStorage.setItem('usuario', JSON.stringify(data.usuario));
      else localStorage.removeItem('usuario');
      const destination = location.state?.from;
      navigate(
        destination?.startsWith('/') && !destination.startsWith('//')
          ? destination
          : '/home',
        { replace: true },
      );
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'No podemos conectar con el servidor. Intentá nuevamente.'
          : err.message,
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthLayout>
      <span className="eyebrow">TU ESPACIO DE CUIDADO</span>
      <h2 className="auth-title">Qué bueno verte.</h2>
      <p className="auth-subtitle">
        Ingresá a tu cuenta para seguir conectando.
      </p>
      {new URLSearchParams(location.search).get('sesion') === 'expirada' && (
        <div className="notice notice-info" role="status">
          Tu sesión terminó. Volvé a iniciar sesión.
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <form className="form-stack" onSubmit={handleSubmit} aria-busy={loading}>
        <label className="field">
          Correo electrónico
          <span className="input-icon">
            <Icon name="mail" />
            <input
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </span>
        </label>
        <label className="field">
          Contraseña
          <span className="input-icon">
            <Icon name="lock" />
            <input
              type={visible ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Ingresá tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="icon-button"
              aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              <Icon name={visible ? 'eyeOff' : 'eye'} size={19} />
            </button>
          </span>
        </label>
        <button
          className="button button-primary button-full"
          disabled={loading}
        >
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
          {!loading && <Icon name="arrow" size={18} />}
        </button>
      </form>
      <p className="auth-switch">
        <Link to="/recuperar-password">¿Olvidaste tu contraseña?</Link>
      </p>
      <p className="auth-switch">
        ¿Todavía no tenés una cuenta? <Link to="/registro">Registrate</Link>
      </p>
      <div className="auth-note">
        <Icon name="heart" size={18} />
        <p>
          Para quienes necesitan cuidado.
          <br />
          Para quienes hacen del cuidado su profesión.
        </p>
      </div>
    </AuthLayout>
  );
}
