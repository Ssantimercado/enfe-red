import { useEffect, useState } from 'react';
export default function Avatar({ person = {}, large = false }) {
  const [failed, setFailed] = useState(false);
  const photo = person.foto_url || person.foto || person.imagen;
  useEffect(() => setFailed(false), [photo]);
  const initials =
    `${person.nombre?.trim()?.[0] || ''}${person.apellido?.trim()?.[0] || ''}`.toUpperCase() ||
    'EN';
  const tone = (Number(person.usuario_id ?? person.id) || 0) % 4;
  return (
    <div
      className={`avatar avatar-${tone}${large ? ' avatar-large' : ''}`}
      aria-hidden="true"
    >
      {photo && !failed ? (
        <img src={photo} alt="" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </div>
  );
}
