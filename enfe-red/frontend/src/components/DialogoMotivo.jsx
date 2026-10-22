import { useEffect, useId, useRef, useState } from 'react';

// Confirmación de las acciones de administración. Con `minimo` > 0 el motivo es obligatorio;
// sin `etiqueta` el diálogo solo pide confirmar.
export default function DialogoMotivo({
  abierto,
  titulo,
  descripcion,
  etiqueta,
  ayuda,
  minimo = 0,
  maximo = 300,
  mensajeMotivo,
  textoConfirmar,
  textoGuardando = 'Guardando…',
  guardando = false,
  error = '',
  onConfirmar,
  onCerrar,
}) {
  const dialog = useRef(null);
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [errorLocal, setErrorLocal] = useState('');

  useEffect(() => {
    const elemento = dialog.current;
    if (!elemento) return;
    if (abierto && !elemento.open) {
      setMotivo('');
      setErrorLocal('');
      elemento.showModal();
    } else if (!abierto && elemento.open) {
      elemento.close();
    }
  }, [abierto]);

  function confirmar(event) {
    event.preventDefault();
    if (guardando) return;
    const texto = motivo.trim();
    if (etiqueta && (texto.length < minimo || texto.length > maximo)) {
      setErrorLocal(mensajeMotivo);
      return;
    }
    setErrorLocal('');
    onConfirmar(texto);
  }

  const mensajeError = errorLocal || error;

  return (
    <dialog
      className="content-panel admin-confirm-dialog admin-motivo-dialog"
      ref={dialog}
      aria-labelledby={`${id}-titulo`}
      aria-describedby={descripcion ? `${id}-descripcion` : undefined}
      onCancel={(event) => {
        // Escape no cierra mientras se guarda, para no perder la respuesta del servidor.
        event.preventDefault();
        if (!guardando) onCerrar();
      }}
    >
      <form className="form-stack" onSubmit={confirmar} aria-busy={guardando} noValidate>
        <div>
          <h2 id={`${id}-titulo`}>{titulo}</h2>
          {descripcion && <p id={`${id}-descripcion`}>{descripcion}</p>}
        </div>
        {etiqueta && (
          <>
            <label className="field">
              {etiqueta}
              <textarea
                name="motivo"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                maxLength={maximo}
                aria-describedby={`${id}-cuenta`}
                aria-invalid={errorLocal ? true : undefined}
                readOnly={guardando}
                required={minimo > 0}
              />
            </label>
            <p id={`${id}-cuenta`} className="field-hint">
              {ayuda ? `${ayuda} ` : ''}
              {motivo.trim().length}/{maximo} caracteres{minimo > 0 ? ` (mínimo ${minimo})` : ''}.
            </p>
          </>
        )}
        {mensajeError && <p className="notice notice-error" role="alert">{mensajeError}</p>}
        <div className="admin-dialog-actions">
          <button className="button button-secondary" type="button" disabled={guardando} onClick={onCerrar}>
            Volver
          </button>
          <button className="button button-primary" type="submit" disabled={guardando}>
            {guardando ? textoGuardando : textoConfirmar}
          </button>
        </div>
      </form>
    </dialog>
  );
}
