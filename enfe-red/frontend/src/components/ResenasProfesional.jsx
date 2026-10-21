import { useEffect, useState } from 'react';
import { requestApi as api } from '../api';
import Icon from './ui/Icon';
import { EstrellasLectura, formatoPuntuacion } from './SelectorEstrellas';

function respuestaValida(data) {
  return Array.isArray(data?.resenas) &&
    Number.isInteger(data.cantidadResenas) &&
    data.resenas.every((resena) =>
      Number.isInteger(resena.idResena) &&
      Number.isInteger(resena.puntuacion) &&
      typeof resena.comentario === 'string',
    );
}

function fechaLegible(valor) {
  const fecha = new Date(valor);
  if (!valor || Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// SCRUM-67.2: reseñas que dejaron los pacientes; idEnfermero es el ID de perfil.
export default function ResenasProfesional({ idEnfermero }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setDatos(null);
    setError('');
    api(`/enfermeros/${idEnfermero}/resenas`, { signal: controller.signal })
      .then((data) => {
        if (!respuestaValida(data)) {
          throw new Error('La respuesta de reseñas no tiene el formato esperado.');
        }
        if (!controller.signal.aborted) setDatos(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [idEnfermero, intento]);

  const cantidad = datos?.cantidadResenas ?? 0;

  return (
    <section
      className="content-panel profile-reviews"
      aria-labelledby="resenas-titulo"
      aria-busy={!datos && !error}
    >
      <h2 className="panel-title" id="resenas-titulo">
        <Icon name="star" />
        Reseñas de pacientes
      </h2>
      {error ? (
        <div className="notice notice-error" role="alert">
          {error}{' '}
          <button className="text-link" type="button" onClick={() => setIntento((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      ) : !datos ? (
        <p role="status">Cargando reseñas…</p>
      ) : !datos.resenas.length ? (
        <p>
          Todavía no tiene reseñas. Los pacientes pueden publicarlas después de
          una atención realizada.
        </p>
      ) : (
        <>
          {datos.calificacionPromedio != null && (
            <div className="profile-reviews-summary">
              <strong>{formatoPuntuacion(datos.calificacionPromedio)}</strong>
              <EstrellasLectura valor={datos.calificacionPromedio} />
              <span>
                {cantidad} {cantidad === 1 ? 'reseña' : 'reseñas'}
              </span>
            </div>
          )}
          <ul className="profile-reviews-list">
            {datos.resenas.map((resena) => (
              <li key={resena.idResena}>
                <div className="profile-review-heading">
                  <strong>{resena.paciente || 'Paciente'}</strong>
                  {fechaLegible(resena.fecha) && (
                    <time dateTime={resena.fecha}>{fechaLegible(resena.fecha)}</time>
                  )}
                </div>
                <EstrellasLectura valor={resena.puntuacion} />
                <p>{resena.comentario}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
