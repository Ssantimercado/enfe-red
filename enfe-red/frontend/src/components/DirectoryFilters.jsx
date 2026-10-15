import { DAYS } from '../api';

export default function DirectoryFilters({
  values,
  specialties,
  onChange,
  prefix,
}) {
  const invalidRange =
    values.precio_min !== '' &&
    values.precio_max !== '' &&
    Number(values.precio_min) > Number(values.precio_max);
  const priceHint = `${prefix}-precio`;

  return (
    <div className="filters-fields">
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
        <label htmlFor={`${prefix}-disponibilidad`}>Disponibilidad</label>
        <select
          id={`${prefix}-disponibilidad`}
          value={values.disponible}
          onChange={(e) => onChange('disponible', e.target.value)}
        >
          <option value="">Todos los profesionales</option>
          <option value="true">Solo disponibles</option>
          <option value="false">No disponibles</option>
        </select>
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
