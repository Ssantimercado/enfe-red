import { Link } from 'react-router-dom';
import { enlaceWhatsapp, formatPrice, sesionActual } from '../api';
import Icon from './ui/Icon';

export default function ProfessionalContact({ profile, idUsuario }) {
  // El teléfono solo llega cuando el profesional ya aceptó una solicitud de este paciente.
  const whatsapp = profile.contacto_habilitado ? enlaceWhatsapp(profile.telefono) : null;
  const paciente = sesionActual()?.rol === 'paciente';
  return (
    <aside
      className="content-panel contact-panel"
      aria-labelledby="contact-title"
    >
      <span className="eyebrow">CONTACTO</span>
      <h2 id="contact-title">Coordiná tu atención</h2>
      <div className="contact-price">
        <span>Tarifa informada</span>
        <div className="card-price">
          {formatPrice(profile.tarifa_hora)}
          {Number(profile.tarifa_hora) > 0 && <small> / hora</small>}
        </div>
      </div>
      {!profile.disponible && (
        <p className="contact-availability">
          Actualmente figura como no disponible. Podés consultar por próximas
          fechas.
        </p>
      )}
      {whatsapp ? (
        <>
          <p>
            El profesional aceptó tu solicitud. Escribile para coordinar los
            detalles de la atención.
          </p>
          <div className="contact-actions">
            <a
              className="button button-primary button-full"
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="chat" size={18} />
              Escribir por WhatsApp
            </a>
          </div>
        </>
      ) : (
        <>
          <p className="notice notice-info">
            {paciente
              ? 'Cuando el profesional acepte tu solicitud vas a poder escribirle por WhatsApp.'
              : 'Los pacientes pueden escribirle por WhatsApp cuando el profesional acepta su solicitud.'}
          </p>
          {paciente && profile.rol === 'enfermero' && idUsuario != null && (
            <div className="contact-actions">
              <Link
                className="button button-primary button-full"
                to={`/perfil/${idUsuario}/solicitar`}
              >
                <Icon name="calendar" size={18} />
                Pedir un turno
              </Link>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
