import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { requestApi as api, DAYS, sesionActual } from '../api';
import Avatar from './ui/Avatar';
import Icon from './ui/Icon';
import ProfileSkeleton from './ui/ProfileSkeleton';
import ProfessionalContact from './ProfessionalContact';

export default function VerPerfiles() {
  const { id } = useParams();
  const location = useLocation();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    setError('');
    api(`/usuarios/${id}`, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setProfile(data);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      });
    return () => controller.abort();
  }, [id, retry]);
  const schedules = (profile?.horarios || [])
    .filter((item) => item.estado?.toLowerCase() === 'disponible')
    .sort(
      (a, b) =>
        DAYS.indexOf(a.dia_semana) - DAYS.indexOf(b.dia_semana) ||
        a.hora_inicio.localeCompare(b.hora_inicio),
    );
  const returnPath = location.state?.from || location.state?.volverA;
  const back = returnPath?.startsWith('/cartilla') ? returnPath : '/cartilla';

  return (
    <div className="page-container">
      <Link className="text-link profile-back" to={back}>
        <Icon name="back" size={17} />
        Volver a los profesionales
      </Link>
      {error ? (
        <div className="empty-state" role="alert">
          <h1>No pudimos cargar este perfil.</h1>
          <p>{error}</p>
          <button
            className="button button-primary"
            onClick={() => setRetry((v) => v + 1)}
          >
            Reintentar
          </button>
        </div>
      ) : !profile ? (
        <ProfileSkeleton />
      ) : (
        <>
          <header className="profile-hero">
            <Avatar person={profile} large />
            <div>
              <span className="eyebrow">PERFIL PROFESIONAL</span>
              <h1>
                {profile.nombre} {profile.apellido}
              </h1>
              <p className="card-location">
                <Icon name="pin" size={15} />
                {profile.ciudad || 'Zona sin informar'}
              </p>
              <div className="card-tags">
                <span className="specialty-tag">
                  {profile.especialidad || 'Especialidad sin informar'}
                </span>
                <span
                  className={`availability ${profile.disponible ? '' : 'unavailable'}`}
                >
                  <span className="status-dot" />
                  {profile.disponible ? 'Disponible' : 'No disponible'}
                </span>
              </div>
            </div>
          </header>
          {sesionActual()?.rol === 'paciente' && profile.rol === 'enfermero' && (
            <Link className="button button-primary" to={`/perfil/${id}/solicitar`}>
              Solicitar servicio
            </Link>
          )}
          <div className="profile-columns public-profile-layout">
            <ProfessionalContact profile={profile} />
            <div className="profile-information">
              <section className="content-panel">
                <h2 className="panel-title">
                  <Icon name="user" />
                  Conocé a {profile.nombre}
                </h2>
                <p>
                  {profile.descripcion ||
                    'Este profesional todavía no agregó una presentación.'}
                </p>
                <dl className="profile-facts">
                  <div>
                    <dt>Especialidad</dt>
                    <dd>{profile.especialidad || 'Sin informar'}</dd>
                  </div>
                  <div>
                    <dt>Experiencia</dt>
                    <dd>
                      {profile.experiencia_anios > 0
                        ? `${profile.experiencia_anios} años`
                        : 'Sin informar'}
                    </dd>
                  </div>
                  <div>
                    <dt>Matrícula informada</dt>
                    <dd>{profile.matricula || 'Sin informar'}</dd>
                  </div>
                </dl>
              </section>
              <section className="content-panel">
                <h2 className="panel-title">
                  <Icon name="calendar" />
                  Horarios disponibles
                </h2>
                {schedules.length ? (
                  <dl className="weekly-schedule">
                    {DAYS.filter((day) =>
                      schedules.some((item) => item.dia_semana === day),
                    ).map((day) => (
                      <div key={day}>
                        <dt>{day}</dt>
                        <dd>
                          {schedules
                            .filter((item) => item.dia_semana === day)
                            .map((item) => (
                              <span className="time-slot" key={item.id}>
                                <Icon name="clock" size={14} />
                                {item.hora_inicio.slice(0, 5)} –{' '}
                                {item.hora_fin.slice(0, 5)}
                              </span>
                            ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p>
                    No hay horarios disponibles publicados. Consultá
                    directamente con el profesional.
                  </p>
                )}
                <p className="schedule-note">
                  Los horarios son orientativos. Confirmá la disponibilidad al
                  contactar.
                </p>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
