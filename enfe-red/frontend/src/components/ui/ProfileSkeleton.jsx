export default function ProfileSkeleton({ label = 'Cargando perfil…' }) {
  return (
    <div role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="profile-hero profile-skeleton-hero">
          <div className="skeleton avatar-large" />
          <div>
            <div className="skeleton wide" />
            <div className="skeleton" />
          </div>
        </div>
        <div className="profile-columns">
          {[1, 2].map((item) => (
            <div className="skeleton-card" key={item}>
              <div className="skeleton" />
              <div className="skeleton wide" />
              <div className="skeleton wide" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
