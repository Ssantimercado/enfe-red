// Textos de cada estado, compartidos por las tarjetas y el comprobante.
const PARA_PACIENTE = {
  Pendiente: 'Esperando que el profesional la acepte.',
  Aceptada: 'El profesional confirmó el turno. Podés escribirle para coordinar.',
  Realizada: 'Atención finalizada. Contanos cómo te fue.',
  Rechazada: 'El profesional no pudo tomar este turno.',
  Vencida: 'Venció sin respuesta: el profesional no contestó antes del turno.',
};
const PARA_ENFERMERO = {
  Pendiente: 'Esperando tu respuesta.',
  Aceptada: 'Confirmaste este turno.',
  Realizada: 'Atención finalizada.',
  Rechazada: 'Rechazaste este pedido.',
  Vencida: 'Venció sin respuesta: el turno llegó sin que lo aceptaras.',
};

function quienCancelo(solicitud, enfermero) {
  const propio = enfermero ? 'enfermero' : 'paciente';
  if (solicitud.canceladaPor === propio) return enfermero ? 'Cancelaste este turno.' : 'Cancelaste esta solicitud.';
  if (solicitud.canceladaPor === 'enfermero') return 'El profesional canceló el turno.';
  if (solicitud.canceladaPor === 'paciente') return 'El paciente canceló el turno.';
  if (solicitud.canceladaPor === 'administrador') return 'El equipo de Enfered canceló el turno.';
  return 'Este turno se canceló.';
}

export function textoEstado(solicitud, { enfermero = false, calificada = false } = {}) {
  if (solicitud.estado === 'Cancelada') return quienCancelo(solicitud, enfermero);
  if (solicitud.estado === 'Realizada' && !enfermero && calificada) return 'Atención finalizada. Gracias por calificarla.';
  return (enfermero ? PARA_ENFERMERO : PARA_PACIENTE)[solicitud.estado] || '';
}

// Rechazada, Cancelada o Vencida: el paciente necesita otro profesional.
export const ESTADOS_SIN_TURNO = ['Rechazada', 'Cancelada', 'Vencida'];
