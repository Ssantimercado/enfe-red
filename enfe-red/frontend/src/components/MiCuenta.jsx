import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cerrarSesion, guardarSesion, requestApi as api } from '../api';
import Icon from './ui/Icon';
import { errorPasswordNueva, MIN_PASSWORD } from './reglasPassword';
import './MiCuenta.css';

function usuarioGuardado() {
  try {
    return JSON.parse(localStorage.getItem('usuario')) || undefined;
  } catch {
    return undefined;
  }
}

// Ley 25.326: la persona puede cambiar su contraseña, descargar sus datos y eliminar su cuenta.
export default function MiCuenta({ rol }) {
  const [cambiando, setCambiando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  async function descargarDatos() {
    if (descargando) return;
    setDescargando(true);
    setAviso('');
    setError('');
    try {
      // El archivo pide la sesión: se baja con el token y se guarda con un enlace temporal.
      const datos = await api('/cuenta/exportar');
      const archivo = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'enfered-mis-datos.json';
      document.body.append(enlace);
      enlace.click();
      enlace.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setAviso('Listo: descargamos el archivo "enfered-mis-datos.json" con tus datos.');
    } catch (err) {
      setError(err.message);
    } finally {
      setDescargando(false);
    }
  }

  return (
    <section className="content-panel mi-cuenta" aria-labelledby="mi-cuenta-titulo">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">SEGURIDAD Y PRIVACIDAD</span>
          <h2 id="mi-cuenta-titulo">Mi cuenta</h2>
        </div>
        <Icon name="lock" size={26} />
      </div>
      {aviso && <p className="notice notice-success" role="status">{aviso}</p>}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="mi-cuenta-opciones">
        <div className="mi-cuenta-opcion">
          <h3>Contraseña</h3>
          {cambiando ? (
            <CambiarPassword
              onListo={() => {
                setCambiando(false);
                setAviso('Tu contraseña se cambió. Por seguridad cerramos la sesión en tus otros dispositivos.');
              }}
              onCancelar={() => setCambiando(false)}
            />
          ) : (
            <>
              <p>Cambiala si creés que otra persona la conoce.</p>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setAviso('');
                  setError('');
                  setCambiando(true);
                }}
              >
                Cambiar contraseña
              </button>
            </>
          )}
        </div>
        <div className="mi-cuenta-opcion">
          <h3>Tus datos</h3>
          <p>Bajá un archivo con todo lo que Enfered guarda de tu cuenta.</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={descargarDatos}
            disabled={descargando}
          >
            {descargando ? 'Preparando tus datos…' : 'Descargar mis datos'}
          </button>
        </div>
        <div className="mi-cuenta-opcion">
          <h3>Eliminar la cuenta</h3>
          <p>Borra tus datos personales de Enfered. No se puede deshacer.</p>
          <button
            type="button"
            className="button button-peligro"
            onClick={() => {
              setAviso('');
              setError('');
              setEliminando(true);
            }}
          >
            Eliminar mi cuenta
          </button>
        </div>
      </div>
      {eliminando && <DialogoEliminar rol={rol} onCerrar={() => setEliminando(false)} />}
    </section>
  );
}

