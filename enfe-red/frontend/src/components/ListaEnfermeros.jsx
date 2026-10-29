import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Avatar from './ui/Avatar';
import Icon from './ui/Icon';
import DirectoryFilters from './DirectoryFilters';
import { nombreServicios } from './nombreServicios';
import BusquedaAsistida from './BusquedaAsistida';
import { formatoPuntuacion } from './SelectorEstrellas';
import { requestApi as api, formatPrice, sesionActual } from '../api';
import { buscarDireccion } from './useUbicacion';
const MapaEnfermeros = lazy(() => import('./MapaEnfermeros'));

const FILTERS = [
  'servicio',
  'especialidad',
  'ciudad',
  'precio_min',
  'precio_max',
  'dia_semana',
  'hora_desde',
  'hora_hasta',
];
// HU3 "enfermeros cercanos": la ubicación del paciente ordena los resultados por distancia.
const UBICACION = ['lat', 'lng', 'radio_km'];
// horario=parcial: el horario vino de la búsqueda asistida ("a la tarde") y alcanza con atender en parte de él.
const HORARIO_PARCIAL = 'horario';
const HORAS = ['hora_desde', 'hora_hasta'];
const RADIOS_KM = ['5', '10', '25', '50'];
// El mapa junta todas las páginas del filtro (100 por pedido, el máximo del backend).
const POR_PAGINA_MAPA = 100;
const MAX_PAGINAS_MAPA = 10;
const optionalNumber = (value) =>
  value == null || value === '' || !Number.isFinite(Number(value))
    ? null
    : Number(value);

