import { Link } from 'react-router-dom';
import Brand from './ui/Brand';
import Icon from './ui/Icon';
export default function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Brand to="/" />
        <div className="auth-story-content">
          <span className="eyebrow">CUIDADO QUE CONECTA</span>
          <h1>
            Más cerca de quien
            <br />
            <em>te cuida.</em>
          </h1>
          <p>
            Encontrá profesionales de enfermería y acompañamiento para vos y tu
            familia, en un solo lugar.
          </p>
          <div className="care-illustration" aria-hidden="true">
            <div className="care-orbit orbit-one" />
            <div className="care-orbit orbit-two" />
            <div className="care-center">
              <Icon name="heart" size={62} />
            </div>
            <div className="care-float float-one">
              <Icon name="pin" />
              <span>Cerca de vos</span>
            </div>
            <div className="care-float float-two">
              <Icon name="calendar" />
              <span>A tu tiempo</span>
            </div>
            <div className="care-float float-three">
              <Icon name="user" />
              <span>Atención personal</span>
            </div>
          </div>
        </div>
        <p className="auth-story-footer">
          Una red de personas para cuidar de personas.
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand to="/" />
        </div>
        <div className="auth-form-wrap">{children}</div>
        <p className="auth-footnote">
          Enfered · Enfermería a domicilio ·{' '}
          <Link to="/terminos">Términos</Link> · <Link to="/privacidad">Privacidad</Link>
        </p>
      </main>
    </div>
  );
}
