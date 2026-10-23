import { useEffect, useState } from 'react';
import { requestApi as api } from '../api';
import { fechaHora, Paginacion, respuestaPaginadaValida } from './adminComun';

const PAGE_SIZE = 20;
const ACCIONES = {
  suspender_usuario: 'Suspendió una cuenta',
  reactivar_usuario: 'Reactivó una cuenta',
  aprobar_matricula: 'Aprobó una matrícula',
  rechazar_matricula: 'Rechazó una matrícula',
  ocultar_resena: 'Ocultó una reseña',
  mostrar_resena: 'Dejó visible una reseña',
  crear_servicio: 'Agregó un servicio',
  editar_servicio: 'Editó un servicio',
  baja_servicio: 'Dio de baja un servicio',
  alta_servicio: 'Volvió a ofrecer un servicio',
};
const OBJETIVOS = {
  usuario: 'Usuario',
  enfermero: 'Profesional',
  resena: 'Reseña',
  servicio: 'Servicio',
};

function respuestaValida(data) {
  return respuestaPaginadaValida(data, 'registros') &&
    data.registros.every((registro) =>
      Number.isInteger(registro.idAuditoria) && typeof registro.accion === 'string',
    );
}

// Registro de lo que hicieron los administradores, del más reciente al más viejo.
export default function AdminAuditoria() {
  const [accion, setAccion] = useState('');
  const [pagina, setPagina] = useState(1);
  const [registros, setRegistros] = useState([]);
  const [paginas, setPaginas] = useState(0);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setCargando(true);
    setError('');
    const consulta = new URLSearchParams({ page: String(pagina), per_page: String(PAGE_SIZE) });
    if (accion) consulta.set('accion', accion);
    api(`/admin/auditoria?${consulta}`, { signal: controller.signal })
      .then((data) => {
        if (!respuestaValida(data)) throw new Error('La respuesta de la auditoría no tiene el formato esperado.');
        if (controller.signal.aborted) return;
        setRegistros(data.registros);
        setTotal(data.total_resultados);
        setPaginas(data.total_paginas);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setCargando(false);
      });
    return () => controller.abort();
  }, [accion, pagina, intento]);

  return (
    <div className="page-container admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">ADMINISTRACIÓN</span>
          <h1>Auditoría</h1>
          <p>Qué hizo cada administrador: suspensiones, matrículas, reseñas y servicios.</p>
        </div>
      </header>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}{' '}
          <button className="text-link" type="button" onClick={() => setIntento((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      )}

      <section className="content-panel admin-users-panel" aria-label="Filtrar la auditoría">
        <label className="field admin-audit-filter">
          Tipo de acción
          <select
            value={accion}
            onChange={(event) => {
              setAccion(event.target.value);
              setPagina(1);
            }}
          >
            <option value="">Todas las acciones</option>
            {Object.entries(ACCIONES).map(([valor, label]) => (
              <option key={valor} value={valor}>{label}</option>
            ))}
          </select>
        </label>
        <p className="admin-results-count">
          {cargando ? 'Buscando registros…' : `${total} registro${total === 1 ? '' : 's'}`}
        </p>
      </section>

      {cargando ? (
        <p role="status">Cargando la auditoría…</p>
      ) : error ? null : registros.length ? (
        <>
          <ol className="admin-audit-list">
            {registros.map((registro) => (
              <li className="content-panel admin-audit-item" key={registro.idAuditoria}>
                <div className="admin-audit-top">
                  <h2>{ACCIONES[registro.accion] || registro.accion}</h2>
                  {fechaHora(registro.fecha) && (
                    <time dateTime={registro.fecha}>{fechaHora(registro.fecha)}</time>
                  )}
                </div>
                <p className="admin-review-meta">
                  Por {registro.adminEmail || `el administrador N.º ${registro.idAdmin}`}
                  {registro.idObjetivo != null
                    ? ` · ${OBJETIVOS[registro.tipoObjetivo] || 'Elemento'} N.º ${registro.idObjetivo}`
                    : ''}
                </p>
                {registro.detalle && <p className="admin-audit-detail">{registro.detalle}</p>}
              </li>
            ))}
          </ol>
          <Paginacion
            etiqueta="Paginación de la auditoría"
            pagina={pagina}
            paginas={paginas}
            cargando={cargando}
            onCambiar={setPagina}
          />
        </>
      ) : (
        <div className="content-panel empty-state">
          <h2>Todavía no hay registros</h2>
          <p>{accion ? 'No hay acciones de este tipo. Probá con otra.' : 'Acá vas a ver cada suspensión, matrícula revisada y reseña moderada.'}</p>
        </div>
      )}
    </div>
  );
}
