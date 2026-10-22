import { useEffect, useRef, useState } from 'react';
import { requestApi as api, sesionActual } from '../api';
import { fechaHora, quienReviso } from './adminComun';

const PAGE_SIZE = 10;
const ROLES = {
  paciente: 'Paciente',
  enfermero: 'Enfermero',
  administrador: 'Administrador',
};

const MATRICULA = {
  verificada: ['Matrícula verificada', ''],
  rechazada: ['Matrícula rechazada', 'is-suspended'],
  pendiente: ['Matrícula en revisión', 'is-pending'],
  sin_cargar: ['Sin matrícula cargada', 'is-pending'],
};

function nombreUsuario(usuario) {
  if (!usuario) return '';
  return [usuario.nombre, usuario.apellido].filter(Boolean).join(' ') || 'Sin nombre';
}

function respuestaUsuariosValida(data) {
  return Array.isArray(data.usuarios) &&
    Number.isInteger(data.total_resultados) &&
    data.total_resultados >= 0 &&
    Number.isInteger(data.total_paginas) &&
    data.total_paginas >= 0 &&
    data.usuarios.every((usuario) =>
      Number.isInteger(usuario.id) &&
      typeof usuario.email === 'string' &&
      ['paciente', 'enfermero', 'administrador'].includes(usuario.rol) &&
      typeof usuario.suspendido === 'boolean',
    );
}

