import { useEffect, useState } from 'react';
import { formatPrice, requestApi as api } from '../api';
import DialogoMotivo from './DialogoMotivo';

// SCRUM-30/50: el administrador gestiona el catálogo (Servicio.actualizarPrecio / modificarDescripcion).
const VACIO = { tipoServicio: '', descripcion: '', precioEstimado: '', duracionMinutos: '60' };

function formularioDe(servicio) {
  return {
    tipoServicio: servicio.tipoServicio,
    descripcion: servicio.descripcion || '',
    precioEstimado: servicio.precioEstimado ?? '',
    duracionMinutos: String(servicio.duracionMinutos),
  };
}

function cuerpoDe(form) {
  return {
    tipoServicio: form.tipoServicio.trim(),
    descripcion: form.descripcion.trim(),
    // Vacío = "A consultar".
    precioEstimado: form.precioEstimado === '' ? null : form.precioEstimado,
    duracionMinutos: Number(form.duracionMinutos),
  };
}

function FormularioServicio({ id, inicial, textoGuardar, guardando, onGuardar, onCancelar }) {
  const [form, setForm] = useState(inicial);
  const cambiar = (e) => setForm((actual) => ({ ...actual, [e.target.name]: e.target.value }));
  return (
    <form
      className="admin-service-form"
      aria-busy={guardando}
      onSubmit={(e) => {
        e.preventDefault();
        onGuardar(cuerpoDe(form));
      }}
    >
      <label className="field">
        Nombre del servicio
        <input name="tipoServicio" value={form.tipoServicio} onChange={cambiar} required minLength={3}
          maxLength={100} disabled={guardando} />
      </label>
      <label className="field">
        Descripción para el paciente
        <textarea name="descripcion" rows={2} value={form.descripcion} onChange={cambiar} maxLength={255}
          disabled={guardando} />
      </label>
      <div className="admin-service-form-row">
        <label className="field">
          Precio de referencia (ARS)
          <input name="precioEstimado" type="number" inputMode="decimal" min="0" step="0.01"
            value={form.precioEstimado} onChange={cambiar} aria-describedby={`${id}-precio`} disabled={guardando} />
          <span className="field-hint" id={`${id}-precio`}>Dejalo vacío para mostrar “A consultar”.</span>
        </label>
        <label className="field">
          Duración del turno (minutos)
          <input name="duracionMinutos" type="number" inputMode="numeric" min="15" max="480" step="5"
            value={form.duracionMinutos} onChange={cambiar} required disabled={guardando} />
        </label>
      </div>
      <div className="form-actions">
        <button className="button button-primary" disabled={guardando}>
          {guardando ? 'Guardando…' : textoGuardar}
        </button>
        {onCancelar && (
          <button className="button button-secondary" type="button" disabled={guardando} onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export default function AdminServicios() {
  const [servicios, setServicios] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [intento, setIntento] = useState(0);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState('');
  const [baja, setBaja] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    api('/admin/servicios', { signal: controller.signal })
      .then((data) => {
        if (!Array.isArray(data?.servicios)) throw new Error('La respuesta del catálogo no tiene el formato esperado.');
        if (!controller.signal.aborted) setServicios(data.servicios);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [intento]);

  async function guardar(ruta, metodo, cuerpo, alTerminar) {
    setGuardando(true);
    setErrorForm('');
    setAviso('');
    try {
      const data = await api(ruta, { method: metodo, body: cuerpo });
      setServicios((actuales) => {
        const otros = actuales.filter((s) => s.idServicio !== data.servicio.idServicio);
        return [...otros, data.servicio].sort((a, b) =>
          Number(b.activo) - Number(a.activo) || a.tipoServicio.localeCompare(b.tipoServicio, 'es'));
      });
      setAviso(`${data.mensaje}: ${data.servicio.tipoServicio}.`);
      alTerminar();
    } catch (err) {
      setErrorForm(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="page-container admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Servicios</h1>
          <p>El catálogo que eligen los pacientes al pedir un turno y los profesionales en su perfil.</p>
        </div>
        {!creando && (
          <button className="button button-primary" type="button" onClick={() => { setCreando(true); setEditando(null); setErrorForm(''); }}>
            Agregar servicio
          </button>
        )}
      </header>

      {aviso && <p className="notice notice-success" role="status">{aviso}</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}{' '}
          <button className="text-link" type="button" onClick={() => setIntento((valor) => valor + 1)}>
            Reintentar
          </button>
        </div>
      )}

      {creando && (
        <section className="content-panel" aria-labelledby="nuevo-servicio">
          <h2 id="nuevo-servicio">Nuevo servicio</h2>
          {errorForm && <p className="notice notice-error" role="alert">{errorForm}</p>}
          <FormularioServicio
            id="nuevo"
            inicial={VACIO}
            textoGuardar="Crear servicio"
            guardando={guardando}
            onGuardar={(cuerpo) => guardar('/admin/servicios', 'POST', cuerpo, () => setCreando(false))}
            onCancelar={() => { setCreando(false); setErrorForm(''); }}
          />
        </section>
      )}

      {cargando ? (
        <p role="status">Cargando el catálogo…</p>
      ) : error ? null : servicios.length ? (
        <ul className="admin-service-list">
          {servicios.map((servicio) => (
            <li key={servicio.idServicio} className={`content-panel admin-service ${servicio.activo ? '' : 'inactive'}`}>
              {editando === servicio.idServicio ? (
                <>
                  <h2>Editar {servicio.tipoServicio}</h2>
                  {errorForm && <p className="notice notice-error" role="alert">{errorForm}</p>}
                  <FormularioServicio
                    id={`editar-${servicio.idServicio}`}
                    inicial={formularioDe(servicio)}
                    textoGuardar="Guardar cambios"
                    guardando={guardando}
                    onGuardar={(cuerpo) => guardar(`/admin/servicios/${servicio.idServicio}`, 'PUT', cuerpo,
                      () => setEditando(null))}
                    onCancelar={() => { setEditando(null); setErrorForm(''); }}
                  />
                </>
              ) : (
                <>
                  <div className="admin-service-top">
                    <h2>{servicio.tipoServicio}</h2>
                    <span className={`admin-service-badge ${servicio.activo ? "" : "inactive"}`}>
                      {servicio.activo ? 'Disponible' : 'Dado de baja'}
                    </span>
                  </div>
                  <p>{servicio.descripcion || 'Sin descripción.'}</p>
                  <dl className="admin-service-facts">
                    <div><dt>Precio de referencia</dt><dd>{formatPrice(servicio.precioEstimado)}</dd></div>
                    <div><dt>Duración del turno</dt><dd>{servicio.duracionMinutos} minutos</dd></div>
                    <div><dt>Profesionales que lo ofrecen</dt><dd>{servicio.enfermerosQueLoOfrecen}</dd></div>
                    <div><dt>Solicitudes</dt><dd>{servicio.solicitudes}</dd></div>
                  </dl>
                  <div className="form-actions">
                    <button className="button button-secondary" type="button" disabled={guardando}
                      onClick={() => { setEditando(servicio.idServicio); setCreando(false); setErrorForm(''); }}>
                      Editar
                    </button>
                    {servicio.activo ? (
                      <button className="button button-secondary" type="button" disabled={guardando}
                        onClick={() => { setBaja(servicio); setErrorForm(''); }}>
                        Dar de baja
                      </button>
                    ) : (
                      <button className="button button-secondary" type="button" disabled={guardando}
                        onClick={() => guardar(`/admin/servicios/${servicio.idServicio}`, 'PUT', { activo: true }, () => {})}>
                        Volver a ofrecer
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="content-panel empty-state">
          <h2>Todavía no hay servicios</h2>
          <p>Agregá el primero para que los pacientes puedan pedir turnos.</p>
        </div>
      )}

      <DialogoMotivo
        abierto={Boolean(baja)}
        titulo={`¿Dar de baja ${baja?.tipoServicio || 'el servicio'}?`}
        descripcion="Los pacientes ya no lo van a poder pedir y deja de aparecer en la cartilla. Los turnos ya pedidos no cambian y podés volver a ofrecerlo cuando quieras."
        textoConfirmar="Dar de baja"
        guardando={guardando}
        error={baja ? errorForm : ''}
        onConfirmar={() => guardar(`/admin/servicios/${baja.idServicio}`, 'PUT', { activo: false }, () => setBaja(null))}
        onCerrar={() => { setBaja(null); setErrorForm(''); }}
      />
    </div>
  );
}
