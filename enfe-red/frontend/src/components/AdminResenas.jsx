import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { requestApi as api } from '../api';
import DialogoMotivo from './DialogoMotivo';
import { EstrellasLectura, formatoPuntuacion } from './SelectorEstrellas';
import { fechaHora, nombreCompleto, Paginacion, respuestaPaginadaValida } from './adminComun';

const PAGE_SIZE = 10;
const FILTROS = [
  ['todas', 'Todas'],
  ['denunciadas', 'Denunciadas'],
  ['ocultas', 'Ocultas'],
];
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 300;
const MENSAJE_OCULTAR = 'Escribí por qué ocultás la reseña (entre 5 y 300 caracteres).';
const MENSAJE_MOSTRAR = 'El motivo puede tener hasta 300 caracteres.';

function respuestaValida(data) {
  return respuestaPaginadaValida(data, 'resenas') &&
    data.resenas.every((resena) =>
      Number.isInteger(resena.idResena) &&
      Number.isInteger(resena.puntuacion) &&
      typeof resena.oculta === 'boolean',
    );
}

function estadoResena(resena) {
  if (resena.denunciaPendiente) return ['Denuncia sin revisar', 'is-reported'];
  if (resena.oculta) return ['Oculta', 'is-hidden'];
  if (resena.denunciada) return ['Denuncia revisada · visible', ''];
  return ['Visible', ''];
}