export default function AdminUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [rol, setRol] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);
  const [paginas, setPaginas] = useState(0);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [intent, setIntent] = useState(0);
  const [actualizando, setActualizando] = useState(null);
  const [seleccionado, setSeleccionado] = useState(null);
  const [errorAccion, setErrorAccion] = useState('');
  const dialog = useRef(null);
  const administradorId = String(sesionActual()?.sub);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setCargando(true);
      setError('');
      const params = new URLSearchParams({
        q: busqueda.trim(),
        page: String(pagina),
        per_page: String(PAGE_SIZE),
      });
      if (rol) params.set('rol', rol);
      if (estado) params.set('estado', estado);
      try {
        const data = await api(`/admin/usuarios?${params}`, {
          signal: controller.signal,
        });
        if (!respuestaUsuariosValida(data)) {
          throw new Error('La respuesta de usuarios no tiene el formato esperado.');
        }
        if (!controller.signal.aborted) {
          setUsuarios(data.usuarios);
          setTotal(data.total_resultados);
          setPaginas(data.total_paginas);
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setCargando(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [busqueda, rol, estado, pagina, intent]);

  function cambiarFiltro(setter, value) {
    setter(value);
    setPagina(1);
    setMensaje('');
  }

  async function cambiarSuspension(usuario) {
    const suspendido = !usuario.suspendido;
    setActualizando(usuario.id);
    setErrorAccion('');
    setMensaje('');
    try {
      const data = await api(`/admin/usuarios/${usuario.id}/suspension`, {
        method: 'PUT',
        body: { suspendido },
      });
      if (
        data.usuario?.id !== usuario.id ||
        data.usuario.suspendido !== suspendido
      ) {
        throw new Error('El servidor no confirmó el nuevo estado del usuario.');
      }
      setUsuarios((items) => items.map((item) =>
        item.id === usuario.id ? data.usuario : item,
      ));
      setMensaje(`${nombreUsuario(data.usuario)} ${suspendido ? 'suspendido' : 'reactivado'}.`);
      dialog.current?.close();
      setSeleccionado(null);
    } catch (err) {
      setErrorAccion(err.message);
    } finally {
      setActualizando(null);
    }
  }

  return (
    <div className="page-container admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Gestión de usuarios</h1>
          <p>Buscá cuentas y administrá su acceso a Enfered.</p>
        </div>
      </header>

      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}{' '}
          <button className="text-link" type="button" onClick={() => setIntent((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <section className="content-panel admin-users-panel" aria-label="Buscar usuarios">
        <div className="admin-filter-grid">
          <label className="field">
            Buscar por nombre o correo
            <input
              type="search"
              value={busqueda}
              onChange={(event) => cambiarFiltro(setBusqueda, event.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field">
            Rol
            <select value={rol} onChange={(event) => cambiarFiltro(setRol, event.target.value)}>
              <option value="">Todos los roles</option>
              <option value="paciente">Paciente</option>
              <option value="enfermero">Enfermero</option>
              <option value="administrador">Administrador</option>
            </select>
          </label>
          <label className="field">
            Estado
            <select value={estado} onChange={(event) => cambiarFiltro(setEstado, event.target.value)}>
              <option value="">Todos los estados</option>
              <option value="activo">Activos</option>
              <option value="suspendido">Suspendidos</option>
            </select>
          </label>
        </div>
        <p className="admin-results-count">
          {cargando ? 'Buscando usuarios…' : `${total} usuario${total === 1 ? '' : 's'}`}
        </p>
      </section>

      {cargando ? (
        <p role="status">Cargando usuarios…</p>
      ) : error ? null : usuarios.length ? (
        <>
          <div className="admin-user-list" aria-busy={actualizando !== null}>
            {usuarios.map((usuario) => {
              const suspendido = usuario.suspendido === true;
              const esPropio = String(usuario.id) === administradorId;
              const matricula = usuario.rol === 'enfermero' ? MATRICULA[usuario.estadoVerificacion] : null;
              return (
                <article className="content-panel admin-user-card" key={usuario.id}>
                  <div className="admin-user-details">
                    <h2>{nombreUsuario(usuario)}</h2>
                    <p>{usuario.email}</p>
                    <div className="admin-user-tags">
                      <span className="specialty-tag">{ROLES[usuario.rol]}</span>
                      <span className={`admin-user-status ${suspendido ? 'is-suspended' : ''}`}>
                        {suspendido ? 'Suspendido' : 'Activo'}
                      </span>
                      {matricula && (
                        <span className={`admin-user-status ${matricula[1]}`}>{matricula[0]}</span>
                      )}
                    </div>
                    {usuario.rol === 'enfermero' && usuario.estadoVerificacion === 'rechazada' && usuario.motivoRechazo && (
                      <p className="admin-review-note"><strong>Motivo del rechazo:</strong> {usuario.motivoRechazo}</p>
                    )}
                    {usuario.rol === 'enfermero' && usuario.verificadoEn && (
                      <p className="admin-review-meta">
                        Matrícula revisada el {fechaHora(usuario.verificadoEn)}
                        {quienReviso(usuario.verificadoPor) ? ` por ${quienReviso(usuario.verificadoPor)}` : ''}.
                      </p>
                    )}
                  </div>
                  <button
                    className={suspendido ? 'button button-secondary' : 'button button-primary'}
                    type="button"
                    disabled={actualizando !== null || esPropio}
                    title={esPropio ? 'No podés suspender tu propia cuenta' : undefined}
                    onClick={() => {
                      setSeleccionado(usuario);
                      setErrorAccion('');
                      dialog.current?.showModal();
                    }}
                  >
                    {actualizando === usuario.id
                      ? 'Actualizando…'
                      : suspendido ? 'Reactivar' : 'Suspender'}
                  </button>
                </article>
              );
            })}
          </div>
          {paginas > 1 && (
            <nav className="admin-pagination" aria-label="Paginación de usuarios">
              <button
                className="button button-secondary"
                type="button"
                disabled={pagina <= 1 || cargando}
                onClick={() => setPagina((value) => value - 1)}
              >
                Anterior
              </button>
              <span>Página {pagina} de {paginas}</span>
              <button
                className="button button-secondary"
                type="button"
                disabled={pagina >= paginas || cargando}
                onClick={() => setPagina((value) => value + 1)}
              >
                Siguiente
              </button>
            </nav>
          )}
        </>
      ) : (
        <div className="content-panel empty-state">
          <h2>No encontramos usuarios</h2>
          <p>Probá con otro nombre, correo o filtro.</p>
        </div>
      )}
      <dialog
        className="content-panel admin-confirm-dialog"
        ref={dialog}
        aria-labelledby="admin-confirm-title"
        onCancel={(event) => {
          if (actualizando !== null) event.preventDefault();
          else setSeleccionado(null);
        }}
      >
        <h2 id="admin-confirm-title">
          {seleccionado?.suspendido ? '¿Reactivar esta cuenta?' : '¿Suspender esta cuenta?'}
        </h2>
        <p>
          {seleccionado?.suspendido
            ? `${nombreUsuario(seleccionado)} podrá volver a iniciar sesión.`
            : `${nombreUsuario(seleccionado)} perderá el acceso hasta que se reactive su cuenta.`}
        </p>
        {seleccionado?.rol === 'administrador' && (
          <p className="notice notice-info">
            Es una cuenta de administrador: solo un administrador con permiso total puede suspenderla o reactivarla.
          </p>
        )}
        {errorAccion && <p className="notice notice-error" role="alert">{errorAccion}</p>}
        <div className="admin-dialog-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={actualizando !== null}
            onClick={() => {
              dialog.current?.close();
              setSeleccionado(null);
            }}
          >
            Cancelar
          </button>
          <button
            className={seleccionado?.suspendido ? 'button button-secondary' : 'button button-primary'}
            type="button"
            disabled={actualizando !== null || !seleccionado}
            onClick={() => cambiarSuspension(seleccionado)}
          >
            {actualizando !== null
              ? 'Actualizando…'
              : seleccionado?.suspendido ? 'Sí, reactivar' : 'Sí, suspender'}
          </button>
        </div>
      </dialog>
    </div>
  );
}
