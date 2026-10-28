import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import Icon from './ui/Icon';
import { guardarSesion, requestApi, rutaInterna } from '../api';

const SOPORTE = import.meta.env?.VITE_SOPORTE_EMAIL;

function AvisoMotivo({ motivo }) {
  if (motivo === 'suspendida')
    return (
      <div className="notice notice-error" role="alert">
        Tu cuenta no está activa, así que cerramos la sesión. Si creés que es un error, escribinos a{' '}
        {SOPORTE ? <a href={`mailto:${SOPORTE}`}>{SOPORTE}</a> : 'soporte de Enfered'}.
      </div>
    );
  if (motivo === 'expirada')
    return (
      <div className="notice notice-info" role="status">
        Tu sesión terminó. Volvé a iniciar sesión y te llevamos a donde estabas.
      </div>
    );
  return null;
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const avisoError = useRef(null);
  // Tras un error el foco va al mensaje: quien usa teclado o lector no tiene que volver a buscarlo desde arriba.
  useEffect(() => {
    if (error) avisoError.current?.focus();
  }, [error]);
  const navigate = useNavigate();
  const location = useLocation();
  const parametros = new URLSearchParams(location.search);
  // "sesion=expirada" es el formato anterior del aviso; se sigue aceptando.
  const motivo = parametros.get('motivo') || (parametros.get('sesion') === 'expirada' ? 'expirada' : null);
  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestApi('/login', {
        method: 'POST',
        body: { email: email.trim(), password },
        sesion: false,
      });
      if (!data.token) throw new Error('No pudimos iniciar tu sesión. Revisá tus datos.');
      guardarSesion(data);
      navigate(
        rutaInterna(parametros.get('volver')) || rutaInterna(location.state?.from)
          || (data.rol === 'administrador' ? '/admin' : '/home'),
        { replace: true },
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthLayout>
      <span className="eyebrow">TU ESPACIO DE CUIDADO</span>
      <h1 className="auth-title">Qué bueno verte.</h1>
      <p className="auth-subtitle">
        Ingresá a tu cuenta para seguir conectando.
      </p>
      {!error && <AvisoMotivo motivo={motivo} />}
      {error && (
        <div ref={avisoError} tabIndex={-1} id="login-error" className="notice notice-error" role="alert">
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
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
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
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'login-error' : undefined}
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
          aria-disabled={loading}
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
