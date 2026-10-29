// "1,3" -> "Curaciones y Control de signos vitales" (la búsqueda asistida puede pedir varios).
export const nombreServicios = (valor, servicios) => String(valor || '')
  .split(',')
  .map((id) => servicios.find((item) => String(item.idServicio) === id)?.tipoServicio)
  .filter(Boolean)
  .join(' y ');