export default function ListaEnfermeros() {
  const nurse = sesionActual()?.rol === 'enfermero';
  const [params, setParams] = useSearchParams();
  const query = params.get('q') || '';
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1);
  const filterValues = Object.fromEntries(
    FILTERS.map((key) => [key, params.get(key) || '']),
  );
  const requestKey = new URLSearchParams(
    [...params].filter(([key]) =>
      nurse
        ? key === 'q' || key === 'page'
        : FILTERS.includes(key) || UBICACION.includes(key) || key === HORARIO_PARCIAL || key === 'q' || key === 'page',
    ),
  ).toString();
  const mapKey = new URLSearchParams(
    [...new URLSearchParams(requestKey)].filter(([key]) => key !== 'page'),
  ).toString();
  const cercania = !nurse && params.get('lat') && params.get('lng');
  const [ubicando, setUbicando] = useState(false);
  const [errorUbicacion, setErrorUbicacion] = useState('');
  // HU3 "el usuario pueda ingresar su ubicación": además del GPS, una dirección escrita a mano.
  const [direccionCerca, setDireccionCerca] = useState('');
  const [lugarCerca, setLugarCerca] = useState('');
  const [buscandoLugar, setBuscandoLugar] = useState(false);
  const [data, setData] = useState({
    enfermeros: [],
    total_resultados: 0,
    total_paginas: 0,
  });
  const [specialties, setSpecialties] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [mapa, setMapa] = useState({ clave: null, personas: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftFilters, setDraftFilters] = useState(filterValues);
  const showMap = params.get('vista') === 'mapa';
  const [selected, setSelected] = useState(null);
  const mapRef = useRef(null);
  const filterDialog = useRef(null);
  const invalidDraft =
    draftFilters.precio_min !== '' &&
    draftFilters.precio_max !== '' &&
    Number(draftFilters.precio_min) > Number(draftFilters.precio_max);
  const invalidDraftHours =
    (draftFilters.hora_desde === '') !== (draftFilters.hora_hasta === '') ||
    (draftFilters.hora_desde !== '' &&
      draftFilters.hora_hasta !== '' &&
      draftFilters.hora_desde >= draftFilters.hora_hasta);
  const invalidRange =
    filterValues.precio_min !== '' &&
    filterValues.precio_max !== '' &&
    Number(filterValues.precio_min) > Number(filterValues.precio_max);
  const invalidHoursRange =
    (filterValues.hora_desde === '') !== (filterValues.hora_hasta === '') ||
    (filterValues.hora_desde !== '' &&
      filterValues.hora_hasta !== '' &&
      filterValues.hora_desde >= filterValues.hora_hasta);

  useEffect(() => {
    if (!filtersOpen) return;
    const dialog = filterDialog.current;
    const originalOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    const desktop = window.matchMedia('(min-width: 801px)');
    const closeOnDesktop = () => {
      if (desktop.matches) setFiltersOpen(false);
    };
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      dialog.close();
      document.body.style.overflow = originalOverflow;
      desktop.removeEventListener('change', closeOnDesktop);
    };
  }, [filtersOpen]);

  useEffect(() => {
    if (nurse) return undefined;
    const controller = new AbortController();
    api('/enfermeros', { signal: controller.signal })
      .then((list) => {
        // "Pediatria" y "Pediatría" son la misma especialidad: queda la primera forma escrita
        // (la búsqueda del servidor no distingue tildes ni mayúsculas).
        const unicas = new Map();
        list.forEach((person) => {
          const nombre = String(person.especialidad || '').trim();
          const clave = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
          if (nombre && !unicas.has(clave)) unicas.set(clave, nombre);
        });
        setSpecialties([...unicas.values()].sort((a, b) => a.localeCompare(b, 'es')));
      })
      .catch(() => {});
    api('/enfermeros/ciudades', { signal: controller.signal })
      .then((lista) => setZonas(Array.isArray(lista) ? lista : []))
      .catch(() => {});
    api('/servicios', { signal: controller.signal })
      .then((lista) => setServicios(Array.isArray(lista) ? lista : []))
      .catch(() => {});
    return () => controller.abort();
  }, [nurse]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setSelected(null);
    if (!nurse && (invalidRange || invalidHoursRange)) {
      setLoading(false);
      return () => controller.abort();
    }
    const timer = setTimeout(async () => {
      try {
        const search = new URLSearchParams(requestKey);
        search.set('per_page', '6');
        search.set('page', String(page));
        const results = nurse
          ? await api(`/pacientes/solicitudes-activas?${search}`, {
            signal: controller.signal,
          }).then((response) => ({ ...response, enfermeros: response.pacientes }))
          : await api(`/enfermeros/buscar?${search}`, {
            signal: controller.signal,
          });
        if (!controller.signal.aborted) setData(results);
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, page, retry, invalidRange, invalidHoursRange, nurse]);

  // El mapa muestra a todos los que cumplen el filtro, no solo a los de la página actual.
  useEffect(() => {
    if (!showMap || (!nurse && (invalidRange || invalidHoursRange))) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const ruta = nurse ? '/pacientes/solicitudes-activas' : '/enfermeros/buscar';
      const personas = [];
      try {
        for (let pagina = 1; pagina <= MAX_PAGINAS_MAPA; pagina += 1) {
          const search = new URLSearchParams(mapKey);
          search.set('per_page', String(POR_PAGINA_MAPA));
          search.set('page', String(pagina));
          const resultado = await api(`${ruta}?${search}`, { signal: controller.signal });
          personas.push(...((nurse ? resultado.pacientes : resultado.enfermeros) || []));
          if (pagina >= (resultado.total_paginas || 0)) break;
        }
        if (!controller.signal.aborted) setMapa({ clave: mapKey, personas });
      } catch {
        // Si falla, el mapa sigue mostrando a los de la página actual.
        if (!controller.signal.aborted) setMapa({ clave: mapKey, personas: null });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [showMap, mapKey, nurse, invalidRange, invalidHoursRange, retry]);
  const personasMapa = mapa.clave === mapKey && mapa.personas ? mapa.personas : data.enfermeros;

  function update(key, value) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        if (key !== 'page' && key !== 'vista') next.delete('page');
        return next;
      },
      { replace: key !== 'page' },
    );
  }
  function ordenarDesde(lat, lng, lugar = '') {
    setLugarCerca(lugar);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        // Tres decimales (~100 m): alcanza para ordenar sin enviar la ubicación exacta.
        next.set('lat', lat.toFixed(3));
        next.set('lng', lng.toFixed(3));
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  async function buscarCercaDeDireccion(event) {
    event.preventDefault();
    if (buscandoLugar) return;
    const texto = direccionCerca.trim();
    setErrorUbicacion('');
    if (texto.length < 4) {
      setErrorUbicacion('Escribí la dirección con calle, número y departamento. Por ejemplo: Belgrano 450, Godoy Cruz.');
      return;
    }
    setBuscandoLugar(true);
    try {
      const lugar = await buscarDireccion(texto);
      if (!Number.isFinite(lugar?.latitud) || !Number.isFinite(lugar?.longitud)) throw new Error('Respuesta inválida');
      ordenarDesde(lugar.latitud, lugar.longitud, lugar.descripcion || texto);
    } catch (err) {
      setErrorUbicacion(err.status === 404
        ? 'No encontramos esa dirección. Revisala (calle, número y departamento) o elegí el departamento en los filtros.'
        : 'No pudimos buscar la dirección en este momento. Probá de nuevo o elegí el departamento en los filtros.');
    } finally {
      setBuscandoLugar(false);
    }
  }
  function ordenarPorCercania() {
    setErrorUbicacion('');
    if (!navigator.geolocation) {
      setErrorUbicacion('Tu navegador no permite obtener la ubicación. Escribí una dirección o elegí el departamento en los filtros.');
      return;
    }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setUbicando(false);
        ordenarDesde(coords.latitude, coords.longitude);
      },
      () => {
        setUbicando(false);
        setErrorUbicacion('No pudimos obtener tu ubicación. Revisá el permiso del navegador, escribí una dirección o elegí el departamento.');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }
  // HU12: reemplaza los filtros por los que interpretó la búsqueda asistida.
  function aplicarBusquedaAsistida(filtros, { horarioParcial = false } = {}) {
    // Los servicios llegan por su nombre ("Inyecciones"); la cartilla filtra por su número. Si el pedido tiene
    // varias tareas ("curar y medir la insulina"), van todas y aparecen quienes las ofrecen todas.
    const nombres = filtros.servicios?.length ? filtros.servicios : [filtros.servicio].filter(Boolean);
    const ids = nombres
      .map((nombre) => servicios.find((item) => item.tipoServicio === nombre)?.idServicio)
      .filter((id) => id != null);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        FILTERS.forEach((key) => next.delete(key));
        next.delete(HORARIO_PARCIAL);
        ['especialidad', 'ciudad', 'dia_semana', 'hora_desde', 'hora_hasta'].forEach((key) => {
          if (filtros[key]) next.set(key, filtros[key]);
        });
        if (ids.length) next.set('servicio', ids.join(','));
        if (horarioParcial && filtros.hora_desde) next.set(HORARIO_PARCIAL, 'parcial');
        next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  // Desde y hasta van juntos: con uno solo la búsqueda no es válida.
  function quitarFiltro(key) {
    if (!HORAS.includes(key)) {
      update(key, '');
      return;
    }
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        HORAS.forEach((hora) => next.delete(hora));
        next.delete(HORARIO_PARCIAL);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  function quitarCercania() {
    setLugarCerca('');
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        UBICACION.forEach((key) => next.delete(key));
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }
  function clear(keepQuery = false) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        FILTERS.forEach((key) => next.delete(key));
        UBICACION.forEach((key) => next.delete(key));
        next.delete(HORARIO_PARCIAL);
        next.delete('disponible');
        next.delete('page');
        if (!keepQuery) next.delete('q');
        return next;
      },
      { replace: true },
    );
  }
  function applyFilters(event) {
    event.preventDefault();
    if (invalidDraft || invalidDraftHours) return;
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('disponible');
        // Si cambió el horario a mano, vuelve el filtro de siempre (que la franja lo cubra entero).
        if (HORAS.some((key) => (draftFilters[key] || '') !== (current.get(key) || ''))) next.delete(HORARIO_PARCIAL);
        FILTERS.forEach((key) => {
          if (draftFilters[key]) next.set(key, draftFilters[key]);
          else next.delete(key);
        });
        next.delete('page');
        return next;
      },
      { replace: true },
    );
    setFiltersOpen(false);
  }
  const active = nurse ? [] : FILTERS.filter((key) => filterValues[key]);
  const horarioParcial = params.get(HORARIO_PARCIAL) === 'parcial';
  const hasFilters = Boolean(query || active.length || cercania);
  const labels = {
    servicio: nombreServicios(filterValues.servicio, servicios) || 'Servicio elegido',
    especialidad: filterValues.especialidad,
    ciudad: filterValues.ciudad,
    precio_min: `Desde $${Number(filterValues.precio_min).toLocaleString('es-AR')}`,
    precio_max: `Hasta $${Number(filterValues.precio_max).toLocaleString('es-AR')}`,
    dia_semana: filterValues.dia_semana,
    hora_desde: horarioParcial
      ? `Atiende entre ${filterValues.hora_desde} y ${filterValues.hora_hasta}`
      : `Desde ${filterValues.hora_desde}`,
    hora_hasta: `Hasta ${filterValues.hora_hasta}`,
  };
  const profileState = {
    from: `/cartilla${params.size ? `?${params}` : ''}`,
  };

  return (
    <div className="page-container">
      <header className="page-heading">
        <div>
          <span className="eyebrow">
            {nurse ? 'PACIENTES ASIGNADOS' : 'ENCONTRÁ TU PROFESIONAL'}
          </span>
          <h1>{nurse ? 'Tus pacientes.' : 'El cuidado empieza acá.'}</h1>
          <p>
            {nurse
              ? 'Consultá a quienes te enviaron solicitudes y las ubicaciones que comparten mientras tengan una solicitud activa.'
              : 'Explorá perfiles y encontrá atención de enfermería para vos o tu familia.'}
          </p>
        </div>
      </header>
      <div className="directory-search" role="search">
        <Icon name="search" size={22} />
        <input
          type="search"
          aria-label={nurse ? 'Buscar pacientes por nombre' : 'Buscar por nombre, zona o especialidad'}
          placeholder={nurse ? 'Nombre del paciente' : 'Nombre, zona o especialidad'}
          value={query}
          onChange={(e) => update('q', e.target.value)}
        />
        {!nurse && <button
          type="button"
          className="button button-secondary mobile-filter-button"
          aria-label={`Mostrar filtros${active.length ? `, ${active.length} activos` : ''}`}
          aria-controls="filtros-mobile"
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onClick={() => {
            setDraftFilters(filterValues);
            setFiltersOpen(true);
          }}
        >
          <Icon name="sliders" size={18} />
          <span>Filtros</span>
          {active.length > 0 && (
            <span className="filter-count">{active.length}</span>
          )}
        </button>}
      </div>
      {!nurse && <BusquedaAsistida onAplicar={aplicarBusquedaAsistida} />}
      {!nurse && (
        <div className="nearby-search" role="group" aria-label="Buscar cerca de tu ubicación">
          {cercania ? (
            <>
              <p className="nearby-status">
                <Icon name="pin" size={18} />
                Mostrando primero a los profesionales más cercanos a {lugarCerca || 'tu ubicación'}.
              </p>
              <label className="nearby-radius">
                Distancia máxima
                <select
                  value={params.get('radio_km') || ''}
                  onChange={(e) => update('radio_km', e.target.value)}
                >
                  <option value="">Sin límite</option>
                  {RADIOS_KM.map((km) => (
                    <option key={km} value={km}>Hasta {km} km</option>
                  ))}
                </select>
              </label>
              <button type="button" className="text-link" onClick={quitarCercania}>Cambiar ubicación</button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="button button-secondary"
                onClick={ordenarPorCercania}
                disabled={ubicando || buscandoLugar}
              >
                <Icon name="pin" size={18} />
                {ubicando ? 'Buscando tu ubicación…' : 'Ordenar por cercanía'}
              </button>
              <form className="nearby-address" onSubmit={buscarCercaDeDireccion} noValidate>
                <label htmlFor="cerca-direccion">o escribí una dirección</label>
                <input
                  id="cerca-direccion"
                  type="text"
                  autoComplete="street-address"
                  maxLength={200}
                  placeholder="Ej.: Belgrano 450, Godoy Cruz"
                  value={direccionCerca}
                  onChange={(e) => setDireccionCerca(e.target.value)}
                  disabled={buscandoLugar}
                />
                <button type="submit" className="button button-secondary" aria-disabled={buscandoLugar}>
                  {buscandoLugar ? 'Buscando…' : 'Buscar cerca de ahí'}
                </button>
              </form>
            </>
          )}
          {errorUbicacion && <p className="notice notice-error" role="alert">{errorUbicacion}</p>}
        </div>
      )}
      <div className={`directory-layout ${nurse ? 'patient-directory-layout' : ''}`}>
        {!nurse && (
        <aside
          id="filtros"
          className="filters-panel"
          aria-label="Filtros de búsqueda"
        >
          <div className="filters-heading">
            <h2>
              <Icon name="sliders" size={17} />
              Filtros
            </h2>
            {active.length > 0 && (
              <button
                type="button"
                className="text-link"
                onClick={() => clear(true)}
              >
                Limpiar
              </button>
            )}
          </div>
          <DirectoryFilters
            values={filterValues}
            specialties={specialties}
            zonas={zonas}
            servicios={servicios}
            onChange={update}
            prefix="desktop"
          />
          <div className="filter-help">
            <Icon name="heart" size={21} />
            <strong>Cada cuidado es diferente.</strong>
            <p>
              Consultá el perfil para conocer los horarios y coordinar la
              atención.
            </p>
          </div>
        </aside>
        )}
        <section aria-label="Resultados de búsqueda" aria-busy={loading}>
          <div className="results-toolbar">
            <p className="results-count" role="status">
              {loading ? (
                nurse ? 'Buscando pacientes…' : 'Buscando profesionales…'
              ) : error || (!nurse && (invalidRange || invalidHoursRange)) ? (
                'Revisá tu búsqueda'
              ) : (
                <>
                  <strong>{data.total_resultados}</strong>{' '}
                  {data.total_resultados === 1
                    ? (nurse ? 'paciente encontrado' : 'profesional encontrado')
                    : (nurse ? 'pacientes encontrados' : 'profesionales encontrados')}
                </>
              )}
            </p>
            <div className="view-switch" aria-label="Vista de resultados">
              <button
                type="button"
                aria-pressed={!showMap}
                onClick={() => update('vista', '')}
              >
                <Icon name="grid" size={15} />
                Lista
              </button>
              <button
                type="button"
                aria-pressed={showMap}
                onClick={() => update('vista', 'mapa')}
              >
                <Icon name="map" size={15} />
                Mapa
              </button>
            </div>
          </div>
          {hasFilters && (
            <div className="active-filters">
              {query && (
                <button
                  className="filter-chip"
                  onClick={() => update('q', '')}
                  aria-label={`Quitar búsqueda ${query}`}
                >
                  “{query}”<Icon name="close" size={13} />
                </button>
              )}
              {cercania && (
                <button
                  className="filter-chip"
                  onClick={quitarCercania}
                  aria-label="Quitar orden por cercanía"
                >
                  Cerca de {lugarCerca || 'tu ubicación'}
                  {params.get('radio_km') ? ` · hasta ${params.get('radio_km')} km` : ''}
                  <Icon name="close" size={13} />
                </button>
              )}
              {active.filter((key) => !(horarioParcial && key === 'hora_hasta')).map((key) => (
                <button
                  className="filter-chip"
                  key={key}
                  onClick={() => quitarFiltro(key)}
                  aria-label={`Quitar filtro ${labels[key]}`}
                >
                  {labels[key]}
                  <Icon name="close" size={13} />
                </button>
              ))}
            </div>
          )}
          {!nurse && (invalidRange || invalidHoursRange) ? (
            <div className="notice notice-error" role="alert">
              {invalidRange
                ? 'El precio mínimo debe ser menor o igual al máximo.'
                : filterValues.hora_desde === '' || filterValues.hora_hasta === ''
                  ? 'Completá las horas desde y hasta para filtrar por horario.'
                  : 'La hora desde debe ser anterior a la hora hasta.'}
            </div>
          ) : error ? (
            <div className="empty-state" role="alert">
              <h2>No pudimos cargar los perfiles.</h2>
              <p>{error}</p>
              <button
                className="button button-primary"
                onClick={() => setRetry((v) => v + 1)}
              >
                Reintentar
              </button>
            </div>
          ) : loading ? (
            <div className="professional-grid" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <div className="skeleton-card" key={i}>
                  <div className="skeleton avatar" />
                  <div className="skeleton" />
                  <div className="skeleton wide" />
                  <div className="skeleton" />
                </div>
              ))}
            </div>
          ) : data.enfermeros.length === 0 ? (
            <>
              {showMap && (
                <div className="results-map" ref={mapRef}>
                  <Suspense fallback={<p role="status">Cargando mapa…</p>}>
                    <MapaEnfermeros
                      personas={personasMapa}
                      tipoPersona={nurse ? 'paciente' : 'enfermero'}
                      selectedId={selected}
                      onSelect={setSelected}
                      volverA={profileState.from}
                    />
                  </Suspense>
                  <p className="map-results-note">
                    {nurse
                      ? 'El mapa muestra el lugar de atención de tus turnos pendientes y aceptados. Lo ves solo mientras el turno sigue en curso.'
                      : 'El mapa muestra a todos los profesionales de esta búsqueda que informaron su zona. La ubicación es aproximada.'}
                  </p>
                </div>
              )}
              <div className="empty-state">
                <span className="soft-icon">
                  <Icon name="search" size={26} />
                </span>
                <h2>{nurse ? 'Todavía no hay pacientes que te hayan enviado solicitudes.' : 'Probemos con otra búsqueda.'}</h2>
                <p>
                  {nurse
                    ? 'Los pacientes aparecerán cuando tengan una solicitud pendiente o aceptada con vos.'
                    : 'No encontramos profesionales con estos criterios. Podés cambiar la zona o quitar algún filtro.'}
                </p>
                {!nurse && (
                  <button className="button button-primary" onClick={() => clear()}>
                    Ver todos los profesionales
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              {showMap && (
                <div className="results-map" ref={mapRef}>
                  <Suspense fallback={<p role="status">Cargando mapa…</p>}>
                    <MapaEnfermeros
                      personas={personasMapa}
                      tipoPersona={nurse ? 'paciente' : 'enfermero'}
                      selectedId={selected}
                      onSelect={setSelected}
                      volverA={profileState.from}
                    />
                  </Suspense>
                  <p className="map-results-note">
                    {nurse
                      ? 'El mapa muestra el lugar de atención de tus turnos pendientes y aceptados. Lo ves solo mientras el turno sigue en curso.'
                      : 'El mapa muestra a todos los profesionales de esta búsqueda que informaron su zona. La ubicación es aproximada.'}
                  </p>
                </div>
              )}
              <div className={`professional-grid ${nurse ? 'patient-results-grid' : ''}`}>
                {data.enfermeros.map((person) => {
                  const id = person.usuario_id ?? person.id;
                  const rating = optionalNumber(
                    person.puntuacion ?? person.rating,
                  );
                  const distance = optionalNumber(
                    person.distancia_km ?? person.distancia,
                  );
                  const hasCoordinates =
                    person.latitud != null &&
                    person.longitud != null &&
                    person.latitud !== '' &&
                    person.longitud !== '';
                  return (
                    <article
                      className={`professional-card ${String(selected) === String(id) ? 'is-selected' : ''}`}
                      key={id}
                    >
                      {nurse ? (
                        <>
                          <div className="card-identity">
                            <Avatar person={person} />
                            <div>
                              <h3>{person.nombre} {person.apellido}</h3>
                              <p className="card-location">
                                <Icon name="briefcase" size={13} />
                                {person.solicitudes === 1
                                  ? '1 solicitud enviada'
                                  : `${person.solicitudes} solicitudes enviadas`}
                              </p>
                            </div>
                          </div>
                          <div className="card-bottom">
                            <Link className="button button-primary" to="/solicitudes-enfermero">
                              Revisar solicitudes
                              <Icon name="arrow" size={15} />
                            </Link>
                          </div>
                          {hasCoordinates && (
                            <button
                              className="text-link map-card-link"
                              onClick={() => {
                                setSelected(id);
                                update('vista', 'mapa');
                                requestAnimationFrame(() =>
                                  mapRef.current?.scrollIntoView({
                                    behavior: 'smooth',
                                    block: 'center',
                                  }),
                                );
                              }}
                            >
                              <Icon name="pin" size={14} />
                              Ver en el mapa
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                      <div className="card-identity">
                        <Avatar person={person} />
                        <div>
                          <h3>
                            <Link to={`/perfil/${id}`} state={profileState}>
                              {person.nombre} {person.apellido}
                            </Link>
                          </h3>
                          <p className="card-location">
                            <Icon name="pin" size={13} />
                            {person.ciudad || 'Zona sin informar'}
                          </p>
                        </div>
                      </div>
                      <div className="card-tags">
                        <span className="specialty-tag">
                          {person.especialidad || 'Especialidad sin informar'}
                        </span>
                        <span
                          className={`availability ${person.disponible ? '' : 'unavailable'}`}
                        >
                          <span className="status-dot" />
                          {person.disponible ? 'Disponible' : 'No disponible'}
                        </span>
                      </div>
                      {person.servicios?.length > 0 && (
                        <p className="card-services">
                          <strong>Ofrece:</strong>{' '}
                          {person.servicios.slice(0, 3).map((servicio) => servicio.tipoServicio).join(', ')}
                          {person.servicios.length > 3 && ` y ${person.servicios.length - 3} más`}
                        </p>
                      )}
                      <p className="card-description">
                        {person.descripcion ||
                          'Conocé sus datos y horarios de atención en el perfil.'}
                      </p>
                      <div className="card-meta">
                        {person.experiencia_anios > 0 && (
                          <span>
                            <Icon name="briefcase" size={14} />
                            {person.experiencia_anios} años de experiencia
                          </span>
                        )}
                        {rating !== null && (
                          <span>
                            <Icon name="star" size={14} />
                            {formatoPuntuacion(rating)}
                            {Number(person.cantidadResenas) > 0 &&
                              ` (${person.cantidadResenas} ${Number(person.cantidadResenas) === 1 ? 'reseña' : 'reseñas'})`}
                          </span>
                        )}
                        {distance !== null && (
                          <span>
                            <Icon name="pin" size={14} />
                            {/* El backend la manda en km enteros y aproximada, para no revelar el domicilio. */}
                            {distance < 1 ? 'A menos de 1 km' : `A unos ${Math.round(distance)} km`}
                          </span>
                        )}
                      </div>
                      <div className="card-bottom">
                        <div className="card-price">
                          {formatPrice(person.tarifa_hora)}
                          {Number(person.tarifa_hora) > 0 && (
                            <small> / hora</small>
                          )}
                        </div>
                        <Link
                          to={`/perfil/${id}`}
                          state={profileState}
                          className="button button-primary"
                        >
                          Ver perfil
                          <Icon name="arrow" size={15} />
                        </Link>
                      </div>
                      {hasCoordinates && (
                        <button
                          className="text-link map-card-link"
                          onClick={() => {
                            setSelected(id);
                            update('vista', 'mapa');
                            requestAnimationFrame(() =>
                              mapRef.current?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                              }),
                            );
                          }}
                        >
                          <Icon name="pin" size={14} />
                          Ver en el mapa
                        </button>
                      )}
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
              {data.total_paginas > 1 && (
                <nav className="pagination" aria-label="Paginación">
                  <button
                    className="button button-secondary"
                    disabled={page <= 1}
                    onClick={() => update('page', String(page - 1))}
                  >
                    <Icon name="back" size={15} />
                    Anterior
                  </button>
                  <span>
                    Página {page} de {data.total_paginas}
                  </span>
                  <button
                    className="button button-secondary"
                    disabled={page >= data.total_paginas}
                    onClick={() => update('page', String(page + 1))}
                  >
                    Siguiente
                    <Icon name="arrow" size={15} />
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
      {!nurse && <dialog
        ref={filterDialog}
        id="filtros-mobile"
        className="filter-dialog"
        aria-labelledby="filter-dialog-title"
        aria-describedby="filter-dialog-description"
        onCancel={(event) => {
          event.preventDefault();
          setFiltersOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              setFiltersOpen(false);
          }
        }}
      >
        <form onSubmit={applyFilters}>
          <div className="filter-dialog-heading">
            <div>
              <span className="eyebrow">A TU MEDIDA</span>
              <h2 id="filter-dialog-title">Filtrá tu búsqueda</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Cerrar filtros"
              onClick={() => setFiltersOpen(false)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="filter-dialog-body">
            <p id="filter-dialog-description">
              Elegí qué necesitás para encontrar tu profesional.
            </p>
            <DirectoryFilters
              values={draftFilters}
              specialties={specialties}
              zonas={zonas}
              servicios={servicios}
              onChange={(key, value) =>
                setDraftFilters((current) => ({ ...current, [key]: value }))
              }
              prefix="mobile"
            />
            {invalidDraftHours && (
              <p className="field-error" role="alert">
                {draftFilters.hora_desde === '' || draftFilters.hora_hasta === ''
                  ? 'Completá las horas desde y hasta.'
                  : 'La hora desde debe ser anterior a la hora hasta.'}
              </p>
            )}
          </div>
          <div className="filter-dialog-actions">
            <button
              type="button"
              className="text-link"
              onClick={() =>
                setDraftFilters(
                  Object.fromEntries(FILTERS.map((key) => [key, ''])),
                )
              }
            >
              Limpiar filtros
            </button>
            <button
              className="button button-primary"
              disabled={invalidDraft || invalidDraftHours}
            >
              Aplicar filtros
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </form>
      </dialog>}
    </div>
  );
}
