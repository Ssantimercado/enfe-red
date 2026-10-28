import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api } from '../api';
import AuthLayout from './AuthLayout';
import Icon from './ui/Icon';
import { MIN_PASSWORD } from './reglasPassword';

export default function RecuperarPassword() {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function requestCode(otro = false) {
    await api('/recuperar-password', {
      method: 'POST', body: { email: email.trim() }, sesion: false,
    });
    setCode('');
    setPassword('');
    setNotice(
      otro
        ? 'Te enviamos un código nuevo a tu correo. Usá el más reciente.'
        : 'Te enviamos un código a tu correo. Revisá también el correo no deseado.',
    );
  }

  async function resend() {
    if (loading) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await requestCode(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (step === 1) await requestCode();
      else {
        await api('/reset-password', {
          method: 'POST',
          body: { email: email.trim(), codigo: code, nueva_password: password },
          sesion: false,
        });
        setCode('');
        setPassword('');
      }
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
      <h1 className="auth-title">Volvamos a conectar.</h1>
      <p className="auth-subtitle">
        {step === 1
          ? 'Ingresá el correo de tu cuenta para solicitar un código.'
          : step === 2
            ? 'Escribí el código de 6 números que te enviamos por correo y elegí una nueva contraseña.'
            : 'Tu contraseña se actualizó. Volvé a iniciar sesión.'}
      </p>
      {step === 2 && (
        <p className="notice notice-info">
          El código dura 10 minutos. Si no te llega, revisá que el correo sea el
          de tu cuenta y tocá “Solicitar otro código”.
        </p>
      )}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="notice notice-success" role="status">{notice}</p>
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
              disabled={loading}
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
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  disabled={loading}
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
                  minLength={MIN_PASSWORD}
                  aria-describedby="recuperar-password-pista"
                  disabled={loading}
                  required
                />
                <span id="recuperar-password-pista" className="filter-hint">
                  Al menos {MIN_PASSWORD} caracteres.
                </span>
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
      {step === 2 && (
        <div className="recovery-actions">
          <button type="button" className="text-link" disabled={loading} onClick={resend}>
            Solicitar otro código
          </button>
          <button
            type="button"
            className="text-link"
            disabled={loading}
            onClick={() => {
              setStep(1);
              setCode('');
              setPassword('');
              setError('');
              setNotice('');
            }}
          >
            Cambiar correo
          </button>
        </div>
      )}
      <p className="auth-switch">
        <Link to="/login">
          <Icon name="back" size={16} /> Volver a iniciar sesión
        </Link>
      </p>
    </AuthLayout>
  );
}
