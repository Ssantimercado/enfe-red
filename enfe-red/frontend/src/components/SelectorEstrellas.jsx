// SCRUM-65.3: estrellas de 1 a 5 compartidas por la calificación y las reseñas.
export const formatoPuntuacion = (valor) =>
  Number(valor).toLocaleString('es-AR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

export function EstrellasLectura({ valor }) {
  const llenas = Math.min(5, Math.max(0, Math.round(Number(valor) || 0)));
  return (
    <span
      className="rating-stars-read"
      role="img"
      aria-label={`${formatoPuntuacion(valor)} de 5 estrellas`}
    >
      {'★'.repeat(llenas)}
      {'☆'.repeat(5 - llenas)}
    </span>
  );
}

// Radios nativos: se eligen con flechas del teclado y el formulario exige una opción.
export default function SelectorEstrellas({
  nombre,
  valor,
  onChange,
  disabled = false,
  leyenda = 'Calificación (1 a 5 estrellas)',
}) {
  return (
    <fieldset className="service-rating-stars" disabled={disabled}>
      <legend>{leyenda}</legend>
      {[1, 2, 3, 4, 5].map((opcion) => (
        <label key={opcion}>
          <input
            type="radio"
            name={nombre}
            value={opcion}
            checked={valor === opcion}
            onChange={() => onChange(opcion)}
            required
          />
          <span aria-hidden="true">{opcion <= valor ? '★' : '☆'}</span>
          <span className="service-rating-label">
            {opcion}
            <span className="sr-only"> {opcion === 1 ? 'estrella' : 'estrellas'}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
