import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import Brand from './ui/Brand';
import Icon from './ui/Icon';
import './Legal.css';

// Versión y fecha deben coincidir con VERSION_TERMINOS en backend/schema_legal.py.
// Sigue en 1.0: todavía no hay un paso para que las cuentas existentes vuelvan a aceptar
// una versión nueva, así que subirla solo cambiaría lo que se guarda en los registros nuevos.
export const VERSION_TERMINOS = '1.0';
const ACTUALIZACION = '22 de octubre de 2026';
// Correo de soporte para ejercer los derechos de la Ley 25.326 (definir en frontend/.env).
const SOPORTE = import.meta.env?.VITE_SOPORTE_EMAIL;

function Contacto() {
  return SOPORTE ? (
    <a href={`mailto:${SOPORTE}`}>{SOPORTE}</a>
  ) : (
    'el correo de soporte de Enfered'
  );
}

function PaginaLegal({ titulo, intro, children }) {
  useEffect(() => {
    const anterior = document.title;
    document.title = `${titulo} · Enfered`;
    return () => { document.title = anterior; };
  }, [titulo]);
  return (
    <div className="legal-page">
      <header className="legal-header">
        <div className="legal-container legal-header-inner">
          <Brand to="/" />
          <Link className="text-link" to="/">
            <Icon name="arrow" size={15} className="legal-back-icon" />
            Volver al inicio
          </Link>
        </div>
      </header>
      <main className="legal-container legal-main" id="contenido">
        <span className="eyebrow">INFORMACIÓN LEGAL</span>
        <h1>{titulo}</h1>
        <p className="legal-meta">Versión {VERSION_TERMINOS} · Última actualización: {ACTUALIZACION}</p>
        <p className="legal-intro">{intro}</p>
        {children}
        <nav className="legal-related" aria-label="Documentos legales">
          <Link to="/terminos">Términos y condiciones</Link>
          <Link to="/privacidad">Política de privacidad</Link>
        </nav>
      </main>
    </div>
  );
}

export function Terminos() {
  return (
    <PaginaLegal
      titulo="Términos y condiciones"
      intro="Estos términos regulan el uso de Enfered. Al crear una cuenta declarás que los leíste y que los aceptás."
    >
      <section>
        <h2>1. Qué es Enfered</h2>
        <p>
          Enfered es una plataforma que conecta a pacientes y familias con profesionales de enfermería
          independientes para la atención a domicilio. Enfered actúa como intermediaria: no presta
          servicios de salud, no emplea a los profesionales y no reemplaza la indicación de un médico.
        </p>
        <p className="legal-destacado">
          Enfered no es un servicio de emergencias. Ante una urgencia, llamá al 107 o al servicio de
          emergencias de tu localidad.
        </p>
      </section>
      <section>
        <h2>2. Cuentas de usuario</h2>
        <ul>
          <li>Para usar la plataforma necesitás ser mayor de 18 años o actuar con la autorización de tu representante legal.</li>
          <li>Los datos que cargues tienen que ser verdaderos y estar actualizados.</li>
          <li>Tu contraseña es personal. Avisanos si creés que alguien accedió a tu cuenta.</li>
          <li>Podés usar la cuenta como paciente o como profesional, según el rol que elijas al registrarte.</li>
        </ul>
      </section>
      <section>
        <h2>3. Profesionales de enfermería</h2>
        <ul>
          <li>Los profesionales declaran contar con matrícula habilitante vigente y cargan su número en el perfil.</li>
          <li>Enfered revisa la matrícula antes de mostrar al profesional en la cartilla. Mientras está pendiente, el perfil no aparece en las búsquedas ni recibe solicitudes.</li>
          <li>Cada profesional es responsable de la atención que brinda, de cumplir las normas de su ejercicio y de contar con la cobertura de responsabilidad profesional que corresponda.</li>
          <li>La información de horarios, tarifas y especialidad la carga y actualiza el propio profesional.</li>
        </ul>
      </section>
      <section>
        <h2>4. Solicitudes, mensajes y precios</h2>
        <ul>
          <li>Una solicitud queda confirmada cuando el profesional la acepta. Hasta ese momento el paciente puede cancelarla.</li>
          <li>El chat de cada solicitud es solo para coordinar la atención. No compartas información que no sea necesaria.</li>
          <li>Los precios que muestra la plataforma son estimados de referencia. El valor final lo acuerdan el paciente y el profesional, y el pago se realiza fuera de Enfered.</li>
        </ul>
      </section>
      <section>
        <h2>5. Reseñas</h2>
        <p>
          El paciente puede calificar al profesional una vez finalizada la atención. Las reseñas tienen
          que basarse en una experiencia real y no pueden incluir insultos, datos personales de terceros
          ni información de salud. Enfered puede ocultar las que no cumplan estas reglas.
        </p>
      </section>
      <section>
        <h2>6. Suspensión de cuentas</h2>
        <p>
          Podemos suspender una cuenta si se usan datos falsos, si se usa la plataforma para fines
          distintos a los previstos o si se incumplen estos términos. Una cuenta suspendida no puede
          iniciar sesión. Si creés que se trata de un error, escribinos a <Contacto />.
        </p>
      </section>
      <section>
        <h2>7. Responsabilidad</h2>
        <p>
          Enfered pone los medios razonables para que la plataforma funcione correctamente y para
          verificar a los profesionales, pero no garantiza el resultado de la atención ni responde por
          los acuerdos entre pacientes y profesionales.
        </p>
      </section>
      <section>
        <h2>8. Cambios y ley aplicable</h2>
        <p>
          Si modificamos estos términos te lo vamos a avisar y, cuando corresponda, te vamos a pedir que
          los aceptes de nuevo. Se rigen por las leyes de la República Argentina.
        </p>
      </section>
    </PaginaLegal>
  );
}

