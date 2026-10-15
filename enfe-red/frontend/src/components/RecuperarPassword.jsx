import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';
import AuthLayout from './AuthLayout';
import Icon from './ui/Icon';

export default function RecuperarPassword() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await api(step === 1 ? '/recuperar-password' : '/reset-password', {
        method: 'POST',
        body:
          step === 1
            ? { email: email.trim() }
            : { email: email.trim(), codigo: code, nueva_password: password },
      });
      setStep(step + 1);
    } catch (err) {
      setError(
        err.message ||
          'No pudimos completar la recuperación. Intentá nuevamente.',
      );
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthLayout>
      <span className="eyebrow">RECUPERÁ TU ACCESO</span>
      <h2 className="auth-title">Volvamos a conectar.</h2>
      <p className="auth-subtitle">
        {step === 1
          ? 'Ingresá el correo de tu cuenta para solicitar un código.'
          : step === 2
            ? 'Ingresá el código de prueba y elegí una nueva contraseña.'
            : 'Tu contraseña se actualizó. Volvé a iniciar sesión.'}
      </p>
      {step < 3 && (
        <div className="notice notice-info" role="status">
          Modo de prueba: todavía no se envían correos. Si la cuenta existe, el
          código aparece en la consola del servidor y dura 10 minutos.
        </div>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {step < 3 && (
        <form className="form-stack" onSubmit={submit}>
          <label className="field">
            Correo electrónico
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              readOnly={step === 2}
            />
          </label>
          {step === 2 && (
            <>
              <label className="field">
                Código
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <label className="field">
                Nueva contraseña
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </label>
            </>
          )}
          <button
            className="button button-primary button-full"
            disabled={loading}
          >
            {loading
              ? 'Procesando…'
              : step === 1
                ? 'Solicitar código'
                : 'Guardar contraseña'}
          </button>
        </form>
      )}
      <p className="auth-switch">
        <Link to="/login">
          <Icon name="back" size={16} /> Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
