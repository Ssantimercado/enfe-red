import { enlaceWhatsapp } from '../api';

export const MENSAJE_TELEFONO = 'Escribí el teléfono con código de área, sin 0 ni 15. Por ejemplo: 261 555 1234.';
// Al registrarse, el enfermero recibe una matrícula temporal hasta que cargue la real.
const MATRICULA_TEMPORAL = /^PENDIENTE-/i;

export const telefonoValido = (telefono) => Boolean(enlaceWhatsapp(telefono));

const completo = (valor) => Boolean(String(valor ?? '').trim()) && !/^No registrad[ao]$/i.test(String(valor).trim());

// Los perfiles anteriores al estado de verificación solo traen "verificado".
export function estadoMatricula(perfil) {
  if (perfil?.estadoVerificacion) return perfil.estadoVerificacion;
  if (MATRICULA_TEMPORAL.test(perfil?.matricula || '')) return 'sin_cargar';
  return perfil?.verificado === true ? 'verificada' : 'pendiente';
}

export const TEXTO_MATRICULA = {
  verificada: 'Verificada',
  pendiente: 'En revisión',
  rechazada: 'No pudimos verificarla',
  sin_cargar: 'Sin cargar',
};

// Lista "Completá tu perfil" del inicio: [clave, texto, destino].
export function pendientesDelPerfil(rol, perfil, horarios = null) {
  if (!perfil) return [];
  const pendientes = [];
  if (!telefonoValido(perfil.telefono)) {
    pendientes.push(['telefono', rol === 'enfermero'
      ? 'Cargá tu celular: es el número por el que los pacientes te van a escribir por WhatsApp.'
      : 'Cargá tu celular para que el profesional pueda escribirte por WhatsApp.',
    rol === 'enfermero' ? '/perfil-enfermero' : '/perfil-paciente']);
  }
  if (rol === 'paciente') {
    if (!completo(perfil.direccion)) {
      pendientes.push(['direccion', 'Cargá tu dirección para pedir atención a domicilio más rápido.', '/perfil-paciente']);
    }
    return pendientes;
  }
  if (estadoMatricula(perfil) === 'sin_cargar' || !completo(perfil.matricula)) {
    pendientes.push(['matricula', 'Cargá tu número de matrícula para que podamos verificarla.', '/perfil-enfermero']);
  }
  // Sin la lista de horarios (no cargó) no se puede saber si faltan.
  if (horarios && !horarios.some((item) => item.estado === 'Disponible')) {
    pendientes.push(['horarios', 'Agregá tus días y horarios de atención.', '/perfil-enfermero#horarios']);
  }
  return pendientes;
}
