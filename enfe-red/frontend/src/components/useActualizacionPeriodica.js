import { useEffect, useRef } from 'react';

export const CADA_MS = 45000;

// Igual que la campana: cada 45 s con la pestaña visible y apenas la persona vuelve a ella.
// Se usa setTimeout encadenado para no superponer consultas si el servidor tarda.
export default function useActualizacionPeriodica(actualizar, activo = true) {
  const ultima = useRef(actualizar);
  useEffect(() => {
    ultima.current = actualizar;
  });
  useEffect(() => {
    if (!activo) return undefined;
    let timer;
    function programar() {
      timer = window.setTimeout(() => {
        if (!document.hidden) ultima.current();
        programar();
      }, CADA_MS);
    }
    function alVolver() {
      if (!document.hidden) ultima.current();
    }
    programar();
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [activo]);
}