function CambiarPassword({ onListo, onCancelar }) {
  const [datos, setDatos] = useState({ actual: '', nueva: '', repetida: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const cambiar = (event) => setDatos((actual) => ({ ...actual, [event.target.name]: event.target.value }));

  async function guardar(event) {
    event.preventDefault();
    if (enviando) return;
    const problema = errorPasswordNueva(datos.nueva)
      || (datos.nueva !== datos.repetida ? 'Las dos contraseñas nuevas no coinciden. Escribila igual en los dos campos.' : '');
    if (problema) {
      setError(problema);
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const respuesta = await api('/perfil/password', {
        method: 'PUT',
        body: { password_actual: datos.actual, password_nueva: datos.nueva },
      });
      // Los tokens anteriores dejan de valer: se guardan los nuevos que devuelve el backend.
      if (respuesta.token) guardarSesion({ ...respuesta, usuario: usuarioGuardado() });
      onListo();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="form-stack mi-cuenta-form" onSubmit={guardar} aria-busy={enviando}>
      <label className="field">
        Contraseña actual
        <input
          type="password"
          name="actual"
          autoComplete="current-password"
          value={datos.actual}
          onChange={cambiar}
          required
          disabled={enviando}
        />
      </label>
      <label className="field">
        Contraseña nueva
        <input
          type="password"
          name="nueva"
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          aria-describedby="password-nueva-pista"
          value={datos.nueva}
          onChange={cambiar}
          required
          disabled={enviando}
        />
        <span id="password-nueva-pista" className="filter-hint">Al menos {MIN_PASSWORD} caracteres.</span>
      </label>
      <label className="field">
        Repetí la contraseña nueva
        <input
          type="password"
          name="repetida"
          autoComplete="new-password"
          value={datos.repetida}
          onChange={cambiar}
          required
          disabled={enviando}
        />
      </label>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button className="button button-primary" disabled={enviando}>
          {enviando ? 'Guardando…' : 'Guardar contraseña'}
        </button>
        <button className="button button-secondary" type="button" disabled={enviando} onClick={onCancelar}>
          Volver
        </button>
      </div>
    </form>
  );
}

// Se monta al abrirse, como los otros diálogos: cada vez empieza vacío.
function DialogoEliminar({ rol, onCerrar }) {
  const dialog = useRef(null);
  const campo = useRef(null);
  const ocupado = useRef(false);
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmado, setConfirmado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const actual = dialog.current;
    actual.showModal();
    campo.current?.focus();
    return () => actual.close();
  }, []);

  function cerrar() {
    if (!ocupado.current) onCerrar();
  }

  async function eliminar(event) {
    event.preventDefault();
    if (ocupado.current) return;
    if (!password) {
      setError('Escribí tu contraseña para confirmar que querés eliminar la cuenta.');
      return;
    }
    if (!confirmado) {
      setError('Marcá la casilla para confirmar que entendés que no se puede deshacer.');
      return;
    }
    ocupado.current = true;
    setEnviando(true);
    setError('');
    try {
      const respuesta = await api('/cuenta', { method: 'DELETE', body: { password } });
      cerrarSesion();
      navigate('/', {
        replace: true,
        state: { cuentaEliminada: respuesta.mensaje || 'Tu cuenta se eliminó. Gracias por haber usado Enfered.' },
      });
    } catch (err) {
      setError(err.message);
      ocupado.current = false;
      setEnviando(false);
    }
  }

  return (
    <dialog
      className="content-panel cuenta-dialogo"
      ref={dialog}
      aria-labelledby="eliminar-cuenta-titulo"
      aria-describedby="eliminar-cuenta-detalle"
      onCancel={(event) => {
        event.preventDefault();
        cerrar();
      }}
    >
      <form className="form-stack" onSubmit={eliminar} aria-busy={enviando}>
        <div id="eliminar-cuenta-detalle">
          <h2 id="eliminar-cuenta-titulo">¿Querés eliminar tu cuenta?</h2>
          <p>Si la eliminás:</p>
          <ul>
            <li>
              Borramos tus datos personales: nombre, teléfono, dirección y ubicación
              {rol === 'paciente' && ', y tu información de salud'}
              {rol === 'enfermero' && ', y tu matrícula, presentación y horarios'}.
            </li>
            {rol !== 'administrador' && (
              <li>
                Cancelamos tus turnos pendientes y los aceptados que todavía no pasaron, y le avisamos a la otra persona.
              </li>
            )}
            <li>Los mensajes y reseñas que escribiste quedan, pero sin tu nombre.</li>
            <li>No vas a poder volver a entrar con esta cuenta. Esto no se puede deshacer.</li>
          </ul>
          <p>Si querés guardar una copia, antes tocá “Descargar mis datos”.</p>
        </div>
        <label className="field">
          Tu contraseña
          <input
            ref={campo}
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={enviando}
          />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="confirmar"
            checked={confirmado}
            onChange={(event) => setConfirmado(event.target.checked)}
            disabled={enviando}
          />
          Entiendo que mi cuenta se elimina para siempre
        </label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="cuenta-dialogo-acciones">
          <button className="button button-secondary" type="button" disabled={enviando} onClick={cerrar}>
            No, volver
          </button>
          <button className="button button-peligro" type="submit" disabled={enviando}>
            {enviando ? 'Eliminando…' : 'Sí, eliminar mi cuenta'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
