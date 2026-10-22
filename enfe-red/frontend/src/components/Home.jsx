import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Icon from './ui/Icon';
import AvisoMatricula from './AvisoMatricula';
import { estadoMatricula, pendientesDelPerfil } from './perfilPendiente';
import { requestApi as api, sesionActual } from '../api';

// Lo que le falta al perfil para pedir turnos (paciente) o aparecer en la cartilla (enfermero).
function CompletarPerfil({ rol }) {
  const [perfil, setPerfil] = useState(null);
  const [horarios, setHorarios] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      api(`/perfil/${rol}`, { signal }),
      rol === 'enfermero'
        ? api('/perfil/enfermero/horarios', { signal }).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([datos, lista]) => {
        if (controller.signal.aborted) return;
        setPerfil(datos);
        setHorarios(Array.isArray(lista) ? lista : null);
      })
      // Si no carga, el inicio se muestra igual, sin la lista.
      .catch(() => {});
    return () => controller.abort();
  }, [rol]);
  if (!perfil) return null;
  const pendientes = pendientesDelPerfil(rol, perfil, horarios);
  const sinVerificar = rol === 'enfermero' && estadoMatricula(perfil) !== 'verificada';
  if (!pendientes.length && !sinVerificar) return null;
  return (
    <section className="content-panel completar-perfil" aria-labelledby="completar-perfil-titulo">
      <h2 id="completar-perfil-titulo">Completá tu perfil</h2>
      {pendientes.length > 0 && (
        <>
          <p>
            {rol === 'enfermero'
              ? 'Te falta esto para que los pacientes puedan encontrarte y escribirte:'
              : 'Te falta esto para pedir un turno más rápido:'}
          </p>
          <ul>
            {pendientes.map(([clave, texto, destino]) => (
              <li key={clave}>
                <Link to={destino}>
                  <span>{texto}</span>
                  <Icon name="arrow" size={17} />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {sinVerificar && <AvisoMatricula perfil={perfil} />}
    </section>
  );
}

export default function Home() {
  const nurse = sesionActual()?.rol === 'enfermero';
  const location = useLocation();
  const recienRegistrado = location.state?.recienRegistrado;
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const steps = nurse
    ? [
        ['Recibí solicitudes', 'Los pacientes van a aparecer cuando pidan una atención.'],
        ['Revisá cada pedido', 'Consultá los datos y el servicio solicitado.'],
        ['Coordiná la atención', 'Aceptá las solicitudes que puedas atender.'],
      ]
    : [
        ['Encontrá tu profesional', 'Buscá por nombre, especialidad o zona.'],
        ['Conocé su experiencia', 'Revisá el perfil, los horarios y la tarifa.'],
        ['Pedí tu turno', 'Cuando el profesional acepta, coordinan por WhatsApp o por el chat.'],
      ];
  return (
    <div className="page-container home-page">
      <div className="welcome-row">
        <span className="eyebrow">BIENVENIDO A TU RED</span>
        <span className="subtle-label">
          <span className="status-dot" />
          {nurse ? 'Espacio profesional' : 'Espacio de cuidado'}
        </span>
      </div>
      {recienRegistrado && (
        <p className="notice notice-success" role="status">
          ¡Tu cuenta está lista! Ya iniciaste sesión en Enfered.
        </p>
      )}
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="hero-kicker">
            <Icon name="heart" size={16} />
            Personas que cuidan de personas
          </span>
          <h1>
            {nurse ? (
              <>
                Tu vocación merece
                <br /> <span>estar más cerca.</span>
              </>
            ) : (
              <>
                El cuidado que necesitás,
                <br /> <span>más cerca de vos.</span>
              </>
            )}
          </h1>
          <p>
            {nurse
              ? 'Mantené tu perfil y tus horarios al día para que más personas puedan encontrarte.'
              : 'Conectá con profesionales de enfermería para vos o tu familia. Encontrá atención a domicilio, a tu medida.'}
          </p>
          {nurse ? (
            <Link className="button button-primary" to="/perfil-enfermero">
              Gestionar mi perfil
              <Icon name="arrow" size={18} />
            </Link>
          ) : (
            <form
              className="hero-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(
                  `/cartilla${query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''}`,
                );
              }}
            >
              <Icon name="search" />
              <input
                aria-label="Buscar por nombre, especialidad o zona"
                placeholder="Nombre, especialidad o zona"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="button button-primary">
                Buscar
                <Icon name="arrow" size={17} />
              </button>
            </form>
          )}
        </div>
        <div className="hero-care-graphic" aria-hidden="true">
          <div className="hero-ring" />
          <div className="hero-ring inner" />
          <div className="hero-heart">
            <Icon name="heart" size={70} />
          </div>
          <div className="hero-callout callout-top">
            <span className="soft-icon">
              <Icon name="pin" />
            </span>
            <div>
              <strong>Cerca de tu hogar</strong>
              <span>Atención en tu zona</span>
            </div>
          </div>
          <div className="hero-callout callout-bottom">
            <span className="soft-icon mint">
              <Icon name="calendar" />
            </span>
            <div>
              <strong>A tu ritmo</strong>
              <span>Consultá la disponibilidad</span>
            </div>
          </div>
        </div>
      </section>
      <CompletarPerfil rol={nurse ? 'enfermero' : 'paciente'} />
      <section className="home-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">EMPEZÁ POR LO QUE NECESITÁS</span>
            <h2>
              {nurse ? 'Tu espacio, organizado.' : '¿Cómo podemos acompañarte?'}
            </h2>
          </div>
          {!nurse && (
            <Link className="text-link" to="/cartilla">
              Ver todos los profesionales
              <Icon name="arrow" size={17} />
            </Link>
          )}
        </div>
        <div className="quick-grid">
          {(nurse
            ? [
                [
                  'user',
                  'Mi perfil profesional',
                  'Compartí tu experiencia y especialidad.',
                  '/perfil-enfermero',
                ],
                [
                  'calendar',
                  'Mi disponibilidad',
                  'Organizá tus días y horarios de atención.',
                  '/perfil-enfermero#horarios',
                ],
                [
                  'search',
                  'Mis pacientes',
                  'Consultá a quienes te enviaron solicitudes.',
                  '/cartilla',
                ],
              ]
            : [
                [
                  'heart',
                  'Cuidado de adultos mayores',
                  'Acompañamiento y atención geriátrica.',
                  '/cartilla?especialidad=Geriatría',
                ],
                [
                  'user',
                  'Cuidado pediátrico',
                  'Atención para los más chicos de la familia.',
                  '/cartilla?especialidad=Pediatría',
                ],
                [
                  'briefcase',
                  'Enfermería general',
                  'Encontrá atención para el cuidado diario.',
                  '/cartilla?especialidad=General',
                ],
              ]
          ).map(([icon, title, text, to]) => (
            <Link className="quick-card" to={to} key={title}>
              <span className="soft-icon">
                <Icon name={icon} size={24} />
              </span>
              <h3>{title}</h3>
              <p>{text}</p>
              <Icon name="arrow" size={20} />
            </Link>
          ))}
        </div>
      </section>
      <section className="how-section">
        <div>
          <span className="eyebrow">SIMPLE, DE PRINCIPIO A FIN</span>
          <h2>
            Tu próximo cuidado,
            <br />
            en tres pasos.
          </h2>
        </div>
        <ol className="steps-list">
          {steps.map(([title, text], i) => (
            <li key={title}>
              <span className="step-number">0{i + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {!nurse && (
        <Link className="profile-reminder" to="/perfil-paciente">
          <span className="soft-icon mint">
            <Icon name="user" />
          </span>
          <div>
            <h3>Tu perfil también es parte del cuidado.</h3>
            <p>Mantené tus datos de contacto actualizados.</p>
          </div>
          <span className="text-link">
            Ir a mi perfil
            <Icon name="arrow" size={17} />
          </span>
        </Link>
      )}
    </div>
  );
}
