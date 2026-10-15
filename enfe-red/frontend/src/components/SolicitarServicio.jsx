import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { crearSolicitud, obtenerProfesional, errorSolicitud } from '../services/solicitudes';
import './Solicitudes.css';

export default function SolicitarServicio() {
  const { id } = useParams();
  const navigate = useNavigate();
  const ocupado = useRef(false);
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState(false);
  const [datos, setDatos] = useState({ idServicio: '', fecha: '', hora: '', direccionAtencion: '' });
  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    obtenerProfesional(id, controller.signal).then(setPerfil).catch(err => {
      if (!controller.signal.aborted) setError(errorSolicitud(err));
    }).finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [id]);
  const servicios = Array.isArray(perfil?.servicios) ? perfil.servicios : [];
  const habilitado = perfil?.verificado === true && perfil?.disponible === true && servicios.length > 0;
  const ahora = new Date();
  const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
  const cambiar = event => setDatos(actual => ({ ...actual, [event.target.name]: event.target.value }));
  async function enviar(event) {
    event.preventDefault();
    if (ocupado.current || creada || !habilitado) return;
    setError('');
    const fechaHora = new Date(`${datos.fecha}T${datos.hora}`);
    if (!Number.isFinite(fechaHora.getTime()) || fechaHora <= new Date()) { setError('Elegí una fecha y hora futuras.'); return; }
    if (!datos.direccionAtencion.trim()) { setError('Ingresá la dirección de atención.'); return; }
    if (!servicios.some(s => String(s.idServicio) === datos.idServicio)) { setError('Seleccioná un servicio disponible.'); return; }
    ocupado.current = true;
    setEnviando(true);
    try {
      const respuesta = await crearSolicitud({ ...datos, idServicio: Number(datos.idServicio), idEnfermero: perfil.enfermero_id, direccionAtencion: datos.direccionAtencion.trim() });
      setCreada(true);
      if (!respuesta.idSolicitud) { setError('El servidor recibió la solicitud, pero no devolvió el número de comprobante. No vuelvas a enviarla; consultá tus solicitudes.'); return; }
      navigate(`/solicitudes/${respuesta.idSolicitud}`, { replace: true });
    } catch (err) { setError(errorSolicitud(err)); }
    finally { ocupado.current = false; setEnviando(false); }
  }
  return <main className="solicitud-panel">
    <h1>Solicitar servicio</h1>
    <Link to={`/perfil/${id}`}>Volver al perfil</Link>
    {cargando ? <p role="status">Cargando servicios…</p> : perfil && <>
      <h2>{perfil.nombre} {perfil.apellido}</h2>
      {!habilitado && <p role="status">Este profesional todavía no tiene servicios habilitados para solicitar. Debe estar verificado, disponible y tener un catálogo de servicios.</p>}
      <form onSubmit={enviar}>
        <label>Tipo de servicio<select name="idServicio" value={datos.idServicio} onChange={cambiar} required disabled={!habilitado || enviando || creada}>
          <option value="">Seleccioná un servicio</option>
          {servicios.map(s => <option key={s.idServicio} value={s.idServicio}>{s.tipoServicio}</option>)}
        </select></label>
        <label>Fecha<input type="date" name="fecha" min={hoy} required value={datos.fecha} onChange={cambiar} disabled={enviando || creada} /></label>
        <label>Hora<input type="time" name="hora" required value={datos.hora} onChange={cambiar} disabled={enviando || creada} /></label>
        <label>Dirección de atención<input name="direccionAtencion" autoComplete="street-address" maxLength={255} required value={datos.direccionAtencion} onChange={cambiar} disabled={enviando || creada} /></label>
        <p>La solicitud quedará pendiente de aceptación del profesional. El servidor comprobará la disponibilidad del turno.</p>
        <button disabled={!habilitado || !perfil.enfermero_id || enviando || creada}>{enviando ? 'Enviando…' : 'Enviar solicitud'}</button>
      </form>
    </>}
    {error && <p className="solicitud-error" role="alert">{error}</p>}
  </main>;
}
