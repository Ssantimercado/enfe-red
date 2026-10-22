import { enlaceWhatsapp, formatPrice } from '../api';
import Icon from './ui/Icon';

export default function ProfessionalContact({ profile }) {
  const whatsapp = enlaceWhatsapp(profile.telefono);
  return (
    <aside
      className="content-panel contact-panel"
      aria-labelledby="contact-title"
    >
      <span className="eyebrow">CONTACTO DIRECTO</span>
      <h2 id="contact-title">Coordiná tu atención</h2>
      <div className="contact-price">
        <span>Tarifa informada</span>
        <div className="card-price">
          {formatPrice(profile.tarifa_hora)}
          {Number(profile.tarifa_hora) > 0 && <small> / hora</small>}
        </div>
      </div>
      <p>
        Consultá por el servicio, los horarios y el precio final con el
        profesional.
      </p>
      {!profile.disponible && (
        <p className="contact-availability">
          Actualmente figura como no disponible. Podés consultar por próximas
          fechas.
        </p>
      )}
      <div className="contact-actions">
        {whatsapp && (
          <a
            className="button button-primary button-full"
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="chat" size={18} />
            Escribir por WhatsApp
          </a>
        )}
        {profile.email && (
          <a
            className={`button ${whatsapp ? 'button-secondary' : 'button-primary'} button-full`}
            href={`mailto:${profile.email}`}
          >
            <Icon name="mail" size={18} />
            Enviar un correo
          </a>
        )}
      </div>
      {!profile.telefono && !profile.email ? (
        <p className="notice notice-info">
          Todavía no hay datos de contacto publicados.
        </p>
      ) : (
        <dl className="contact-details">
          {profile.telefono && (
            <div>
              <dt>Teléfono</dt>
              <dd>{profile.telefono}</dd>
            </div>
          )}
          {profile.email && (
            <div>
              <dt>Correo electrónico</dt>
              <dd>{profile.email}</dd>
            </div>
          )}
        </dl>
      )}
    </aside>
  );
}
