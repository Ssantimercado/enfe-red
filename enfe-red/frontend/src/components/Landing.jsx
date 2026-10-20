import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sesionActual } from '../api';
import Brand from './ui/Brand';
import Icon from './ui/Icon';
import careImage from '../assets/landing/home-care.webp';
import careImageSmall from '../assets/landing/home-care-640.webp';
import professionalImage from '../assets/landing/nursing-professional.webp';
import professionalImageSmall from '../assets/landing/nursing-professional-640.webp';
import './Landing.css';

const navigation = [
  ['#como-funciona', 'Cómo funciona'],
  ['#que-ofrecemos', 'Qué ofrecemos'],
  ['#profesionales', 'Profesionales'],
  ['#resenas', 'Reseñas'],
];

const steps = [
  [
    'user',
    'Creá tu cuenta',
    'Registrate como paciente para buscar atención para vos o para alguien de tu familia.',
  ],
  [
    'search',
    'Encontrá a tu profesional',
    'Filtrá por especialidad, zona, precio y disponibilidad. Conocé los perfiles antes de elegir.',
  ],
  [
    'phone',
    'Conectá y coordiná',
    'Contactá al profesional por teléfono o correo y acordá los detalles de la atención.',
  ],
];

const benefits = [
  [
    'sliders',
    'Una búsqueda que se adapta a vos',
    'Elegí la especialidad, el rango de precios y los días de atención que necesitás.',
  ],
  [
    'map',
    'El cuidado, más cerca',
    'Explorá profesionales por zona y encontrá sus ubicaciones informadas en el mapa.',
  ],
  [
    'user',
    'Información para decidir',
    'Consultá la presentación, experiencia, matrícula informada, tarifa y horarios de cada profesional.',
  ],
];

// Fictional testimonials for the academic presentation. Keep the visible demo labels.
const testimonials = [
  {
    name: 'Mariana G.',
    initials: 'MG',
    role: 'Familiar de paciente',
    color: 'mint',
    quote:
      'Necesitaba encontrar atención para mi mamá. Poder ver la especialidad y los horarios en un mismo lugar me ayudó a organizarme y contactar a una profesional de mi zona.',
  },
  {
    name: 'Jorge R.',
    initials: 'JR',
    role: 'Paciente',
    color: 'blue',
    quote:
      'Me resultó sencillo comparar las opciones y consultar antes de decidir. Me gustó poder hablar directamente con el profesional y explicarle qué necesitaba.',
  },
  {
    name: 'Lucía M.',
    initials: 'LM',
    role: 'Profesional de enfermería',
    color: 'sand',
    quote:
      'Tener mi perfil, mi experiencia y mis horarios publicados me ayuda a presentar mejor mi trabajo. Las personas pueden conocer cómo las puedo acompañar antes de contactarme.',
  },
];

const questions = [
  [
    '¿Qué es Enfe-red?',
    'Es una plataforma que conecta a personas que necesitan cuidados de enfermería a domicilio con profesionales que ofrecen sus servicios. Te ayuda a buscar, conocer perfiles y establecer contacto para coordinar la atención.',
  ],
  [
    '¿Puedo buscar atención para un familiar?',
    'Sí. Podés crear una cuenta como paciente y buscar profesionales para vos o para un familiar. Al contactar, explicá qué cuidados necesitás y en qué zona se realizaría la atención.',
  ],
  [
    '¿Cómo encuentro a alguien que se adapte a lo que necesito?',
    'Buscá por nombre, zona o especialidad y combiná filtros de precio, disponibilidad y día de atención. En cada perfil podés revisar la experiencia, los horarios y los datos de contacto publicados.',
  ],
  [
    '¿La atención se reserva y se paga desde Enfe-red?',
    'Por ahora, el servicio, el horario y la forma de pago se acuerdan directamente con el profesional. Enfe-red te permite encontrarlo y acceder a sus datos de contacto.',
  ],
  [
    '¿Tengo que compartir mi ubicación?',
    'No es obligatorio. Podés buscar escribiendo una zona. Si elegís usar tu ubicación en el mapa, el navegador te pedirá permiso.',
  ],
  [
    'Soy enfermero/a, ¿cómo me sumo?',
    'Creá una cuenta eligiendo “Soy enfermero/a”. Después completá tu perfil con tu especialidad, matrícula, experiencia, zona y tarifa, y cargá tus horarios de atención.',
  ],
];

