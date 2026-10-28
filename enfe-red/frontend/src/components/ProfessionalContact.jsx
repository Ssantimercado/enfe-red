import { enlaceWhatsapp, formatPrice, sesionActual } from '../api';
import Icon from './ui/Icon';

export default function ProfessionalContact({ profile }) {
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
              ? 'Cuando le pidas un turno vas a poder hablar con el profesional por el chat de Enfered. Si lo acepta, también por WhatsApp.'
              : 'Los pacientes hablan con el profesional por el chat de Enfered desde que piden un turno, y por WhatsApp cuando lo acepta.'}
          </p>
          {/* El turno se pide con el botón "Solicitar servicio" del encabezado del perfil: acá no se repite. */}
        </>
      )}
    </aside>
  );
}
