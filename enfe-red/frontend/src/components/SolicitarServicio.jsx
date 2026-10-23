import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { requestApi as api, enlaceWhatsapp } from '../api';
import { DIAS_SEMANA, diaDeLaSemana, fechaLegible, fechaMaximaISO, hoyISO } from '../fechas';
import { crearSolicitud, obtenerProfesional, obtenerServicios, errorSolicitud } from '../services/solicitudes';
import './Solicitudes.css';

const DURACION_POR_DEFECTO = 60;
// Cada cuánto se ofrece un horario de inicio dentro de la franja del profesional.
const PASO_MINUTOS = 30;
const PLURAL = { Lunes: 'lunes', Martes: 'martes', Miércoles: 'miércoles', Jueves: 'jueves', Viernes: 'viernes', Sábado: 'sábados', Domingo: 'domingos' };
const MENSAJE_TELEFONO = 'Escribí el teléfono con código de área, sin 0 ni 15. Por ejemplo: 261 555 1234.';

// "Miercoles" y "Miércoles" son el mismo día, igual que en el backend.
const sinTildes = (texto) => String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const aMinutos = (hora) => { const [h, m] = String(hora || '').split(':').map(Number); return h * 60 + (m || 0); };
const aHora = (minutos) => `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
// La misma regla que usa el backend para guardar el teléfono (10 dígitos con código de área).
const telefonoValido = (telefono) => Boolean(enlaceWhatsapp(telefono));
const direccionDelPerfil = (direccion) => (direccion && direccion !== 'No registrada' ? direccion.slice(0, 200) : '');

function textoDuracion(minutos) {
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return [horas ? (horas === 1 ? '1 hora' : `${horas} horas`) : '', resto ? `${resto} minutos` : ''].filter(Boolean).join(' y ');
}

// Igual que el backend: una franja hasta las 23:59 llega a la medianoche.
const finEnMinutos = (hora) => (String(hora).slice(0, 5) === '23:59' ? 24 * 60 : aMinutos(hora));

// Franjas del mismo día que se tocan o se pisan (08:00-12:00 y 12:00-16:00) cuentan como una sola.
function unirFranjas(franjas) {
  const unidas = [];
  franjas
    .map(f => ({ desde: aMinutos(f.hora_inicio), hasta: finEnMinutos(f.hora_fin) }))
    .sort((a, b) => a.desde - b.desde)
    .forEach((franja) => {
      const ultima = unidas[unidas.length - 1];
      if (ultima && franja.desde <= ultima.hasta) ultima.hasta = Math.max(ultima.hasta, franja.hasta);
      else unidas.push({ ...franja });
    });
  return unidas;
}

const rangos = (franjas) => unirFranjas(franjas).map(f => `de ${aHora(f.desde)} a ${aHora(f.hasta)}`).join(' y ');

// Horarios de inicio en los que el turno entero (inicio + duración) entra en una franja.
function horariosDelDia(franjas, duracion, fecha) {
  const ahora = new Date();
  const minimo = fecha === hoyISO() ? ahora.getHours() * 60 + ahora.getMinutes() + 1 : 0;
  const opciones = [];
  for (const franja of unirFranjas(franjas)) {
    // Un turno puede terminar a la medianoche, pero no empezar a las 24:00.
    for (let inicio = franja.desde; inicio + duracion <= franja.hasta && inicio < 24 * 60; inicio += PASO_MINUTOS) {
      if (inicio >= minimo) opciones.push(aHora(inicio));
    }
  }
  return opciones;
}

export default function SolicitarServicio() {
  const { id } = useParams();
  const ocupado = useRef(false);
  const [perfil, setPerfil] = useState(null);
  const [paciente, setPaciente] = useState(null);
  const [servicios, setServicios] = useState([]);
  const [intento, setIntento] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [creada, setCreada] = useState(false);
  // 404 del perfil: el profesional ya no está en la cartilla (no disponible, sin verificar o suspendido).
  const [noDisponible, setNoDisponible] = useState(false);
  const [datos, setDatos] = useState({ idServicio: '', fecha: '', hora: '', direccionAtencion: '' });
  const [telefono, setTelefono] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    setNoDisponible(false);
    setPerfil(null);
    setServicios([]);
    Promise.all([
      obtenerProfesional(id, controller.signal),
      obtenerServicios(controller.signal),
      // Si el perfil propio no carga igual se puede pedir el turno: solo no se precarga nada.
      api('/perfil/paciente', { signal: controller.signal }).catch(() => null),
    ]).then(([profesional, catalogo, propio]) => {
      if (!Array.isArray(catalogo)) throw new Error('Catálogo inválido');
      if (controller.signal.aborted) return;
      setPerfil(profesional);
      // SCRUM-14/53: si el profesional declaró qué servicios hace, solo esos; si no, todo el catálogo.
      const ofrecidos = new Set((profesional?.servicios || []).map(s => s.idServicio));
      setServicios(ofrecidos.size ? catalogo.filter(s => ofrecidos.has(s.idServicio)) : catalogo);
      setPaciente(propio);
      const direccion = direccionDelPerfil(propio?.direccion);
      if (direccion) setDatos(actual => (actual.direccionAtencion ? actual : { ...actual, direccionAtencion: direccion }));
    }).catch(err => {
      if (controller.signal.aborted) return;
      if (err.response?.status === 404) setNoDisponible(true);
      else setError(errorSolicitud(err));
    }).finally(() => { if (!controller.signal.aborted) setCargando(false); });
    return () => controller.abort();
  }, [id, intento]);
  const idEnfermero = perfil?.enfermero_id ?? perfil?.idEnfermero ?? perfil?.id ?? null;
  const nombre = [perfil?.nombre, perfil?.apellido].filter(Boolean).join(' ') || 'El profesional';
  const catalogoDisponible = servicios.length > 0;
  const profesionalHabilitado = perfil?.verificado === true && perfil?.disponible === true;
  const habilitado = profesionalHabilitado && catalogoDisponible && !!idEnfermero;
  const bloqueado = !catalogoDisponible || enviando || creada;
  const servicio = servicios.find(s => String(s.idServicio) === String(datos.idServicio));
  const duracion = Number(servicio?.duracionMinutos) || DURACION_POR_DEFECTO;
  // Con horarios cargados el backend exige que el turno entre en ellos; sin horarios, cualquier hora.
  const franjas = (Array.isArray(perfil?.horarios) ? perfil.horarios : [])
    .filter(h => (h.estado || 'Disponible') === 'Disponible' && h.hora_inicio && h.hora_fin)
    .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
  const conAgenda = franjas.length > 0;
  const diaElegido = diaDeLaSemana(datos.fecha);
  const franjasDelDia = franjas.filter(f => sinTildes(f.dia_semana) === sinTildes(diaElegido));
  const opciones = horariosDelDia(franjasDelDia, duracion, datos.fecha);
  const agenda = DIAS_SEMANA
    .map(dia => [dia, franjas.filter(f => sinTildes(f.dia_semana) === sinTildes(dia))])
    .filter(([, delDia]) => delDia.length)
    .map(([dia, delDia]) => `${dia} ${rangos(delDia)}`);
  const pideTelefono = paciente !== null && !telefonoValido(paciente.telefono);
  const cambiar = event => {
    const { name, value } = event.target;
    // Al cambiar el día o el servicio cambian los horarios posibles: la hora elegida se vuelve a pedir.
    setDatos(actual => ({ ...actual, [name]: value, ...(conAgenda && name !== 'hora' && name !== 'direccionAtencion' ? { hora: '' } : {}) }));
  };
  async function enviar(event) {
    event.preventDefault();
    if (ocupado.current || creada || !habilitado) return;
    setError('');
    setSuccess('');
    const fechaHora = new Date(`${datos.fecha}T${datos.hora}`);
    if (!servicios.some(s => String(s.idServicio) === datos.idServicio)) { setError('Seleccioná un servicio disponible.'); return; }
    if (conAgenda && datos.fecha && !opciones.includes(datos.hora)) { setError('Elegí uno de los horarios disponibles de ese día.'); return; }
    if (!Number.isFinite(fechaHora.getTime()) || fechaHora <= new Date()) { setError('Elegí una fecha y hora futuras.'); return; }
    if (!datos.direccionAtencion.trim()) { setError('Ingresá la dirección de atención.'); return; }
    if (datos.direccionAtencion.trim().length > 200) { setError('La dirección admite hasta 200 caracteres.'); return; }
    if (pideTelefono && !telefonoValido(telefono)) { setError(MENSAJE_TELEFONO); return; }
    ocupado.current = true;
    setEnviando(true);
    try {
      if (pideTelefono) {
        // Se guarda en el perfil antes del pedido: el profesional lo necesita para avisar.
        try {
          const actualizado = await api('/perfil/paciente', { method: 'PUT', body: { telefono: telefono.trim() } });
          setPaciente(actual => ({ ...actual, ...actualizado, telefono: actualizado?.telefono || telefono.trim() }));
        } catch (err) { setError(err.message); return; }
      }
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
  // AppShell ya tiene el <main>: acá va un contenedor común para no anidarlo.
  return <div className="page-container solicitud-page">
    <header className="page-heading"><h1>Solicitar servicio</h1>
    <Link className="button button-secondary" to={`/perfil/${id}`}>Volver al perfil</Link></header>
    <section className="content-panel">
    {cargando ? <p role="status">Cargando servicios…</p> : perfil && <>
      <h2>{perfil.nombre} {perfil.apellido}</h2>
      {!catalogoDisponible && <p className="notice notice-info" role="status">Todavía no hay tipos de servicio cargados en el catálogo. No se puede enviar la solicitud hasta que se agreguen servicios reales.</p>}
      {catalogoDisponible && perfil.verificado !== true && <p className="notice notice-info" role="status">Este profesional todavía no está verificado, por lo que no puede recibir solicitudes.</p>}
      {catalogoDisponible && perfil.verificado === true && perfil.disponible !== true && <p className="notice notice-info" role="status">Este profesional indicó que no está disponible para recibir solicitudes.</p>}
      <form className="form-stack" onSubmit={enviar}>
        <label className="field">Tipo de servicio<select name="idServicio" value={datos.idServicio} onChange={cambiar} required disabled={bloqueado}>
          <option value="">Seleccioná un servicio</option>
          {servicios.map(s => <option key={s.idServicio} value={s.idServicio}>
            {s.tipoServicio} · {s.precioEstimado == null ? 'A consultar' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(s.precioEstimado)}
          </option>)}
        </select>{catalogoDisponible && <span className="field-hint">
          {servicio ? [servicio.descripcion, `El turno dura ${textoDuracion(duracion)}.`].filter(Boolean).join(' ') : 'Elegí el servicio que necesitás.'}
        </span>}</label>
        <label className="field">Fecha<input type="date" name="fecha" lang="es-AR" min={hoyISO()} max={fechaMaximaISO()} required value={datos.fecha} onChange={cambiar} disabled={bloqueado} />
          {datos.fecha && <span className="field-hint">Elegiste el {fechaLegible(datos.fecha)}.</span>}
        </label>
        {conAgenda ? <fieldset className="field solicitud-horarios" disabled={bloqueado}>
          <legend>Hora</legend>
          {!datos.fecha ? <>
            <p className="field-hint">Elegí primero la fecha y te mostramos los horarios de ese día.</p>
            <p className="field-hint">{nombre} atiende: {agenda.join('; ')}.</p>
          </> : !franjasDelDia.length ? (
            <p className="notice notice-info" role="status">{nombre} no atiende los {PLURAL[diaElegido]}. Atiende: {agenda.join('; ')}. Elegí otro día.</p>
          ) : <>
            <p className="field-hint">Los {PLURAL[diaElegido]} atiende {rangos(franjasDelDia)}. Tocá el horario que prefieras.</p>
            {opciones.length ? <div className="solicitud-horarios-opciones">
              {opciones.map(hora => <label key={hora} className="solicitud-horario">
                <input type="radio" name="hora" value={hora} checked={datos.hora === hora} onChange={cambiar} required />
                <span>{hora} hs</span>
              </label>)}
            </div> : <p className="notice notice-info" role="status">Ese día ya no quedan horarios para un turno de {textoDuracion(duracion)}. Elegí otro día.</p>}
          </>}
        </fieldset> : <label className="field">Hora<input type="time" name="hora" required value={datos.hora} onChange={cambiar} disabled={bloqueado} />
          <span className="field-hint">{nombre} no cargó días y horarios: elegí la hora que te quede mejor.</span>
        </label>}
        <label className="field">Dirección de atención<input name="direccionAtencion" autoComplete="street-address" maxLength={200} required value={datos.direccionAtencion} onChange={cambiar} disabled={bloqueado} />
          {direccionDelPerfil(paciente?.direccion) && <span className="field-hint">La tomamos de tu perfil. Podés cambiarla si la atención es en otro lugar.</span>}
        </label>
        {pideTelefono && <label className="field">Tu teléfono celular<input type="tel" name="telefono" autoComplete="tel" inputMode="tel" maxLength={40} required value={telefono} onChange={event => setTelefono(event.target.value)} disabled={bloqueado} />
          <span className="field-hint">Lo guardamos en tu perfil para que el profesional pueda avisarte. Por ejemplo: 261 555 1234.</span>
        </label>}
        <p>Tu pedido le llega a {nombre} y queda pendiente hasta que lo acepte. Te avisamos en Mis solicitudes cuando responda.</p>
        <button className="button button-primary" disabled={!habilitado || !idEnfermero || enviando || creada}>{enviando ? 'Enviando…' : 'Enviar solicitud'}</button>
      </form>
    </>}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {success && <div className="notice notice-success solicitud-success" role="status" aria-live="polite">
      <strong>{success}</strong>
      {datos.idSolicitud && <Link className="text-link" to={`/solicitudes/${datos.idSolicitud}`}>Ver comprobante de la solicitud</Link>}
    </div>}
    {noDisponible && <div className="notice notice-info" role="status">
      <p>Este profesional no está disponible en este momento. Buscá otro en la cartilla.</p>
      <Link className="button button-primary" to="/cartilla">Ir a la cartilla</Link>
    </div>}
    {!cargando && !perfil && !noDisponible && <button className="button button-secondary" onClick={() => setIntento(i => i + 1)}>Reintentar carga</button>}
    </section>
  </div>;
}
