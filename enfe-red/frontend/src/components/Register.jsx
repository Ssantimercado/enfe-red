import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { requestApi as api } from '../api';
import AuthLayout from './AuthLayout';
import Icon from './ui/Icon';
import './Legal.css';

export default function Register() {
  const [params] = useSearchParams();
  const [form, setForm] = useState({
    nombre: '',
    email: '',
    password: '',
    rol: params.get('rol') === 'enfermero' ? 'enfermero' : 'paciente',
  });
  // Ley 25.326: consentimiento expreso; el backend también lo exige.
  const [acepta, setAcepta] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const change = (e) =>
    setForm((current) => ({ ...current, [e.target.name]: e.target.value }));
  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    if (!acepta) {
      setError('Para crear la cuenta tenés que aceptar los Términos y condiciones y la Política de privacidad.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api('/registro', {
        method: 'POST',
        body: { ...form, nombre: form.nombre.trim(), email: form.email.trim(), aceptaTerminos: true },
      });
      setDone(true);
      setForm((current) => ({ ...current, password: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthLayout>
      {done ? (
        <>
          <span className="soft-icon mint">
            <Icon name="check" size={28} />
          </span>
          <h2 className="auth-title">Ya sos parte de la red.</h2>
          <p className="auth-subtitle" role="status">
            Tu cuenta está creada. Iniciá sesión para completar tu perfil y
            empezar.
          </p>
          <Link className="button button-primary button-full" to="/login">
            Ir a iniciar sesión
            <Icon name="arrow" size={17} />
          </Link>
        </>
      ) : (
        <>
          <span className="eyebrow">UNITE A ENFE-RED</span>
          <h2 className="auth-title">El primer paso es conectar.</h2>
          <p className="auth-subtitle">
            Creá tu cuenta y encontrá tu lugar en la red.
          </p>
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <form className="form-stack" onSubmit={submit} aria-busy={loading}>
            <fieldset className="role-options">
              <legend>¿Cómo vas a usar Enfe-red?</legend>
              <div>
                <label className="role-option">
                  <input
                    type="radio"
                    name="rol"
                    value="paciente"
                    checked={form.rol === 'paciente'}
                    onChange={change}
                  />
                  Busco cuidados
                </label>
                <label className="role-option">
                  <input
                    type="radio"
                    name="rol"
                    value="enfermero"
                    checked={form.rol === 'enfermero'}
                    onChange={change}
                  />
                  Soy enfermero/a
                </label>
              </div>
            </fieldset>
            <label className="field">
              Nombre y apellido
              <input
                autoComplete="name"
                name="nombre"
                value={form.nombre}
                onChange={change}
                required
                placeholder="Tu nombre completo"
              />
            </label>
            <label className="field">
              Correo electrónico
              <input
                autoComplete="email"
                type="email"
                name="email"
                value={form.email}
                onChange={change}
                required
                placeholder="tu@email.com"
              />
            </label>
            <label className="field">
              Contraseña
              <span className="input-icon">
                <Icon name="lock" size={18} />
                <input
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={change}
                  required
                  placeholder="Creá tu contraseña"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={
                    visible ? 'Ocultar contraseña' : 'Mostrar contraseña'
                  }
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
                </button>
              </span>
            </label>
            <label className="consentimiento">
              <input
                type="checkbox"
                name="aceptaTerminos"
                checked={acepta}
                onChange={(e) => setAcepta(e.target.checked)}
                required
              />
              <span>
                Leí y acepto los{' '}
                <Link to="/terminos" target="_blank" rel="noopener">Términos y condiciones</Link> y la{' '}
                <Link to="/privacidad" target="_blank" rel="noopener">Política de privacidad</Link>, y
                presto mi consentimiento para el tratamiento de mis datos personales
                {form.rol === 'paciente' ? ', incluidos los datos de salud que cargue,' : ''} según la
                Ley 25.326.
              </span>
            </label>
            <button
              className="button button-primary button-full"
              disabled={loading}
            >
              {loading ? 'Creando tu cuenta…' : 'Crear cuenta'}
              {!loading && <Icon name="arrow" size={17} />}
            </button>
          </form>
          <p className="auth-switch">
            ¿Ya tenés una cuenta? <Link to="/login">Iniciá sesión</Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