function SearchPreview() {
  return (
    <div
      className="lp-search-preview"
      role="img"
      aria-label="Vista ilustrativa del buscador: especialidades, ubicación en el mapa y horarios de atención"
    >
      <div aria-hidden="true">
        <div className="lp-preview-top">
          <span className="lp-preview-dot" />
          <span>Tu próxima atención</span>
          <span>Vista ilustrativa</span>
        </div>
        <div className="lp-preview-search">
          <Icon name="search" size={19} />
          Enfermería cerca de vos
          <Icon name="sliders" size={18} />
        </div>
        <div className="lp-preview-filters">
          <span>
            Especialidad
            <Icon name="chevron" size={12} />
          </span>
          <span>
            Disponibilidad
            <Icon name="chevron" size={12} />
          </span>
          <span>
            Precio
            <Icon name="chevron" size={12} />
          </span>
        </div>
        <div className="lp-preview-map">
          <svg
            viewBox="0 0 500 230"
            preserveAspectRatio="none"
            className="lp-map-streets"
          >
            <rect width="500" height="230" fill="#edf2ed" />
            <path
              d="M0 75H500M0 165H500M100 0V230M220 0V230M345 0V230M455 0V230"
              stroke="#fff"
              strokeWidth="14"
            />
            <path d="M-20 235 520 -10" stroke="#d7e8e8" strokeWidth="35" />
            <path d="M-20 235 520 -10" stroke="#f9fcfb" strokeWidth="20" />
            <rect
              x="120"
              y="92"
              width="76"
              height="51"
              rx="10"
              fill="#cbded0"
            />
            <rect
              x="365"
              y="15"
              width="66"
              height="42"
              rx="10"
              fill="#d1e3d4"
            />
            <rect x="22" y="182" width="57" height="36" rx="9" fill="#d1e3d4" />
          </svg>
          <span className="lp-map-pin pin-one">
            <Icon name="heart" size={19} />
          </span>
          <span className="lp-map-pin pin-two">
            <Icon name="heart" size={19} />
          </span>
          <span className="lp-map-pin pin-three">
            <Icon name="heart" size={19} />
          </span>
          <span className="lp-map-caption">
            <Icon name="pin" size={14} />
            Explorá tu zona
          </span>
        </div>
        <div className="lp-preview-profile">
          <span className="soft-icon mint">
            <Icon name="user" size={24} />
          </span>
          <div>
            <strong>Profesionales de enfermería</strong>
            <span>Conocé su experiencia y especialidad</span>
          </div>
          <Icon name="arrow" size={19} />
        </div>
        <div className="lp-preview-bottom">
          <span>
            <Icon name="calendar" size={15} />
            Horarios publicados
          </span>
          <span>
            <Icon name="phone" size={15} />
            Contacto directo
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const session = sesionActual();
  const patientLink = session ? '/cartilla' : '/registro?rol=paciente';
  const professionalLink =
    session?.rol === 'enfermero'
      ? '/perfil-enfermero'
      : '/registro?rol=enfermero';

  return (
    <div className="landing-page">
      <a className="skip-link" href="#landing-contenido">
        Ir al contenido
      </a>
      <header
        className="lp-header"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuOpen) {
            setMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className="lp-container lp-header-inner">
          <Brand to="/" />
          <nav
            className={`lp-nav ${menuOpen ? 'is-open' : ''}`}
            id="landing-menu"
            aria-label="Navegación de Enfe-red"
          >
            {navigation.map(([href, label]) => (
              <a href={href} key={href} onClick={() => setMenuOpen(false)}>
                {label}
              </a>
            ))}
            <Link
              className="lp-menu-register"
              to={session ? '/home' : '/registro'}
            >
              {session ? 'Ir a mi espacio' : 'Crear cuenta'}
            </Link>
          </nav>
          <div className="lp-header-actions">
            {session ? (
              <Link className="button button-primary" to="/home">
                Mi espacio
                <Icon name="arrow" size={16} />
              </Link>
            ) : (
              <>
                <Link className="lp-login" to="/login">
                  Iniciar sesión
                </Link>
                <Link
                  className="button button-primary lp-header-register"
                  to="/registro"
                >
                  Crear cuenta
                  <Icon name="arrow" size={16} />
                </Link>
              </>
            )}
            <button
              ref={menuButton}
              type="button"
              className="icon-button lp-menu-button"
              aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={menuOpen}
              aria-controls="landing-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} size={23} />
            </button>
          </div>
        </div>
      </header>

      <main id="landing-contenido">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <span className="lp-kicker">
                <Icon name="heart" size={17} />
                Personas que cuidan de personas
              </span>
              <h1>
                El cuidado que necesitás, <span>cerca de vos.</span>
              </h1>
              <p>
                Conectamos a pacientes y familias con profesionales de
                enfermería a domicilio. Encontrá a quien pueda acompañarte, en
                tu zona y a tu ritmo.
              </p>
              <div className="lp-hero-actions">
                <Link className="button button-primary" to={patientLink}>
                  Encontrar cuidados
                  <Icon name="arrow" size={19} />
                </Link>
                <a className="button lp-button-plain" href="#como-funciona">
                  Cómo funciona
                  <Icon name="chevron" size={17} />
                </a>
              </div>
              <div className="lp-hero-note">
                <span className="lp-note-icon">
                  <Icon name="briefcase" size={19} />
                </span>
                <p>
                  ¿Sos profesional de enfermería?
                  <br />
                  <a href="#profesionales">
                    También hay un lugar para vos.
                    <Icon name="arrow" size={14} />
                  </a>
                </p>
              </div>
            </div>
            <div className="lp-hero-visual">
              <div className="lp-hero-photo">
                <img
                  src={careImage}
                  srcSet={`${careImageSmall} 640w, ${careImage} 1120w`}
                  sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1000px) 44vw, 540px"
                  alt="Imagen ilustrativa de una enfermera conversando con una mujer mayor en su hogar"
                  width="1122"
                  height="1402"
                  fetchPriority="high"
                />
              </div>
              <div className="lp-photo-tag">
                <span className="soft-icon mint">
                  <Icon name="pin" size={22} />
                </span>
                <div>
                  <strong>El cuidado empieza cerca.</strong>
                  <span>En tu zona. En tu hogar.</span>
                </div>
              </div>
              <span className="lp-photo-decoration" aria-hidden="true">
                <Icon name="heart" size={30} />
              </span>
              <div className="lp-photo-caption">
                <Icon name="home" size={16} />
                <span>Más conexión. Más acompañamiento.</span>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-values-strip">
          <div className="lp-container lp-values-grid">
            {[
              ['search', 'Búsqueda a tu medida'],
              ['pin', 'Profesionales por zona'],
              ['calendar', 'Horarios a la vista'],
              ['phone', 'Contacto directo'],
            ].map(([icon, text]) => (
              <div key={text}>
                <Icon name={icon} size={22} />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <section id="como-funciona" className="lp-section lp-container">
          <div className="lp-section-heading lp-centered">
            <span className="eyebrow">ASÍ DE SIMPLE</span>
            <h2>
              Del primer paso
              <br />
              al próximo cuidado.
            </h2>
            <p>
              Menos vueltas para encontrar atención.
              <br className="lp-desktop-break" /> Más información para elegir
              con tranquilidad.
            </p>
          </div>
          <ol className="lp-steps">
            {steps.map(([icon, title, copy], index) => (
              <li key={title}>
                <div className="lp-step-heading">
                  <span className="lp-step-number">0{index + 1}</span>
                  <Icon name={icon} size={24} />
                </div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="que-ofrecemos" className="lp-benefits-section">
          <div className="lp-container lp-benefits-grid">
            <div>
              <div className="lp-section-heading">
                <span className="eyebrow">TODO EMPIEZA POR ELEGIR BIEN</span>
                <h2>
                  Tu búsqueda.
                  <br />
                  Tus tiempos.
                  <br />
                  <span>Tu forma de cuidar.</span>
                </h2>
                <p>
                  Reunimos lo que necesitás saber para encontrar un profesional
                  que se adapte a vos.
                </p>
              </div>
              <div className="lp-benefit-list">
                {benefits.map(([icon, title, copy]) => (
                  <div key={title}>
                    <span className="soft-icon">
                      <Icon name={icon} size={22} />
                    </span>
                    <div>
                      <h3>{title}</h3>
                      <p>{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Link className="text-link lp-inline-cta" to={patientLink}>
                Empezar mi búsqueda
                <Icon name="arrow" size={18} />
              </Link>
            </div>
            <SearchPreview />
          </div>
        </section>

        <section
          className="lp-section lp-container lp-specialties"
          aria-labelledby="specialties-title"
        >
          <div className="lp-section-heading lp-heading-row">
            <div>
              <span className="eyebrow">
                DIFERENTES NECESIDADES, UNA MISMA RED
              </span>
              <h2 id="specialties-title">Acompañamos cada etapa.</h2>
            </div>
            <p>
              Explorá especialidades y consultá qué servicios ofrece cada
              profesional.
            </p>
          </div>
          <div className="lp-specialty-grid">
            {[
              [
                'heart',
                'Adultos mayores',
                'Encontrá profesionales de geriatría para acompañar el cuidado de quienes más querés.',
                'Geriatría',
              ],
              [
                'user',
                'Cuidado pediátrico',
                'Conectá con profesionales de enfermería pediátrica para los más chicos de la familia.',
                'Pediatría',
              ],
              [
                'briefcase',
                'Enfermería general',
                'Buscá atención de enfermería para tus necesidades de cuidado cotidiano en el hogar.',
                'General',
              ],
            ].map(([icon, title, copy, specialty]) => (
              <article key={title} className="lp-specialty-card">
                <span className="soft-icon">
                  <Icon name={icon} size={26} />
                </span>
                <span className="lp-specialty-label">{specialty}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="profesionales" className="lp-professional-section">
          <div className="lp-container lp-professional-grid">
            <div className="lp-professional-photo">
              <img
                src={professionalImage}
                srcSet={`${professionalImageSmall} 640w, ${professionalImage} 1120w`}
                sizes="(max-width: 700px) calc(100vw - 40px), (max-width: 1000px) 44vw, 540px"
                width="1448"
                height="1086"
                loading="lazy"
                decoding="async"
                alt="Imagen ilustrativa de un profesional de enfermería organizando su trabajo en una computadora"
              />
              <div>
                <Icon name="briefcase" size={20} />
                <span>Tu experiencia merece ser encontrada.</span>
              </div>
            </div>
            <div className="lp-professional-copy">
              <span className="eyebrow">PARA PROFESIONALES DE ENFERMERÍA</span>
              <h2>
                Vos cuidás.
                <br />
                Nosotros te ayudamos
                <br />a conectar.
              </h2>
              <p>
                Sumate a una red donde las personas pueden conocer tu trabajo y
                contactarte por los cuidados que ofrecés.
              </p>
              <ul>
                {[
                  'Compartí tu especialidad, experiencia y presentación.',
                  'Publicá tu zona de atención y tu tarifa por hora.',
                  'Mantené tus días y horarios de atención actualizados.',
                ].map((item) => (
                  <li key={item}>
                    <Icon name="check" size={18} />
                    {item}
                  </li>
                ))}
              </ul>
              <Link className="button lp-button-white" to={professionalLink}>
                {session?.rol === 'enfermero'
                  ? 'Gestionar mi perfil'
                  : 'Crear perfil profesional'}
                <Icon name="arrow" size={18} />
              </Link>
            </div>
          </div>
        </section>

        <section id="resenas" className="lp-section lp-container">
          <div className="lp-section-heading lp-centered">
            <span className="eyebrow">EXPERIENCIAS EN LA RED</span>
            <h2>
              El cuidado se siente.
              <br />Y se comparte.
            </h2>
            <p>
              Pacientes, familias y profesionales: cada encuentro tiene una
              historia.
            </p>
            <span className="lp-demo-label">
              Reseñas ficticias · Demo académica
            </span>
          </div>
          <div className="lp-review-grid">
            {testimonials.map((review) => (
              <figure className="lp-review" key={review.name}>
                <div
                  className="lp-stars"
                  aria-label="5 de 5 estrellas, valoración de ejemplo"
                >
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Icon name="star" size={17} key={star} />
                  ))}
                </div>
                <blockquote>“{review.quote}”</blockquote>
                <figcaption>
                  <span className={`lp-review-avatar ${review.color}`}>
                    {review.initials}
                  </span>
                  <div>
                    <strong>{review.name}</strong>
                    <span>{review.role}</span>
                  </div>
                  <span className="lp-review-example">Ejemplo</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section id="preguntas" className="lp-faq-section">
          <div className="lp-container lp-faq-grid">
            <div className="lp-section-heading">
              <span className="eyebrow">ANTES DE EMPEZAR</span>
              <h2>
                Es simple.
                <br />Y te lo contamos.
              </h2>
              <p>
                Resolvemos algunas dudas para que puedas dar el primer paso.
              </p>
              <span className="lp-faq-symbol" aria-hidden="true">
                ?
              </span>
            </div>
            <div className="lp-questions">
              {questions.map(([question, answer]) => (
                <details key={question}>
                  <summary>
                    {question}
                    <Icon name="plus" size={20} />
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="lp-final-section">
          <div className="lp-container">
            <div className="lp-final-cta">
              <span className="lp-final-icon">
                <Icon name="heart" size={30} />
              </span>
              <span className="eyebrow">ESTAMOS PARA CONECTARTE</span>
              <h2>
                El próximo cuidado empieza
                <br /> con un encuentro.
              </h2>
              <p>
                Busques atención o quieras ofrecerla, tu lugar está en Enfe-red.
              </p>
              <div className="lp-final-actions">
                <Link
                  className="button lp-button-white"
                  to={session ? '/home' : '/registro'}
                >
                  {session ? 'Ir a mi espacio' : 'Crear mi cuenta'}
                  <Icon name="arrow" size={18} />
                </Link>
                <Link
                  className="button lp-button-outline"
                  to={session ? '/cartilla' : '/login'}
                >
                  {session ? 'Buscar profesionales' : 'Ya tengo una cuenta'}
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-main">
            <div>
              <Brand to="/" />
              <p>
                Una red de personas
                <br /> para cuidar de personas.
              </p>
            </div>
            <nav aria-label="Conocé Enfe-red">
              <strong>Conocé Enfe-red</strong>
              <a href="#como-funciona">Cómo funciona</a>
              <a href="#que-ofrecemos">Qué ofrecemos</a>
              <a href="#profesionales">Para profesionales</a>
            </nav>
            <nav aria-label="Empezá a conectar">
              <strong>Empezá a conectar</strong>
              <Link to="/registro">Crear cuenta</Link>
              <Link to="/login">Iniciar sesión</Link>
              <a href="#preguntas">Preguntas frecuentes</a>
            </nav>
          </div>
          <div className="lp-footer-bottom">
            <span>© {new Date().getFullYear()} Enfe-red.</span>
            <span>Enfermería a domicilio, cerca de vos.</span>
            <Link to="/terminos">Términos y condiciones</Link>
            <Link to="/privacidad">Política de privacidad</Link>
            <a href="#landing-contenido">
              Volver arriba
              <Icon name="arrow" size={14} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
