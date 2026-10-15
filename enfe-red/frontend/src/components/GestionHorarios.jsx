import { useEffect, useState } from 'react';
import { requestApi as api, DAYS } from '../api';
import Icon from './ui/Icon';

export default function GestionHorarios() {
  const [schedules, setSchedules] = useState([]);
  const [form, setForm] = useState({
    dia_semana: 'Lunes',
    hora_inicio: '08:00',
    hora_fin: '16:00',
    estado: 'Disponible',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api('/perfil/enfermero/horarios', { signal: controller.signal })
      .then(setSchedules)
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [retry]);
  const change = (e) =>
    setForm((current) => ({ ...current, [e.target.name]: e.target.value }));
  async function save(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (form.hora_fin <= form.hora_inicio) {
      setError('La hora de fin debe ser posterior a la hora de inicio.');
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const result = await api('/perfil/enfermero/horarios', {
        method: 'POST',
        body: form,
      });
      if (result.disponibilidad)
        setSchedules((current) => [
          ...current.filter((item) => item.id !== result.disponibilidad.id),
          result.disponibilidad,
        ]);
      setMessage(result.mensaje || 'Horario guardado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="content-panel" id="horarios">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">ORGANIZÁ TU ATENCIÓN</span>
          <h2>Mis horarios</h2>
        </div>
        <Icon name="calendar" size={26} />
      </div>
      <p>
        Agregá tus días y franjas de atención para que puedan consultarlos desde
        tu perfil.
      </p>
      <div className="schedule-layout">
        <div>
          {loading ? (
            <p role="status">Cargando horarios…</p>
          ) : schedules.length ? (
            [...schedules]
              .sort(
                (a, b) =>
                  DAYS.indexOf(a.dia_semana) - DAYS.indexOf(b.dia_semana) ||
                  a.hora_inicio.localeCompare(b.hora_inicio),
              )
              .map((item) => (
                <div className="schedule-row" key={item.id}>
                  <div>
                    <strong>{item.dia_semana}</strong>
                    <p>
                      {item.hora_inicio} – {item.hora_fin}
                    </p>
                  </div>
                  <span
                    className={`availability ${item.estado !== 'Disponible' ? 'unavailable' : ''}`}
                  >
                    {item.estado}
                  </span>
                </div>
              ))
          ) : (
            <p className="schedule-note">Todavía no agregaste horarios.</p>
          )}
          {error && (
            <div className="notice notice-error" role="alert">
              {error}
              <button
                className="text-link"
                onClick={() => setRetry((v) => v + 1)}
              >
                Recargar horarios
              </button>
            </div>
          )}
          {message && (
            <div className="notice notice-success" role="status">
              {message}
            </div>
          )}
        </div>
        <form className="schedule-form" onSubmit={save} aria-busy={saving}>
          <h3>Agregar horario</h3>
          <div className="form-grid">
            <label className="field">
              Día
              <select
                name="dia_semana"
                value={form.dia_semana}
                onChange={change}
              >
                {DAYS.map((day) => (
                  <option key={day}>{day}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Estado
              <select name="estado" value={form.estado} onChange={change}>
                {[
                  'Disponible',
                  'Ocupado / Reservado',
                  'En Pausa / No disponible',
                ].map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Desde
              <input
                type="time"
                name="hora_inicio"
                value={form.hora_inicio}
                onChange={change}
                required
              />
            </label>
            <label className="field">
              Hasta
              <input
                type="time"
                name="hora_fin"
                value={form.hora_fin}
                onChange={change}
                required
              />
            </label>
          </div>
          <button
            className="button button-primary button-full"
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Agregar horario'}
          </button>
        </form>
      </div>
    </section>
  );
}
