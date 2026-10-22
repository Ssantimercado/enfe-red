import { estadoMatricula } from './perfilPendiente';

// Le explica al enfermero en qué está la revisión de su matrícula y qué le falta para aparecer.
export default function AvisoMatricula({ perfil, mostrarVerificada = false }) {
  const estado = estadoMatricula(perfil);
  if (estado === 'verificada') {
    return mostrarVerificada ? (
      <p className="notice notice-success aviso-matricula">
        Tu matrícula está verificada. Tu perfil aparece en la cartilla.
      </p>
    ) : null;
  }
  if (estado === 'rechazada') {
    return (
      <div className="notice notice-error aviso-matricula">
        <strong>No pudimos verificar tu matrícula.</strong>
        {perfil.motivoRechazo && <p>Motivo: {perfil.motivoRechazo}</p>}
        <p>
          Corregí tus datos y guardá el perfil para que la revisemos de nuevo.
          Mientras tanto tu perfil no aparece en la cartilla.
        </p>
      </div>
    );
  }
  return (
    <div className="notice notice-info aviso-matricula">
      {estado === 'sin_cargar' ? (
        <>
          <strong>Todavía no cargaste tu matrícula.</strong>
          <p>
            Sin una matrícula verificada tu perfil no aparece en la cartilla.
            Escribila en tus datos profesionales y guardá los cambios.
          </p>
        </>
      ) : (
        <>
          <strong>Estamos revisando tu matrícula.</strong>
          <p>
            Hasta que la verifiquemos, tu perfil no aparece en la cartilla y no
            podés aceptar solicitudes.
          </p>
        </>
      )}
    </div>
  );
}