export function Privacidad() {
  return (
    <PaginaLegal
      titulo="Política de privacidad"
      intro="En esta política te contamos qué datos tratamos, para qué y qué derechos tenés, de acuerdo con la Ley 25.326 de Protección de los Datos Personales."
    >
      <section>
        <h2>1. Qué datos tratamos</h2>
        <ul>
          <li><strong>Datos de cuenta:</strong> nombre, apellido, correo electrónico y contraseña (guardada cifrada).</li>
          <li><strong>Datos de contacto y ubicación:</strong> teléfono, dirección y, si la compartís, la ubicación aproximada de tu domicilio.</li>
          <li><strong>Lugar de atención de cada turno (pacientes):</strong> el punto que marcás en el mapa al pedir un turno. Lo ve solo el profesional elegido, mientras el turno está pendiente o aceptado (y hasta dos horas después de que termina), para saber cómo llegar; cuando el turno se cierra se borra.</li>
          <li><strong>Datos de salud (pacientes):</strong> la información de salud que decidas cargar en tu perfil. Son datos sensibles según el artículo 2 de la ley y se guardan cifrados.</li>
          <li><strong>Datos profesionales (enfermeros):</strong> matrícula, especialidad, experiencia, tarifa y horarios.</li>
          <li><strong>Actividad en la plataforma:</strong> solicitudes, mensajes, calificaciones y notificaciones.</li>
        </ul>
      </section>
      <section>
        <h2>2. Para qué los usamos</h2>
        <ul>
          <li>Crear y administrar tu cuenta.</li>
          <li>Mostrar a los profesionales verificados en la cartilla y en el mapa.</li>
          <li>Gestionar las solicitudes de atención, el chat y los avisos entre paciente y profesional.</li>
          <li>Enviarte correos de aviso: cuando llega, se acepta o se cancela un turno, sobre la revisión de la matrícula y el código para recuperar la contraseña. Estos correos solo dicen el día y la hora del turno, sin datos de salud.</li>
          <li>Ayudarte a buscar con la búsqueda asistida (ver el punto 5).</li>
          <li>Verificar matrículas y mantener la seguridad de la plataforma.</li>
        </ul>
        <p>No vendemos tus datos ni los usamos con fines publicitarios.</p>
      </section>
      <section>
        <h2>3. Consentimiento</h2>
        <p>
          Al crear la cuenta prestás tu consentimiento libre, expreso e informado para el tratamiento de
          tus datos con estas finalidades, incluidos los datos de salud que cargues (artículos 5 y 7 de la
          ley). Guardamos la versión de esta política que aceptaste y la fecha. Cargar información de
          salud es optativo.
        </p>
      </section>
      <section>
        <h2>4. Quién puede verlos</h2>
        <ul>
          <li>Tu información de salud solo la ves vos.</li>
          <li>Cuando enviás una solicitud, el profesional elegido ve tu nombre, tu teléfono, el servicio, la fecha y la dirección de atención.</li>
          <li>El perfil profesional de los enfermeros (nombre, especialidad, zona, tarifa y horarios) es visible en la plataforma. En el mapa se muestra una ubicación aproximada, nunca la dirección.</li>
          <li>El teléfono y el correo del profesional no se publican: se comparten con el paciente solo cuando el profesional acepta su solicitud, para que puedan coordinar por WhatsApp.</li>
          <li>El personal de administración accede solo a lo necesario para verificar matrículas y gestionar cuentas.</li>
        </ul>
      </section>
      <section>
        <h2>5. Búsqueda asistida y proveedores externos</h2>
        <p>
          La búsqueda asistida (“Contanos qué necesitás”) usa Google Gemini, un servicio de Google que
          actúa como encargado del tratamiento: solo procesa el texto para convertirlo en filtros de la
          cartilla. Antes de enviarlo borramos los datos que te identifican, como correos, teléfonos,
          números de documento y calles con número. Enfered no guarda ese texto. Si no querés usarla, podés
          buscar con los filtros de la cartilla.
        </p>
        <p>
          Para enviar los correos de aviso usamos un servicio de correo electrónico, que recibe tu
          dirección de correo y el texto del aviso.
        </p>
      </section>
      <section>
        <h2>6. Cookies y almacenamiento en tu navegador</h2>
        <p>
          Enfered no usa cookies publicitarias ni de seguimiento. Guardamos en el almacenamiento local de
          tu navegador solo lo necesario para que funcione: la sesión iniciada y tus preferencias, como
          haber leído este aviso. Se borra al cerrar sesión o al limpiar los datos del navegador.
        </p>
        <p>
          El mapa usa servicios de terceros (OpenStreetMap y el cálculo de rutas) que reciben la ubicación
          que se muestra en pantalla para dibujarlo. Si el profesional abre el lugar de atención en Google Maps,
          ese punto también se envía a Google. Para ubicar en el mapa la dirección que escribís (o escribir la de tu
          ubicación actual), el servidor de Enfered la consulta en el buscador de direcciones de OpenStreetMap
          (Nominatim), sin tu nombre ni otros datos.
        </p>
      </section>
      <section>
        <h2>7. Seguridad y conservación</h2>
        <p>
          Aplicamos medidas técnicas para proteger tus datos: contraseñas cifradas, información de salud
          guardada cifrada, acceso con sesión, permisos por rol y control de quién puede ver cada
          solicitud. Conservamos los datos mientras tengas la cuenta y el tiempo que exija la ley.
        </p>
      </section>
      <section>
        <h2>8. Tus derechos</h2>
        <p>
          Desde tu perfil, en “Mi cuenta”, podés descargar todos tus datos en un archivo y eliminar tu
          cuenta. Al eliminarla borramos tus datos personales y cancelamos tus turnos pendientes; los
          mensajes y reseñas que escribiste quedan sin tu nombre para no borrar el historial de la otra
          persona. También podés corregir la mayoría de tus datos desde tu perfil, o pedir acceder,
          rectificar, actualizar o suprimir tus datos escribiendo a <Contacto />.
        </p>
        <p className="legal-leyenda">
          El titular de los datos personales tiene la facultad de ejercer el derecho de acceso a los
          mismos en forma gratuita a intervalos no inferiores a seis meses, salvo que se acredite un
          interés legítimo al efecto conforme lo establecido en el artículo 14, inciso 3 de la Ley
          Nº 25.326.
        </p>
        <p className="legal-leyenda">
          La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley
          Nº 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes
          resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de
          protección de datos personales.
        </p>
      </section>
    </PaginaLegal>
  );
}
