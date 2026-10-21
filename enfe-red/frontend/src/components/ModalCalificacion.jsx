import { useEffect, useRef, useState } from 'react';
import SelectorEstrellas from './SelectorEstrellas';

export const MAX_PALABRAS = 250;
// Límite de POST /api/resenas; también evita comentarios desmedidos en el historial.
const MAX_CARACTERES = 2000;

function contarPalabras(texto) {
  return texto.trim() ? texto.trim().split(/\s+/).length : 0;
}

// SCRUM-65.3: la calificación se completa en un diálogo modal. Se monta al abrirse
// y quien lo usa decide a qué endpoint enviar { estrellas, comentario }.
export default function ModalCalificacion({
  id,
  titulo,
  descripcion,
  guardando,
  error,
  onEnviar,
  onCerrar,
}) {
  const dialog = useRef(null);
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState('');
  const palabras = contarPalabras(comentario);

  useEffect(() => {
    const actual = dialog.current;
    actual.showModal();
    return () => actual.close();
  }, []);

  function enviar(event) {
    event.preventDefault();
    if (guardando || !estrellas || !palabras || palabras > MAX_PALABRAS) return;
    onEnviar({ estrellas, comentario });
  }

  return (
    <dialog
      ref={dialog}
      className="content-panel rating-dialog"
      aria-labelledby={`${id}-titulo`}
      aria-describedby={`${id}-descripcion`}
      onCancel={(event) => {
        // Escape cierra el modal salvo durante el envío.
        event.preventDefault();
        if (!guardando) onCerrar();
      }}
    >
      <form className="service-rating-form" onSubmit={enviar} aria-busy={guardando}>
        <div>
          <h2 id={`${id}-titulo`}>{titulo}</h2>
          <p id={`${id}-descripcion`}>{descripcion}</p>
        </div>
        <SelectorEstrellas
          nombre={`${id}-estrellas`}
          valor={estrellas}
          onChange={setEstrellas}
          disabled={guardando}
        />
        <label className="field">
          Comentario (máximo {MAX_PALABRAS} palabras)
          <textarea
            value={comentario}
            onChange={(event) => setComentario(event.target.value)}
            aria-describedby={`${id}-palabras`}
            maxLength={MAX_CARACTERES}
            readOnly={guardando}
            required
          />
        </label>
        <p
          id={`${id}-palabras`}
          className={palabras > MAX_PALABRAS ? 'field-error' : 'filter-hint'}
        >
          {palabras}/{MAX_PALABRAS} palabras
        </p>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        <div className="service-rating-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={guardando}
            onClick={onCerrar}
          >
            Cancelar
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={guardando || !estrellas || !palabras || palabras > MAX_PALABRAS}
          >
            {guardando ? 'Guardando…' : 'Enviar calificación'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
