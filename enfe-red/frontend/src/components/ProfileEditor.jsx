import { lazy, Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { requestApi as api, formatPrice } from '../api';
import Avatar from './ui/Avatar';
import Icon from './ui/Icon';
import ProfileSkeleton from './ui/ProfileSkeleton';
import GestionHorarios from './GestionHorarios';
import HistorialServicios from './HistorialServicios';
const LocationPicker = lazy(() => import('./LocationPicker'));

const COMMON = [
  ['nombre', 'Nombre', 'text', 'given-name'],
  ['apellido', 'Apellido', 'text', 'family-name'],
  ['telefono', 'Teléfono', 'tel', 'tel'],
  ['direccion', 'Dirección', 'text', 'street-address'],
];
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
  const fields = [...COMMON, ...(nurse ? PROFESSIONAL : [])];

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

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setSuccess('');
    const payload = Object.fromEntries(
      fields.map(([key, , type]) => [
        key,
        type === 'number' ? Number(form[key] || 0) : (form[key] || '').trim(),
      ]),
    );
    if (nurse) {
      payload.descripcion = form.descripcion || '';
      payload.disponible = Boolean(form.disponible);
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
      setProfile(updated);
      setForm(updated);
      setEditing(false);
      setSuccess('Tus cambios se guardaron correctamente.');
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
                        {key === 'apellido' ? 'Apellido (opcional)' : label}
                        <input
                          name={key}
                          type={type}
                          autoComplete={complete}
                          value={form[key] ?? ''}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              [key]: e.target.value,
                              ...(nurse && ['direccion', 'ciudad'].includes(key)
                                ? { latitud: null, longitud: null }
                                : {}),
                            }))
                          }
                          required={['nombre', 'matricula'].includes(key)}
                          min={type === 'number' ? '0' : undefined}
                          step={key === 'tarifa_hora' ? '0.01' : undefined}
                          maxLength={key === 'telefono' ? 20 : undefined}
                          disabled={saving}
                        />
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
                              helpText={
                                nurse
                                  ? 'Marcá tu zona de atención haciendo clic en el mapa. Este punto se muestra en tu perfil profesional.'
                                  : 'Marcá el lugar donde recibirías la atención. Solo se comparte si activás la opción de compartir ubicación.'
                              }
                              onChange={(latitud, longitud) => setForm((current) => ({
                                ...current, latitud, longitud,
                              }))}
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
                      {profile[nurse ? 'descripcion' : 'historial_medico'] ||
                        'Sin completar'}
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
                    <div>
                      <dt>Verificación de matrícula</dt>
                      <dd>
                        {profile.verificado === true
                          ? 'Verificada'
                          : 'Pendiente de verificación'}
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
        </>
      )}
    </div>
  );
}
