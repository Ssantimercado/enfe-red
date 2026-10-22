import { sesionActual } from '../api';

export function nombreCompleto(persona, vacio = 'Sin nombre') {
  return [persona?.nombre, persona?.apellido].filter(Boolean).join(' ') || vacio;
}

// El backend manda fechas UTC con "Z"; se muestran en la hora local de quien mira.
export function fechaHora(valor) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// verificadoPor es el id del administrador que revisó; si fue la misma persona, se dice "vos".
export function quienReviso(idAdmin) {
  if (!Number.isInteger(idAdmin)) return '';
  return String(idAdmin) === String(sesionActual()?.sub) ? 'vos' : `el administrador N.º ${idAdmin}`;
}

export function respuestaPaginadaValida(data, clave) {
  return Array.isArray(data?.[clave]) &&
    Number.isInteger(data.total_resultados) &&
    data.total_resultados >= 0 &&
    Number.isInteger(data.total_paginas) &&
    data.total_paginas >= 0;
}

export function Paginacion({ etiqueta, pagina, paginas, cargando, onCambiar }) {
  if (paginas <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label={etiqueta}>
      <button
        className="button button-secondary"
        type="button"
        disabled={pagina <= 1 || cargando}
        onClick={() => onCambiar(pagina - 1)}
      >
        Anterior
      </button>
      <span>Página {pagina} de {paginas}</span>
      <button
        className="button button-secondary"
        type="button"
        disabled={pagina >= paginas || cargando}
        onClick={() => onCambiar(pagina + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
