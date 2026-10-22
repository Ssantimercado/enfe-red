import { useEffect, useState } from 'react';
import { requestApi as api } from '../api';
import DialogoMotivo from './DialogoMotivo';
import Icon from './ui/Icon';
import { EstrellasLectura, formatoPuntuacion } from './SelectorEstrellas';

// Mismos límites y texto que el backend (POST /resenas/<id>/denunciar).
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 300;
const MENSAJE_MOTIVO = 'Contanos por qué querés denunciar esta reseña (entre 5 y 300 caracteres).';

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
  const [denunciando, setDenunciando] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [errorDenuncia, setErrorDenuncia] = useState('');
  const [aviso, setAviso] = useState(null);

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

  function marcarDenunciada(idResena) {
    setDatos((actual) => ({
      ...actual,
      resenas: actual.resenas.map((resena) => (resena.idResena === idResena ? { ...resena, denunciada: true } : resena)),
    }));
  }

  async function denunciar(motivo) {
    const idResena = denunciando;
    setEnviando(true);
    setErrorDenuncia('');
    try {
      const respuesta = await api(`/resenas/${idResena}/denunciar`, { method: 'POST', body: { motivo } });
      marcarDenunciada(idResena);
      setAviso({ idResena, texto: respuesta?.mensaje || 'Recibimos tu denuncia. El equipo de Enfered va a revisar la reseña.' });
      setDenunciando(null);
    } catch (err) {
      if (err.status === 409) {
        // Ya estaba denunciada (por ejemplo desde otra pestaña): se muestra como enviada.
        marcarDenunciada(idResena);
        setAviso({ idResena, texto: err.message });
        setDenunciando(null);
      } else {
        setErrorDenuncia(err.message);
      }
    } finally {
      setEnviando(false);
    }
  }

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
                {resena.comentario && <p>{resena.comentario}</p>}
                {/* Solo el profesional calificado recibe "denunciada": para él es la moderación de su perfil. */}
                {typeof resena.denunciada === 'boolean' && (
                  resena.denunciada ? (
                    <p className="field-hint">Denuncia enviada. El equipo de Enfered la está revisando.</p>
                  ) : (
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => {
                        setErrorDenuncia('');
                        setAviso(null);
                        setDenunciando(resena.idResena);
                      }}
                    >
                      Denunciar esta reseña
                    </button>
                  )
                )}
                {aviso?.idResena === resena.idResena && (
                  <p className="notice notice-success" role="status">{aviso.texto}</p>
                )}
              </li>
            ))}
          </ul>
          <DialogoMotivo
            abierto={denunciando !== null}
            titulo="Denunciar reseña"
            descripcion="Contanos qué tiene de malo esta reseña (por ejemplo, si es ofensiva o falsa). Sigue visible hasta que el equipo de Enfered la revise."
            etiqueta="Motivo de la denuncia"
            minimo={MOTIVO_MIN}
            maximo={MOTIVO_MAX}
            mensajeMotivo={MENSAJE_MOTIVO}
            textoConfirmar="Enviar denuncia"
            textoGuardando="Enviando…"
            guardando={enviando}
            error={errorDenuncia}
            onConfirmar={denunciar}
            onCerrar={() => setDenunciando(null)}
          />
        </>
      )}
    </section>
  );
}
