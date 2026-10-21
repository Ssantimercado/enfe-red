import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { crearSolicitud, obtenerProfesional, obtenerServicios, errorSolicitud } from '../services/solicitudes';
import './Solicitudes.css';

export default function SolicitarServicio() {
  const { id } = useParams();
  const ocupado = useRef(false);
  const [perfil, setPerfil] = useState(null);
  const [servicios, setServicios] = useState([]);
  const [intento, setIntento] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState(false);
  const [datos, setDatos] = useState({ idServicio: '', fecha: '', hora: '', direccionAtencion: '' });
  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    setPerfil(null);
    setServicios([]);
    Promise.all([obtenerProfesional(id, controller.signal), obtenerServicios(controller.signal)]).then(([profesional, catalogo]) => {
      if (!Array.isArray(catalogo)) throw new Error('Catálogo inválido');
      if (!controller.signal.aborted) { setPerfil(profesional); setServicios(catalogo); }
    }).catch(err => {
      if (!controller.signal.aborted) setError(errorSolicitud(err));
    }).finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [id, intento]);
  const idEnfermero = perfil?.enfermero_id ?? perfil?.idEnfermero ?? perfil?.id ?? null;
  const catalogoDisponible = servicios.length > 0;
  const profesionalHabilitado = perfil?.verificado === true && perfil?.disponible === true;
  const habilitado = profesionalHabilitado && catalogoDisponible && !!idEnfermero;
  const ahora = new Date();
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  const cambiar = event => setDatos(actual => ({ ...actual, [event.target.name]: event.target.value }));
  async function enviar(event) {
    event.preventDefault();
    if (ocupado.current || creada || !habilitado) return;
    setError('');
    setSuccess('');
    const fechaHora = new Date(`${datos.fecha}T${datos.hora}`);
    if (!Number.isFinite(fechaHora.getTime()) || fechaHora <= new Date()) { setError('Elegí una fecha y hora futuras.'); return; }
    if (!datos.direccionAtencion.trim()) { setError('Ingresá la dirección de atención.'); return; }
    if (datos.direccionAtencion.trim().length > 200) { setError('La dirección admite hasta 200 caracteres.'); return; }
    if (!servicios.some(s => String(s.idServicio) === datos.idServicio)) { setError('Seleccioná un servicio disponible.'); return; }
    ocupado.current = true;
    setEnviando(true);
    try {
      const respuesta = await crearSolicitud({
        ...datos,
        idServicio: Number(datos.idServicio),
        idEnfermero: Number(idEnfermero),
        direccionAtencion: datos.direccionAtencion.trim(),
      });
      setCreada(true);
      const idSolicitud = respuesta.solicitud?.idSolicitud;
      const mensajeSuccess = respuesta.mensaje === 'Solicitud creada'
        ? '¡Solicitud creada!'
        : respuesta.mensaje || '¡Solicitud creada!';
      setSuccess(mensajeSuccess);
      if (!idSolicitud) {
        setError('El servidor recibió la solicitud, pero no devolvió el número de comprobante. No vuelvas a enviarla; consultá tus solicitudes.');
        return;
      }
      setDatos(actual => ({ ...actual, idSolicitud }));
    } catch (err) { setError(errorSolicitud(err)); }
    finally { ocupado.current = false; setEnviando(false); }
  }
  return <main className="page-container solicitud-page">
    <header className="page-heading"><h1>Solicitar servicio</h1>
    <Link className="button button-secondary" to={`/perfil/${id}`}>Volver al perfil</Link></header>
    <section className="content-panel">
    {cargando ? <p role="status">Cargando servicios…</p> : perfil && <>
      <h2>{perfil.nombre} {perfil.apellido}</h2>
      {!catalogoDisponible && <p className="notice notice-info" role="status">Todavía no hay tipos de servicio cargados en el catálogo. No se puede enviar la solicitud hasta que se agreguen servicios reales.</p>}
      {catalogoDisponible && perfil.verificado !== true && <p className="notice notice-info" role="status">Este profesional todavía no está verificado, por lo que no puede recibir solicitudes.</p>}
      {catalogoDisponible && perfil.verificado === true && perfil.disponible !== true && <p className="notice notice-info" role="status">Este profesional indicó que no está disponible para recibir solicitudes.</p>}
      <form className="form-stack" onSubmit={enviar}>
        <label className="field">Tipo de servicio<select name="idServicio" value={datos.idServicio} onChange={cambiar} required disabled={!catalogoDisponible || enviando || creada}>
          <option value="">Seleccioná un servicio</option>
          {servicios.map(s => <option key={s.idServicio} value={s.idServicio}>
            {s.tipoServicio} · {s.precioEstimado == null ? 'A consultar' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(s.precioEstimado)}
          </option>)}
        </select>{catalogoDisponible && <span className="field-hint">
          {servicios.find(s => String(s.idServicio) === String(datos.idServicio))?.descripcion || 'Elegí el servicio que necesitás.'}
        </span>}</label>
        <label className="field">Fecha<input type="date" name="fecha" lang="es-AR" min={hoy} required value={datos.fecha} onChange={cambiar} disabled={!catalogoDisponible || enviando || creada} /></label>
        <label className="field">Hora<input type="time" name="hora" required value={datos.hora} onChange={cambiar} disabled={!catalogoDisponible || enviando || creada} /></label>
        <label className="field">Dirección de atención<input name="direccionAtencion" autoComplete="street-address" maxLength={200} required value={datos.direccionAtencion} onChange={cambiar} disabled={!catalogoDisponible || enviando || creada} /></label>
        <p>La solicitud quedará pendiente de aceptación del profesional. El servidor comprobará la disponibilidad del turno.</p>
        <button className="button button-primary" disabled={!habilitado || !idEnfermero || enviando || creada}>{enviando ? 'Enviando…' : 'Enviar solicitud'}</button>
      </form>
    </>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {success && <div className="notice notice-success solicitud-success" role="status" aria-live="polite">
      <strong>{success}</strong>
      {datos.idSolicitud && <Link className="text-link" to={`/solicitudes/${datos.idSolicitud}`}>Ver comprobante de la solicitud</Link>}
    </div>}
    {!cargando && !perfil && <button className="button button-secondary" onClick={() => setIntento(i => i + 1)}>Reintentar carga</button>}
    </section>
  </main>;
}
