import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { guardarSesion, requestApi as api } from '../api';
import { MIN_PASSWORD } from './reglasPassword';
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
  // Campo con error de validación: el mensaje queda escrito debajo de ese campo (el globo del navegador desaparece solo).
  const [campoError, setCampoError] = useState(null);
  const formulario = useRef(null);
  const avisoError = useRef(null);
  useEffect(() => {
    if (campoError) {
      formulario.current?.elements[campoError]?.focus();
      // El mensaje está debajo del campo: se trae a la vista para que no quede tapado (por ejemplo, por el aviso de cookies).
      document.getElementById('registro-error')?.scrollIntoView?.({ block: 'nearest' });
    }
    else if (error) avisoError.current?.focus();
  }, [campoError, error]);
  const [visible, setVisible] = useState(false);
  const navigate = useNavigate();
  const change = (e) =>
    setForm((current) => ({ ...current, [e.target.name]: e.target.value }));
  function validar() {
    if (!form.nombre.trim()) return ['nombre', 'Escribí tu nombre y apellido.'];
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      return ['email', 'Escribí un correo válido, por ejemplo nombre@gmail.com.'];
    if (form.password.length < MIN_PASSWORD)
      return ['password', `La contraseña tiene que tener al menos ${MIN_PASSWORD} caracteres.`];
    if (!acepta)
      return ['aceptaTerminos', 'Para crear la cuenta tenés que aceptar los Términos y condiciones y la Política de privacidad.'];
    return null;
  }
  // Error junto al campo: se anuncia y queda escrito hasta que se corrija.
  const errorDe = (campo) => campoError === campo && (
    <span id="registro-error" className="field-error" role="alert">{error}</span>
  );
  const marcar = (campo, pista) => ({
    'aria-invalid': campoError === campo,
    'aria-describedby': [pista, campoError === campo && 'registro-error'].filter(Boolean).join(' ') || undefined,
  });
  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    const invalido = validar();
    if (invalido) {
      setCampoError(invalido[0]);
      setError(invalido[1]);
      return;
    }
    setLoading(true);
    setCampoError(null);
    setError('');
    const email = form.email.trim();
    try {
      await api('/registro', {
        method: 'POST',
        body: { ...form, nombre: form.nombre.trim(), email, aceptaTerminos: true },
        sesion: false,
      });
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    // Entra sola para que no tenga que volver a escribir los datos; si falla, va al login.
    try {
      const data = await api('/login', {
        method: 'POST',
        body: { email, password: form.password },
        sesion: false,
      });
      if (!data.token) throw new Error('Sin sesión');
      guardarSesion(data);
      navigate(data.rol === 'administrador' ? '/admin' : '/home', {
        replace: true,
        state: { recienRegistrado: true },
      });
    } catch {
      setDone(true);
      setForm((current) => ({ ...current, password: '' }));
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
          <h1 className="auth-title">Ya sos parte de la red.</h1>
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
          <span className="eyebrow">UNITE A ENFERED</span>
          <h1 className="auth-title">El primer paso es conectar.</h1>
          <p className="auth-subtitle">
            Creá tu cuenta y encontrá tu lugar en la red.
          </p>
          {error && !campoError && (
            <div ref={avisoError} tabIndex={-1} className="notice notice-error" role="alert">
              {error}
            </div>
          )}
          <form ref={formulario} className="form-stack" onSubmit={submit} aria-busy={loading} noValidate>
            <fieldset className="role-options">
              <legend>¿Cómo vas a usar Enfered?</legend>
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
                {...marcar('nombre')}
                placeholder="Tu nombre completo"
              />
              {errorDe('nombre')}
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
                {...marcar('email')}
                placeholder="tu@email.com"
              />
              {errorDe('email')}
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
                  minLength={MIN_PASSWORD}
                  {...marcar('password', 'registro-password-pista')}
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
              <span id="registro-password-pista" className="filter-hint">
                Al menos {MIN_PASSWORD} caracteres.
              </span>
              {errorDe('password')}
            </label>
            <label className="consentimiento">
              <input
                type="checkbox"
                name="aceptaTerminos"
                checked={acepta}
                onChange={(e) => setAcepta(e.target.checked)}
                required
                {...marcar('aceptaTerminos')}
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
            {errorDe('aceptaTerminos')}
            <button
              className="button button-primary button-full"
              aria-disabled={loading}
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
