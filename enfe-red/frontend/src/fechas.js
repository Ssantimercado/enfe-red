// Fechas de turnos: el backend manda "AAAA-MM-DD" y "HH:MM" en hora de Argentina, sin zona.
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
// Mismo orden que DAYS de api.js y que los horarios que carga el enfermero.
export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// new Date('2026-10-22') la toma como medianoche UTC y en Argentina se vería el día 21:
// por eso se arma con año, mes y día locales.
export function fechaDeTurno(fecha) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || ''));
  if (!partes) return null;
  const dia = new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return Number.isNaN(dia.getTime()) ? null : dia;
}

export function horaCorta(hora) {
  return /^\d{2}:\d{2}/.test(String(hora || '')) ? String(hora).slice(0, 5) : '';
}

// "martes 22 de octubre" o, con hora, "martes 22 de octubre, 15:00 hs".
// Solo se agrega el año cuando no es el actual, para no recargar el texto.
export function fechaLegible(fecha, hora) {
  const dia = fechaDeTurno(fecha);
  if (!dia) return [fecha, horaCorta(hora)].filter(Boolean).join(' ');
  let texto = `${DIAS[dia.getDay()]} ${dia.getDate()} de ${MESES[dia.getMonth()]}`;
  if (dia.getFullYear() !== new Date().getFullYear()) texto += ` de ${dia.getFullYear()}`;
  return horaCorta(hora) ? `${texto}, ${horaCorta(hora)} hs` : texto;
}

export function fechaISO(dia) {
  return `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(dia.getDate()).padStart(2, '0')}`;
}

export const hoyISO = () => fechaISO(new Date());

// El backend acepta turnos hasta el mismo día seis meses después (o el último día de ese mes).
export function fechaMaximaISO(desde = new Date()) {
  const ultimoDia = new Date(desde.getFullYear(), desde.getMonth() + 7, 0).getDate();
  return fechaISO(new Date(desde.getFullYear(), desde.getMonth() + 6, Math.min(desde.getDate(), ultimoDia)));
}

// "Lunes", "Martes"… para comparar con los horarios cargados por el enfermero.
export function diaDeLaSemana(fecha) {
  const dia = fechaDeTurno(fecha);
  return dia ? DIAS_SEMANA[(dia.getDay() + 6) % 7] : '';
}

export function momentoDelTurno(solicitud) {
  const dia = fechaDeTurno(solicitud?.fecha);
  const [horas, minutos] = horaCorta(solicitud?.hora).split(':').map(Number);
  if (!dia || !Number.isFinite(horas)) return null;
  dia.setHours(horas, minutos || 0, 0, 0);
  return dia;
}

// Solo decide qué botones mostrar: el backend valida con la hora de Argentina.
export function turnoFuturo(solicitud) {
  const momento = momentoDelTurno(solicitud);
  return Boolean(momento && momento > new Date());
}
