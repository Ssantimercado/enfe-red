import { DAYS } from '../api';

export default function DirectoryFilters({
  values,
  specialties,
  zonas = [],
  servicios = [],
  onChange,
  prefix,
}) {
  const invalidRange =
    values.precio_min !== '' &&
    values.precio_max !== '' &&
    Number(values.precio_min) > Number(values.precio_max);
  const priceHint = `${prefix}-precio`;
  const invalidTimeRange =
    (values.hora_desde === '') !== (values.hora_hasta === '') ||
    (values.hora_desde !== '' &&
      values.hora_hasta !== '' &&
      values.hora_desde >= values.hora_hasta);

  return (
    <div className="filters-fields">
      {/* SCRUM-14/53: solo profesionales que declararon ofrecer ese servicio. */}
      <div className="field">
        <label htmlFor={`${prefix}-servicio`}>Servicio</label>
        <select
          id={`${prefix}-servicio`}
          value={values.servicio}
          onChange={(e) => onChange('servicio', e.target.value)}
        >
          <option value="">Todos los servicios</option>
          {servicios.map((servicio) => (
            <option key={servicio.idServicio} value={String(servicio.idServicio)}>
              {servicio.tipoServicio}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-especialidad`}>Especialidad</label>
        <select
          id={`${prefix}-especialidad`}
          value={values.especialidad}
          onChange={(e) => onChange('especialidad', e.target.value)}
        >
          <option value="">Todas las especialidades</option>
          {[
            ...new Set([...specialties, values.especialidad].filter(Boolean)),
          ].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-ciudad`}>Departamento</label>
        <select
          id={`${prefix}-ciudad`}
          value={values.ciudad}
          onChange={(e) => onChange('ciudad', e.target.value)}
        >
          <option value="">Todos los departamentos</option>
          {/* La zona de la búsqueda asistida puede no estar en la lista: se agrega para no perderla. */}
          {[...new Set([...zonas, values.ciudad].filter(Boolean))].map((item) => (
            <option key={item} value={item}>{item === 'Ciudad de Mendoza' ? 'Ciudad de Mendoza (Capital)' : item}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Precio por hora</span>
        <div className="price-range">
          <label>
            <span className="range-label">Desde</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="$ Mínimo"
              aria-label="Precio mínimo"
              aria-describedby={priceHint}
              aria-invalid={invalidRange}
              value={values.precio_min}
              onChange={(e) => onChange('precio_min', e.target.value)}
            />
          </label>
          <label>
            <span className="range-label">Hasta</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="$ Máximo"
              aria-label="Precio máximo"
              aria-describedby={priceHint}
              aria-invalid={invalidRange}
              value={values.precio_max}
              onChange={(e) => onChange('precio_max', e.target.value)}
            />
          </label>
        </div>
        <span
          id={priceHint}
          className={invalidRange ? 'field-error' : 'filter-hint'}
          role={invalidRange ? 'alert' : undefined}
        >
          {invalidRange
            ? 'El mínimo no puede superar al máximo.'
            : 'Valores en pesos argentinos.'}
        </span>
      </div>
      <div className="field">
        <span>Horario de atención</span>
        <div className="price-range">
          <label>
            <span className="range-label">Desde</span>
            <input
              type="time"
              aria-label="Horario desde"
              value={values.hora_desde}
              aria-invalid={invalidTimeRange}
              onChange={(e) => onChange('hora_desde', e.target.value)}
            />
          </label>
          <label>
            <span className="range-label">Hasta</span>
            <input
              type="time"
              aria-label="Horario hasta"
              value={values.hora_hasta}
              aria-invalid={invalidTimeRange}
              onChange={(e) => onChange('hora_hasta', e.target.value)}
            />
          </label>
        </div>
        <span className="filter-hint">
          Se mostrarán profesionales con una franja que cubra todo el horario.
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-dia`}>Día de atención</label>
        <select
          id={`${prefix}-dia`}
          value={values.dia_semana}
          onChange={(e) => onChange('dia_semana', e.target.value)}
        >
          <option value="">Cualquier día</option>
          {DAYS.map((day) => (
            <option key={day}>{day}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