// Moderación: el administrador decide si una reseña denunciada (o cualquier otra) se oculta.
export default function AdminResenas() {
  const [params, setParams] = useSearchParams();
  const filtro = FILTROS.some(([valor]) => valor === params.get('filtro')) ? params.get('filtro') : 'todas';
  const [pagina, setPagina] = useState(1);
  const [resenas, setResenas] = useState([]);
  const [paginas, setPaginas] = useState(0);
  const [total, setTotal] = useState(0);
  const [pendientes, setPendientes] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [intento, setIntento] = useState(0);
  // { resena, ocultar }: la reseña que se está por ocultar o dejar visible.
  const [decision, setDecision] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorDialogo, setErrorDialogo] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    const consulta = new URLSearchParams({ filtro, page: String(pagina), per_page: String(PAGE_SIZE) });
    api(`/admin/resenas?${consulta}`, { signal: controller.signal })
      .then((data) => {
        if (!respuestaValida(data)) throw new Error('La respuesta de reseñas no tiene el formato esperado.');
        if (controller.signal.aborted) return;
        setResenas(data.resenas);
        setTotal(data.total_resultados);
        setPaginas(data.total_paginas);
        setPendientes(Number.isInteger(data.denunciadas_pendientes) ? data.denunciadas_pendientes : null);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [filtro, pagina, intento]);

  function cambiarFiltro(valor) {
    setPagina(1);
    setMensaje('');
    setParams(valor === 'todas' ? {} : { filtro: valor }, { replace: true });
  }

  function abrir(resena, ocultar) {
    setErrorDialogo('');
    setMensaje('');
    setDecision({ resena, ocultar });
  }

  async function cambiarVisibilidad(motivo) {
    const { resena, ocultar } = decision;
    setGuardando(true);
    setErrorDialogo('');
    try {
      const data = await api(`/admin/resenas/${resena.idResena}/visibilidad`, {
        method: 'PUT',
        body: motivo ? { oculta: ocultar, motivo } : { oculta: ocultar },
      });
      if (data?.resena?.idResena !== resena.idResena || data.resena.oculta !== ocultar) {
        throw new Error('El servidor no confirmó el cambio de la reseña.');
      }
      // Si tenía una denuncia sin revisar, la decisión la resuelve.
      if (resena.denunciaPendiente && !data.resena.denunciaPendiente) {
        setPendientes((valor) => (valor === null ? null : Math.max(0, valor - 1)));
      }
      setResenas((items) => items.map((item) => (item.idResena === data.resena.idResena ? data.resena : item)));
      const profesional = nombreCompleto(data.resena.enfermero, 'el profesional');
      const promedio = data.calificacionPromedio == null
        ? `${profesional} queda sin reseñas visibles.`
        : `El promedio de ${profesional} ahora es ${formatoPuntuacion(data.calificacionPromedio)} (${data.cantidadResenas} reseña${data.cantidadResenas === 1 ? '' : 's'}).`;
      setMensaje(`${ocultar ? 'Reseña oculta: ya no se muestra en el perfil.' : 'Reseña visible otra vez en el perfil.'} ${promedio}`);
      setDecision(null);
    } catch (err) {
      setErrorDialogo(err.message);
    } finally {
      setGuardando(false);
    }
  }

  const ocultar = decision?.ocultar ?? true;
  const descartaDenuncia = !ocultar && decision?.resena.denunciaPendiente && !decision.resena.oculta;

  return (
    <div className="page-container admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Moderación de reseñas</h1>
          <p>Revisá las reseñas denunciadas por los profesionales y decidí si se muestran.</p>
        </div>
      </header>

      {mensaje && <p className="notice notice-success" role="status">{mensaje}</p>}
      {error && (
        <div className="notice notice-error" role="alert">
          {error}{' '}
          <button className="text-link" type="button" onClick={() => setIntento((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <section className="content-panel admin-users-panel" aria-label="Filtrar reseñas">
        <div className="admin-toolbar">
          <div className="view-switch" role="group" aria-label="Qué reseñas ver">
            {FILTROS.map(([valor, label]) => (
              <button key={valor} type="button" aria-pressed={filtro === valor} onClick={() => cambiarFiltro(valor)}>
                {label}
              </button>
            ))}
          </div>
          {pendientes !== null && (
            <span className={`admin-pending-count ${pendientes > 0 ? 'has-pending' : ''}`}>
              {pendientes === 0
                ? 'Sin denuncias por revisar'
                : `${pendientes} denuncia${pendientes === 1 ? '' : 's'} sin revisar`}
            </span>
          )}
        </div>
        <p className="admin-results-count">
          {cargando
            ? 'Buscando reseñas…'
            : `${total} reseña${total === 1 ? '' : 's'}. Las denuncias sin revisar aparecen primero.`}
        </p>
      </section>

      {cargando ? (
        <p role="status">Cargando reseñas…</p>
      ) : error ? null : resenas.length ? (
        <>
          <ul className="admin-review-list" aria-busy={guardando}>
            {resenas.map((resena) => {
              const [estado, clase] = estadoResena(resena);
              return (
                <li className="content-panel admin-review-card" key={resena.idResena}>
                  <div className="admin-review-top">
                    <EstrellasLectura valor={resena.puntuacion} />
                    <span className={`admin-user-status admin-review-status ${clase}`}>{estado}</span>
                  </div>
                  <h2>Sobre {nombreCompleto(resena.enfermero, 'un profesional')}</h2>
                  <p className="admin-review-meta">
                    De {resena.paciente || 'un paciente'}
                    {fechaHora(resena.fecha) ? ` · ${fechaHora(resena.fecha)}` : ''}
                  </p>
                  {resena.comentario
                    ? <blockquote className="admin-review-comment">{resena.comentario}</blockquote>
                    : <p className="admin-review-empty">Solo dejó estrellas, sin comentario.</p>}
                  {resena.denunciada && resena.motivoDenuncia && (
                    <p className="admin-review-note"><strong>Motivo de la denuncia:</strong> {resena.motivoDenuncia}</p>
                  )}
                  {resena.oculta && resena.motivoOcultamiento && (
                    <p className="admin-review-note"><strong>Por qué se ocultó:</strong> {resena.motivoOcultamiento}</p>
                  )}
                  <div className="admin-review-actions">
                    {resena.oculta ? (
                      <button className="button button-secondary" type="button" disabled={guardando} onClick={() => abrir(resena, false)}>
                        Volver a mostrar
                      </button>
                    ) : (
                      <>
                        {resena.denunciaPendiente && (
                          <button
                            className="button button-secondary"
                            type="button"
                            disabled={guardando}
                            onClick={() => abrir(resena, false)}
                          >
                            Dejar visible
                          </button>
                        )}
                        <button className="button button-primary" type="button" disabled={guardando} onClick={() => abrir(resena, true)}>
                          Ocultar reseña
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Paginacion
            etiqueta="Paginación de reseñas"
            pagina={pagina}
            paginas={paginas}
            cargando={cargando}
            onCambiar={setPagina}
          />
        </>
      ) : (
        <div className="content-panel empty-state">
          <h2>No hay reseñas para mostrar</h2>
          <p>{filtro === 'todas' ? 'Todavía nadie publicó reseñas.' : 'Probá con otro filtro.'}</p>
        </div>
      )}
      <DialogoMotivo
        abierto={decision !== null}
        titulo={ocultar ? '¿Ocultar esta reseña?' : descartaDenuncia ? '¿Dejar visible esta reseña?' : '¿Mostrar esta reseña?'}
        descripcion={ocultar
          ? 'Deja de verse en el perfil del profesional y no cuenta para su promedio. El paciente la sigue viendo en su historial.'
          : descartaDenuncia
            ? 'La reseña sigue a la vista y la denuncia queda revisada.'
            : 'Vuelve a verse en el perfil del profesional y a contar para su promedio.'}
        etiqueta={ocultar ? '¿Por qué la ocultás? Queda registrado en la auditoría.' : 'Comentario para la auditoría (opcional)'}
        minimo={ocultar ? MOTIVO_MIN : 0}
        maximo={MOTIVO_MAX}
        mensajeMotivo={ocultar ? MENSAJE_OCULTAR : MENSAJE_MOSTRAR}
        textoConfirmar={ocultar ? 'Sí, ocultar' : descartaDenuncia ? 'Sí, dejar visible' : 'Sí, mostrar'}
        guardando={guardando}
        error={errorDialogo}
        onConfirmar={cambiarVisibilidad}
        onCerrar={() => setDecision(null)}
      />
    </div>
  );
}
