// Mientras llega el código de una pantalla (carga por partes) o se renueva la sesión.
export default function CargaPantalla({ texto = 'Cargando…' }) {
  return (
    <div className="carga-pantalla" role="status" aria-live="polite">
      <span className="carga-pantalla-icono" aria-hidden="true" />
      <p>{texto}</p>
    </div>
  );
}
