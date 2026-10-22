import { useState } from 'react';
import { requestApi as api } from '../api';
import Icon from './ui/Icon';

// HU12: el paciente describe con sus palabras lo que necesita y la cartilla completa los filtros.
const MAX_TEXTO = 300;
const EJEMPLO = 'Necesito que alguien le ponga insulina a mi mamá los martes a la tarde en Godoy Cruz';
const FUENTES = {
  gemini: 'Interpretado con inteligencia artificial.',
  reglas: 'Interpretado con el asistente de búsqueda.',
};

export default function BusquedaAsistida({ onAplicar }) {
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [resultado, setResultado] = useState(null);

  async function buscar(event) {
    event.preventDefault();
    const pedido = texto.trim();
    if (!pedido || buscando) return;
    setBuscando(true);
    setError('');
    try {
      const respuesta = await api('/ia/interpretar-busqueda', { method: 'POST', body: { texto: pedido } });
      const { filtros = {}, fuente } = respuesta;
      const encontrados = ['especialidad', 'ciudad', 'dia_semana', 'hora_desde', 'hora_hasta']
        .some((clave) => filtros[clave]);
      setResultado({ ...filtros, fuente, encontrados });
      if (encontrados) onAplicar(filtros);
    } catch (err) {
      // Si falla, la búsqueda manual sigue disponible.
      setError(`${err.message} Podés usar los filtros de abajo.`);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <section className="assisted-search content-panel" aria-labelledby="busqueda-asistida-titulo">
      <h2 id="busqueda-asistida-titulo">
        <Icon name="search" size={20} />
        Contanos qué necesitás
      </h2>
      <p className="assisted-search-help" id="busqueda-asistida-ayuda">
        Escribilo como se lo dirías a una persona y completamos los filtros por vos. Después podés cambiarlos.
      </p>
      <form onSubmit={buscar}>
        <label className="sr-only" htmlFor="busqueda-asistida">Qué cuidado necesitás</label>
        <textarea
          id="busqueda-asistida"
          rows={2}
          maxLength={MAX_TEXTO}
          placeholder={`Por ejemplo: ${EJEMPLO}`}
          aria-describedby="busqueda-asistida-ayuda busqueda-asistida-aviso"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          disabled={buscando}
        />
        <div className="assisted-search-actions">
          <p className="assisted-search-notice" id="busqueda-asistida-aviso">
            No guardamos lo que escribís y quitamos teléfonos, correos y direcciones antes de analizarlo.
            Este asistente no reemplaza una consulta médica.
          </p>
          <button className="button button-primary" type="submit" disabled={buscando || !texto.trim()}>
            {buscando ? 'Buscando…' : 'Buscar con ayuda'}
          </button>
        </div>
      </form>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {resultado && (
        <div className="assisted-search-result" role="status">
          {resultado.aclaracion && (
            <p className="notice notice-error assisted-search-urgent">
              <strong>{resultado.aclaracion}</strong>
            </p>
          )}
          {resultado.encontrados ? (
            <p>
              Aplicamos los filtros que entendimos; los ves abajo y podés quitarlos.{' '}
              {resultado.servicio && <>Al pedir el turno, elegí el servicio <strong>{resultado.servicio}</strong>. </>}
              <span className="assisted-search-source">{FUENTES[resultado.fuente] || FUENTES.reglas}</span>
            </p>
          ) : (
            <p>
              No encontramos datos para filtrar en tu mensaje. Probá mencionando el tipo de cuidado, el día o la zona.
              {resultado.servicio && <> Para lo que contás, el servicio indicado es <strong>{resultado.servicio}</strong>.</>}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
