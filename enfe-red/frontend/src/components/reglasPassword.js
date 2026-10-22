// Misma regla que el backend (routes/auth_routes.py): al menos 8 caracteres y hasta 72 bytes.
export const MIN_PASSWORD = 8;
const MAX_PASSWORD_BYTES = 72;

export function errorPasswordNueva(password) {
  if (password.length < MIN_PASSWORD) return `La contraseña nueva tiene que tener al menos ${MIN_PASSWORD} caracteres.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) return 'La contraseña nueva es demasiado larga (máximo 72 caracteres).';
  return '';
}
