import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api, formatPrice } from '../api';
import Avatar from './ui/Avatar';
import Icon from './ui/Icon';
import ProfileSkeleton from './ui/ProfileSkeleton';
import GestionHorarios from './GestionHorarios';
import HistorialServicios from './HistorialServicios';
import MiCuenta from './MiCuenta';
import AvisoMatricula from './AvisoMatricula';
import { estadoMatricula, MENSAJE_TELEFONO, TEXTO_MATRICULA, telefonoValido } from './perfilPendiente';
import { useBuscarDireccion } from './useUbicacion';

// El servidor no pudo abrir el dato guardado (clave de cifrado distinta): se conserva hasta recuperarlo.
const HISTORIAL_ILEGIBLE = 'No pudimos mostrar tu información de salud guardada. Si querés, escribila de nuevo.';

const LocationPicker = lazy(() => import('./LocationPicker'));

const COMMON = [
  ['nombre', 'Nombre', 'text', 'given-name'],
  ['apellido', 'Apellido', 'text', 'family-name'],
  ['telefono', 'Teléfono', 'tel', 'tel'],
  ['direccion', 'Dirección', 'text', 'street-address'],
];
// Paciente.obraSocial del diagrama de clases.
const PATIENT = [['obraSocial', 'Obra social o prepaga', 'text', 'off']];
const MAX_LENGTH = { telefono: 40, obraSocial: 100 };
const PROFESSIONAL = [
  ['especialidad', 'Especialidad'],
  ['matricula', 'Matrícula'],
  ['ciudad', 'Ciudad'],
  ['experiencia_anios', 'Años de experiencia', 'number'],
  ['tarifa_hora', 'Precio por hora (ARS)', 'number'],
];

