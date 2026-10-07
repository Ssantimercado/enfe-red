import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MapaEnfermeros from './MapaEnfermeros';

const API_URL = 'http://localhost:5000';
const PAGE_SIZE = 6;

const INITIAL_FILTERS = {
  especialidad: '',
  precio_min: '',
  precio_max: '',
  disponible: '',
  dia_semana: '',
};

const formatPrice = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price > 0
    ? `$${price.toLocaleString('es-AR')}/hora`
    : 'Consultar precio';
};

const initialsFor = (person) => {
  const first = person.nombre?.trim()?.[0] || '';
  const last = person.apellido?.trim()?.[0] || '';
  return `${first}${last}`.toUpperCase() || 'EN';
};

const optionalNumber = (...values) => {
  const value = values.find((item) => item !== null && item !== undefined && item !== '');
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const ListaEnfermerosSprint3 = () => {
  const navigate = useNavigate();
  const [enfermeros, setEnfermeros] = useState([]);
  const [especialidades, setEspecialidades] = useState([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtros, setFiltros] = useState(INITIAL_FILTERS);
  const [pagina, setPagina] = useState(1);
  const [paginacion, setPaginacion] = useState({ total_resultados: 0, total_paginas: 1 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [enfermeroSeleccionado, setEnfermeroSeleccionado] = useState(null);

  const cargarResultados = useCallback(async (signal) => {
    setCargando(true);
    setError('');

    try {
      const params = new URLSearchParams({ page: String(pagina), per_page: String(PAGE_SIZE) });
      if (busqueda.trim()) params.set('q', busqueda.trim());
      if (filtros.especialidad) params.set('especialidad', filtros.especialidad);
      if (filtros.precio_max) params.set('precio_max', filtros.precio_max);
      if (filtros.disponible) params.set('disponible', filtros.disponible);
      if (filtros.dia_semana) params.set('dia_semana', filtros.dia_semana);

      const token = localStorage.getItem('token');
      const response = await fetch(`${API_URL}/api/enfermeros/buscar?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal,
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || 'No se pudo cargar la búsqueda');

      const resultados = Array.isArray(data) ? data : (data.enfermeros || []);
      const minimo = filtros.precio_min ? Number(filtros.precio_min) : null;
      const visibles = Number.isFinite(minimo)
        ? resultados.filter((item) => Number(item.tarifa_hora || 0) >= minimo)
        : resultados;

      setEnfermeros(visibles);
      setPaginacion({
        total_resultados: data.total_resultados ?? visibles.length,
        total_paginas: data.total_paginas ?? 1,
      });
      setEspecialidades((current) => [...new Set([
        ...current,
        ...resultados.map((item) => item.especialidad).filter(Boolean),
      ])].sort((a, b) => a.localeCompare(b, 'es')));
    } catch (requestError) {
      if (requestError.name !== 'AbortError') {
        setError(requestError.message || 'Error de conexión con el servidor');
      }
    } finally {
      if (!signal?.aborted) setCargando(false);
    }
  }, [busqueda, filtros, pagina]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => cargarResultados(controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cargarResultados]);

  const cambiarFiltro = (name, value) => {
    setFiltros((current) => ({ ...current, [name]: value }));
    setPagina(1);
  };

  const limpiarFiltros = () => {
    setBusqueda('');
    setFiltros(INITIAL_FILTERS);
    setPagina(1);
  };

  const hayFiltros = useMemo(
    () => Boolean(busqueda.trim() || Object.values(filtros).some(Boolean)),
    [busqueda, filtros],
  );
  const totalPaginas = Math.max(paginacion.total_paginas || 1, 1);

  return (
    <>
      <style>{`
        .s3-cartilla { min-height: 100vh; background: #f8fafc; padding: 40px 20px 56px; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; }
        .s3-shell { max-width: 1080px; margin: 0 auto; }
        .s3-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 26px; }
        .s3-header h2 { margin: 0 0 6px; color: #2c3e50; font-size: 30px; font-weight: 800; }
        .s3-header p { margin: 0; color: #7f8c8d; font-size: 15px; }
        .s3-panel, .s3-card, .s3-empty, .s3-error { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 8px 22px rgba(15, 23, 42, .05); }
        .s3-panel { padding: 20px; margin-bottom: 24px; }
        .s3-search-row { display: flex; gap: 12px; align-items: center; }
        .s3-search, .s3-select, .s3-number { box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 9px; padding: 11px 12px; color: #334155; background: #fff; font-size: 14px; outline: none; }
        .s3-search { flex: 1; min-width: 0; padding: 13px 15px; font-size: 15px; }
        .s3-search:focus, .s3-select:focus, .s3-number:focus { border-color: #3498db; box-shadow: 0 0 0 3px rgba(52, 152, 219, .14); }
        .s3-filter-label { display: flex; flex-direction: column; gap: 6px; color: #64748b; font-size: 12px; font-weight: 700; }
        .s3-filters { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
        .s3-price-range { display: flex; gap: 7px; }
        .s3-price-range .s3-number { min-width: 0; width: 50%; }
        .s3-filter-button, .s3-back-button, .s3-page-button { border: 1px solid #cbd5e1; background: #fff; color: #475569; border-radius: 9px; padding: 11px 15px; cursor: pointer; font-weight: 700; white-space: nowrap; }
        .s3-back-button { box-shadow: 0 2px 4px rgba(0,0,0,.02); }
        .s3-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 22px 0 14px; }
        .s3-count, .s3-page-number { color: #64748b; font-size: 14px; }
        .s3-clear { border: 0; background: transparent; color: #3498db; cursor: pointer; font-weight: 700; padding: 7px; }
        .s3-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .s3-card { padding: 20px; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 4px 12px rgba(0,0,0,.04); }
        .s3-card-top, .s3-profile, .s3-card-bottom { display: flex; align-items: center; }
        .s3-card-top { justify-content: space-between; align-items: flex-start; gap: 12px; }
        .s3-profile { gap: 13px; min-width: 0; }
        .s3-avatar { width: 58px; height: 58px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
        .s3-avatar-placeholder { display: flex; justify-content: center; align-items: center; background: #e0f2fe; color: #0284c7; font-size: 18px; font-weight: 800; }
        .s3-name { margin: 0 0 5px; color: #1e293b; font-size: 18px; line-height: 1.2; font-weight: 750; }
        .s3-location { margin: 0; color: #64748b; font-size: 13px; }
        .s3-status { border-radius: 999px; padding: 5px 9px; font-size: 11px; font-weight: 750; white-space: nowrap; }
        .s3-status.available { background: #dcfce7; color: #166534; }
        .s3-status.unavailable { background: #f1f5f9; color: #64748b; }
        .s3-specialty { display: inline-flex; align-self: flex-start; background: #e0f2fe; color: #0369a1; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700; }
        .s3-description { min-height: 38px; margin: 0; color: #64748b; font-size: 13px; line-height: 1.45; }
        .s3-meta { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding-top: 13px; border-top: 1px solid #f1f5f9; }
        .s3-meta-item { display: flex; flex-direction: column; gap: 3px; color: #94a3b8; font-size: 11px; }
        .s3-meta-item strong { color: #334155; font-size: 13px; }
        .s3-card-bottom { justify-content: space-between; gap: 12px; }
        .s3-price { color: #0f766e; font-size: 14px; font-weight: 800; }
        .s3-profile-button { border: 0; border-radius: 8px; padding: 10px 14px; color: #fff; background: #3498db; cursor: pointer; font-weight: 700; box-shadow: 0 4px 6px rgba(52, 152, 219, .2); }
        .s3-loading, .s3-empty, .s3-error { padding: 42px 24px; text-align: center; }
        .s3-loading { color: #3498db; font-weight: 700; }
        .s3-empty p { margin: 0 0 15px; color: #64748b; }
        .s3-error { color: #b91c1c; border-color: #fecaca; background: #fff7f7; }
        .s3-pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 24px; }
        .s3-page-button:disabled { cursor: not-allowed; opacity: .45; }
        @media (max-width: 760px) { .s3-cartilla { padding: 25px 14px 42px; } .s3-header { flex-direction: column; } .s3-back-button { align-self: flex-start; } .s3-search-row { flex-direction: column; align-items: stretch; } .s3-filters, .s3-grid { grid-template-columns: 1fr; } }
        @media (max-width: 440px) { .s3-meta { grid-template-columns: 1fr 1fr; } .s3-card-bottom { align-items: stretch; flex-direction: column; } .s3-profile-button { width: 100%; } }
      `}</style>

      <main className="s3-cartilla">
        <div className="s3-shell">
          <header className="s3-header">
            <div>
              <h2>Enfermeros <span style={{ color: '#3498db' }}>disponibles</span></h2>
              <p>Encontrá el profesional adecuado para tu atención domiciliaria.</p>
            </div>
            <button className="s3-back-button" type="button" onClick={() => navigate('/home')}>← Volver al Panel</button>
          </header>

          <section className="s3-panel" aria-label="Buscar y filtrar enfermeros">
            <div className="s3-search-row">
              <input className="s3-search" type="search" value={busqueda} onChange={(event) => { setBusqueda(event.target.value); setPagina(1); }} placeholder="Buscar por nombre, zona o especialidad..." aria-label="Buscar enfermeros" />
              <button className="s3-filter-button" type="button" onClick={() => document.getElementById('s3-filtros')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>⚙ Filtros</button>
            </div>

            <div id="s3-filtros" className="s3-filters">
              <label className="s3-filter-label">Especialidad
                <select className="s3-select" value={filtros.especialidad} onChange={(event) => cambiarFiltro('especialidad', event.target.value)}><option value="">Todas</option>{especialidades.map((item) => <option key={item} value={item}>{item}</option>)}</select>
              </label>
              <label className="s3-filter-label">Precio por hora
                <span className="s3-price-range"><input className="s3-number" type="number" min="0" value={filtros.precio_min} onChange={(event) => cambiarFiltro('precio_min', event.target.value)} placeholder="Desde" aria-label="Precio mínimo" /><input className="s3-number" type="number" min="0" value={filtros.precio_max} onChange={(event) => cambiarFiltro('precio_max', event.target.value)} placeholder="Hasta" aria-label="Precio máximo" /></span>
              </label>
              <label className="s3-filter-label">Disponibilidad
                <select className="s3-select" value={filtros.disponible} onChange={(event) => cambiarFiltro('disponible', event.target.value)}><option value="">Cualquiera</option><option value="true">Disponible ahora</option><option value="false">No disponible</option></select>
              </label>
              <label className="s3-filter-label">Día de atención
                <select className="s3-select" value={filtros.dia_semana} onChange={(event) => cambiarFiltro('dia_semana', event.target.value)}><option value="">Cualquier día</option>{['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((day) => <option key={day} value={day}>{day}</option>)}</select>
              </label>
            </div>

            {hayFiltros && <div className="s3-toolbar"><span className="s3-count">Filtros activos</span><button className="s3-clear" type="button" onClick={limpiarFiltros}>Limpiar filtros</button></div>}
          </section>

          {error ? <div className="s3-error" role="alert"><p>⚠ {error}</p><button className="s3-profile-button" type="button" onClick={() => cargarResultados(new AbortController().signal)}>Reintentar</button></div>
            : cargando ? <div className="s3-loading" role="status">⏳ Buscando profesionales...</div>
              : enfermeros.length === 0 ? <div className="s3-empty"><p>No encontramos enfermeros con esos criterios.</p>{hayFiltros && <button className="s3-profile-button" type="button" onClick={limpiarFiltros}>Ver todos los profesionales</button>}</div>
                : <>
                  <div className="s3-toolbar"><span className="s3-count">{paginacion.total_resultados} profesionales encontrados</span></div>
                  <MapaEnfermeros
                    enfermeros={enfermeros}
                    selectedId={enfermeroSeleccionado}
                    onSelect={setEnfermeroSeleccionado}
                  />
                  <section className="s3-grid" aria-label="Resultados de enfermeros">
                    {enfermeros.map((enfermero) => {
                      const foto = enfermero.foto_url || enfermero.foto || enfermero.imagen;
                      const rating = optionalNumber(enfermero.puntuacion, enfermero.rating, enfermero.calificacion);
                      const distance = optionalNumber(enfermero.distancia_km, enfermero.distanciaKm, enfermero.distancia);
                      const profileId = enfermero.id || enfermero.usuario_id;
                      return <article className="s3-card" key={profileId || enfermero.enfermero_id} onClick={() => setEnfermeroSeleccionado(profileId)} style={{ borderColor: String(enfermeroSeleccionado) === String(profileId) ? '#3498db' : '#e2e8f0', cursor: 'pointer' }}>
                        <div className="s3-card-top"><div className="s3-profile">{foto ? <img className="s3-avatar" src={foto} alt={`Foto de ${enfermero.nombre || 'enfermero'}`} /> : <div className="s3-avatar s3-avatar-placeholder" aria-hidden="true">{initialsFor(enfermero)}</div>}<div><h3 className="s3-name">{enfermero.nombre || 'Profesional'} {enfermero.apellido || ''}</h3><p className="s3-location">📍 {enfermero.ciudad || enfermero.direccion || 'Zona no informada'}</p></div></div><span className={`s3-status ${enfermero.disponible ? 'available' : 'unavailable'}`}>{enfermero.disponible ? 'Disponible' : 'No disponible'}</span></div>
                        <span className="s3-specialty">⚕ {enfermero.especialidad || 'Enfermería general'}</span>
                        <p className="s3-description">{enfermero.descripcion || 'Perfil profesional de enfermería para atención domiciliaria.'}</p>
                        <div className="s3-meta"><span className="s3-meta-item"><strong>{rating === null ? '—' : `★ ${rating.toFixed(1)}`}</strong>Puntuación</span><span className="s3-meta-item"><strong>{distance === null ? '—' : `${distance.toFixed(1)} km`}</strong>Distancia</span><span className="s3-meta-item"><strong>{enfermero.experiencia_anios || 0} años</strong>Experiencia</span></div>
                        <div className="s3-card-bottom"><span className="s3-price">{formatPrice(enfermero.tarifa_hora)}</span><button className="s3-profile-button" type="button" onClick={(event) => { event.stopPropagation(); navigate(`/perfil/${profileId}`); }}>Ver perfil</button></div>
                      </article>;
                    })}
                  </section>
                  {totalPaginas > 1 && <nav className="s3-pagination" aria-label="Paginación de resultados"><button className="s3-page-button" type="button" disabled={pagina <= 1} onClick={() => setPagina((actual) => actual - 1)}>← Anterior</button><span className="s3-page-number">Página {pagina} de {totalPaginas}</span><button className="s3-page-button" type="button" disabled={pagina >= totalPaginas} onClick={() => setPagina((actual) => actual + 1)}>Siguiente →</button></nav>}
                </>}
        </div>
      </main>
    </>
  );
};

export default ListaEnfermerosSprint3;