export default function ProfileEditor({ role }) {
  const nurse = role === 'enfermero';
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retry, setRetry] = useState(0);
  const [locationOpen, setLocationOpen] = useState(false);
  // Dirección que se está escribiendo: al terminar se ubica sola en el mapa (null = no se editó todavía).
  const [buscarTexto, setBuscarTexto] = useState(null);
  const direccionEnMapa = useBuscarDireccion(buscarTexto, editing && buscarTexto !== null, ([latitud, longitud]) => {
    setForm((current) => ({ ...current, latitud, longitud }));
    setLocationOpen(true);
  });
  // SCRUM-14/53: catálogo para elegir qué servicios ofrece el enfermero.
  const [catalogo, setCatalogo] = useState([]);
  const fields = [...COMMON, ...(nurse ? PROFESSIONAL : PATIENT)];

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api(`/perfil/${role}`, { signal: controller.signal })
      .then((data) => {
        setProfile(data);
        setForm(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [role, retry]);

  useEffect(() => {
    if (!nurse) return undefined;
    const controller = new AbortController();
    api('/servicios', { signal: controller.signal })
      .then((lista) => setCatalogo(Array.isArray(lista) ? lista : []))
      .catch(() => {});
    return () => controller.abort();
  }, [nurse]);

  const idsOfrecidos = (form.servicios || []).map((servicio) => servicio.idServicio);
  function alternarServicio(servicio, elegido) {
    setForm((current) => {
      const resto = (current.servicios || []).filter((item) => item.idServicio !== servicio.idServicio);
      return { ...current, servicios: elegido ? [...resto, servicio] : resto };
    });
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setError('');
    setSuccess('');
    // Misma regla que el backend y que el enlace de WhatsApp: celular con código de área.
    if ((form.telefono || '').trim() && !telefonoValido(form.telefono)) {
      setError(MENSAJE_TELEFONO);
      document.querySelector('input[name="telefono"]')?.focus();
      return;
    }
    if (direccionEnMapa.pendiente) {
      setError('Esperá un momento: estamos ubicando tu dirección en el mapa.');
      return;
    }
    setSaving(true);
    const payload = Object.fromEntries(
      fields.map(([key, , type]) => [
        key,
        type === 'number' ? Number(form[key] || 0) : (form[key] || '').trim(),
      ]),
    );
    if (nurse) {
      payload.descripcion = form.descripcion || '';
      payload.disponible = Boolean(form.disponible);
      payload.servicios = idsOfrecidos;
      payload.latitud = form.latitud ?? null;
      payload.longitud = form.longitud ?? null;
    } else payload.historial_medico = form.historial_medico || '';
    if (!nurse) {
      payload.latitud = form.latitud ?? null;
      payload.longitud = form.longitud ?? null;
      payload.ubicacion_compartida = Boolean(form.ubicacion_compartida);
    }
    try {
      const updated = await api(`/perfil/${role}`, {
        method: 'PUT',
        body: payload,
      });
      const antes = nurse ? estadoMatricula(profile) : null;
      const volvioARevision = nurse && estadoMatricula(updated) === 'pendiente'
        && ['verificada', 'rechazada'].includes(antes);
      setProfile(updated);
      setForm(updated);
      setEditing(false);
      setSuccess(!volvioARevision
        ? 'Tus cambios se guardaron correctamente.'
        : antes === 'rechazada'
          ? 'Tus cambios se guardaron y le pedimos al equipo de Enfered que revise tu matrícula de nuevo. Te avisamos cuando esté lista.'
          : 'Tus cambios se guardaron. Como cambiaste datos de tu identidad o tu matrícula, vamos a revisarla de nuevo. Mientras tanto no vas a aparecer en la cartilla.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-container">
      <header className="page-heading">
        <div>
          <span className="eyebrow">TU ESPACIO PERSONAL</span>
          <h1>{nurse ? 'Mi perfil profesional' : 'Mi perfil'}</h1>
          <p>
            {nurse
              ? 'Mostrá tu experiencia y mantené tu disponibilidad al día.'
              : 'Mantené tus datos actualizados para coordinar tu atención.'}
          </p>
        </div>
        {!nurse && (
          <Link className="button button-secondary" to="/cartilla">
            Buscar profesionales
            <Icon name="arrow" size={16} />
          </Link>
        )}
      </header>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
          {!profile && (
            <button
              className="text-link"
              onClick={() => setRetry((v) => v + 1)}
            >
              Reintentar
            </button>
          )}
        </div>
      )}
      {success && (
        <div className="notice notice-success" role="status">
          {success}
        </div>
      )}
      {!profile ? (
        !error && <ProfileSkeleton label="Cargando tus datos…" />
      ) : (
        <>
          <header className="profile-hero">
            <Avatar person={profile} large />
            <div>
              <span className="eyebrow">
                {nurse ? 'PROFESIONAL DE ENFERMERÍA' : 'PACIENTE'}
              </span>
              <h2>
                {profile.nombre} {profile.apellido}
              </h2>
              <p className="profile-email">{profile.email}</p>
            </div>
          </header>
          {nurse && <AvisoMatricula perfil={profile} />}
          <div className="profile-columns">
            <section className="content-panel">
              <div className="panel-heading">
                <h2>{nurse ? 'Información profesional' : 'Mis datos'}</h2>
                {!editing && (
                  <button
                    className="text-link"
                    onClick={() => {
                      setForm(profile);
                      setEditing(true);
                      setSuccess('');
                      setError('');
                      setLocationOpen(false);
                      setBuscarTexto(null);
                    }}
                  >
                    Editar datos
                    <Icon name="arrow" size={16} />
                  </button>
                )}
              </div>
              {editing ? (
                <form onSubmit={save} aria-busy={saving}>
                  <div className="form-grid">
                    {fields.map(([key, label, type = 'text', complete]) => (
                      <label className="field" key={key}>
                        {key === 'apellido' || key === 'obraSocial' ? `${label} (opcional)` : label}
                        <input
                          name={key}
                          type={type}
                          autoComplete={complete}
                          value={form[key] ?? ''}
                          onChange={(e) => {
                            const valor = e.target.value;
                            setForm((current) => ({
                              ...current,
                              [key]: valor,
                              // El punto anterior ya no corresponde a la dirección nueva: se vuelve a ubicar.
                              ...(key === 'direccion' || (nurse && key === 'ciudad')
                                ? { latitud: null, longitud: null }
                                : {}),
                            }));
                            if (key === 'direccion' || (nurse && key === 'ciudad')) {
                              const siguiente = { ...form, [key]: valor };
                              setBuscarTexto(nurse
                                ? [siguiente.direccion, siguiente.ciudad].filter(Boolean).join(', ')
                                : siguiente.direccion || '');
                            }
                          }}
                          required={['nombre', 'matricula'].includes(key)}
                          min={type === 'number' ? '0' : undefined}
                          step={key === 'tarifa_hora' ? '0.01' : undefined}
                          maxLength={MAX_LENGTH[key]}
                          inputMode={key === 'telefono' ? 'tel' : undefined}
                          aria-describedby={key === 'telefono' ? 'telefono-pista' : undefined}
                          aria-invalid={key === 'telefono' && error === MENSAJE_TELEFONO ? true : undefined}
                          disabled={saving}
                        />
                        {key === 'telefono' && (
                          <span id="telefono-pista" className="filter-hint">
                            Código de área + número, sin 0 ni 15. Ej.: 261 555 1234
                            {nurse && '. Es el número por el que los pacientes te van a escribir por WhatsApp cuando aceptes su solicitud.'}
                          </span>
                        )}
                      </label>
                    ))}
                    <div className="field full-width location-field">
                      <span>Ubicación de atención en el mapa (opcional)</span>
                      <p className="filter-hint" role="status">
                        {form.latitud != null && form.longitud != null
                          ? 'Hay un punto seleccionado. Se guardará junto con tus datos.'
                          : nurse
                            ? 'Sin punto seleccionado. Podés guardar el perfil sin publicar una ubicación.'
                            : 'Sin punto seleccionado. Podés elegir dónde recibir la atención; no se comparte hasta que lo habilites.'}
                      </p>
                      <p className="filter-hint" aria-live="polite">
                        {direccionEnMapa.mensaje
                          || 'Al escribir tu dirección la ubicamos sola en el mapa; también podés tocar el lugar o usar tu ubicación actual.'}
                      </p>
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={saving}
                        onClick={() => setLocationOpen(!locationOpen)}
                        aria-expanded={locationOpen}
                        aria-controls="profile-location"
                      >
                        {locationOpen
                          ? 'Cerrar mapa'
                          : 'Elegir ubicación en el mapa'}
                      </button>
                      {form.latitud != null && form.longitud != null && (
                        <button
                          type="button"
                          className="text-link"
                          disabled={saving}
                          onClick={() => setForm((current) => ({
                            ...current,
                            latitud: null,
                            longitud: null,
                            ubicacion_compartida: false,
                          }))}
                        >
                          Quitar ubicación
                        </button>
                      )}
                      {locationOpen && (
                        <div id="profile-location" inert={saving ? true : undefined}>
                          <Suspense fallback={<p role="status">Cargando mapa…</p>}>
                            <LocationPicker
                              latitude={form.latitud}
                              longitude={form.longitud}
                              conMiUbicacion
                              helpText={
                                nurse
                                  ? 'Marcá tu zona de atención tocando el mapa. En la cartilla se muestra un punto aproximado, no tu dirección.'
                                  : 'Marcá el lugar donde recibirías la atención. Solo se comparte si activás la opción de compartir ubicación.'
                              }
                              onChange={(latitud, longitud) => {
                                // Lo que toca la persona manda: una búsqueda que llegue tarde no lo pisa.
                                direccionEnMapa.cancelar();
                                setForm((current) => ({ ...current, latitud, longitud }));
                              }}
                            />
                          </Suspense>
                        </div>
                      )}
                      {!nurse && (
                        <label className="checkbox-field location-sharing">
                          <input
                            type="checkbox"
                            checked={Boolean(form.ubicacion_compartida)}
                            onChange={(e) => setForm((current) => ({
                              ...current,
                              ubicacion_compartida: e.target.checked,
                            }))}
                            disabled={saving || form.latitud == null || form.longitud == null}
                          />
                          Compartir este punto con el enfermero asignado mientras haya una solicitud activa
                        </label>
                      )}
                    </div>
                    <label className="field full-width">
                      {nurse ? 'Tu presentación' : 'Información de salud'}
                      <textarea
                        value={
                          form[nurse ? 'descripcion' : 'historial_medico'] || ''
                        }
                        placeholder={
                          nurse
                            ? 'Contá cómo podés acompañar a tus pacientes.'
                            : 'Información que consideres relevante para tu atención (opcional).'
                        }
                        onChange={(e) =>
                          setForm((current) => ({
                            ...current,
                            [nurse ? 'descripcion' : 'historial_medico']:
                              e.target.value,
                          }))
                        }
                        disabled={saving}
                      />
                      {!nurse && profile.historialIlegible && (
                        <span className="field-hint">{HISTORIAL_ILEGIBLE} Si lo dejás vacío, no se borra.</span>
                      )}
                    </label>
                    {nurse && (
                      <label className="checkbox-field full-width">
                        <input
                          type="checkbox"
                          checked={Boolean(form.disponible)}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              disponible: e.target.checked,
                            }))
                          }
                          disabled={saving}
                        />
                        Estoy disponible para recibir consultas
                      </label>
                    )}
                    {nurse && catalogo.length > 0 && (
                      <fieldset className="services-offered full-width" disabled={saving}>
                        <legend>Servicios que ofrecés</legend>
                        <p className="field-hint">
                          Los pacientes que buscan un servicio te van a encontrar si lo marcás. Si no marcás
                          ninguno, podés recibir pedidos de cualquier servicio, pero no aparecés al filtrar.
                        </p>
                        <div className="services-offered-options">
                          {catalogo.map((servicio) => (
                            <label key={servicio.idServicio} className="checkbox-field">
                              <input
                                type="checkbox"
                                checked={idsOfrecidos.includes(servicio.idServicio)}
                                onChange={(e) => alternarServicio(servicio, e.target.checked)}
                              />
                              {servicio.tipoServicio}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                  </div>
                  <div className="form-actions">
                    <button className="button button-primary" disabled={saving}>
                      {saving ? 'Guardando…' : 'Guardar cambios'}
                    </button>
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setForm(profile);
                        setEditing(false);
                        setError('');
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="profile-data">
                  {fields.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>
                        {profile[key] === null ||
                        profile[key] === undefined ||
                        profile[key] === ''
                          ? 'Sin completar'
                          : key === 'tarifa_hora'
                            ? formatPrice(profile[key])
                            : profile[key]}
                      </dd>
                    </div>
                  ))}
                  <div className="full-width">
                    <dt>{nurse ? 'Presentación' : 'Información de salud'}</dt>
                    <dd>
                      {!nurse && profile.historialIlegible
                        ? HISTORIAL_ILEGIBLE
                        : profile[nurse ? 'descripcion' : 'historial_medico'] || 'Sin completar'}
                    </dd>
                  </div>
                  {nurse && (
                    <div>
                      <dt>Disponibilidad</dt>
                      <dd>
                        {profile.disponible ? 'Disponible' : 'No disponible'}
                      </dd>
                    </div>
                  )}
                  {nurse && (
                    <div className="full-width">
                      <dt>Servicios que ofrecés</dt>
                      <dd>
                        {profile.servicios?.length
                          ? profile.servicios.map((servicio) => servicio.tipoServicio).join(', ')
                          : 'Sin elegir: recibís pedidos de cualquier servicio, pero no aparecés al filtrar por servicio'}
                      </dd>
                    </div>
                  )}
                  {nurse && (
                    <div>
                      <dt>Verificación de matrícula</dt>
                      <dd>
                        {TEXTO_MATRICULA[estadoMatricula(profile)] || 'En revisión'}
                      </dd>
                    </div>
                  )}
                  {!nurse && (
                    <div>
                      <dt>Ubicación compartida</dt>
                      <dd>
                        {profile.ubicacion_compartida
                          ? 'Con enfermeros que tengan una solicitud activa asignada'
                          : 'No compartida'}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </section>
            <aside className="content-panel profile-tip">
              <span className="soft-icon mint">
                <Icon name={nurse ? 'briefcase' : 'heart'} size={25} />
              </span>
              <h2>
                {nurse
                  ? 'Un perfil que te representa.'
                  : 'Cuidarte empieza por conocerte.'}
              </h2>
              <p>
                {nurse
                  ? 'Una presentación clara, tu especialidad y tus horarios ayudan a las personas a encontrar la atención que necesitan.'
                  : 'Revisá tu teléfono y tu dirección para facilitar el contacto y la atención a domicilio.'}
              </p>
              {nurse && (
                <Link
                  className="text-link"
                  to={`/perfil/${profile.usuario_id ?? profile.id}`}
                >
                  Ver mi perfil público
                  <Icon name="arrow" size={16} />
                </Link>
              )}
            </aside>
          </div>
          <HistorialServicios userId={profile.id} nurse={nurse} />
          {nurse && <GestionHorarios />}
          <MiCuenta rol={role} />
        </>
      )}
    </div>
  );
}
