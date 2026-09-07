import { useMemo, useState } from 'react';
import './catalog.css';

export interface CatalogUnit {
  id: string;
  code: string;
  slug: string;
  nickname: string | null;
  image: string | null;
  name: string;
  category: string;
  length_label: string | null;
  volume_l: number | null;
  skill_level: string;
  price_per_day: number;
  weight_min_kg: number | null;
  weight_max_kg: number | null;
  busy_until: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  softtop: 'Softtop',
  longboard: 'Longboard',
  funboard: 'Funboard',
  shortboard: 'Shortboard',
  fish: 'Fish',
  sup: 'SUP',
};
const LEVEL_LABEL: Record<string, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
  all: 'Todos los niveles',
};
// Un nivel "cubre" al surfista si la tabla es de ese nivel o para todos.
const LEVEL_MATCH: Record<string, string[]> = {
  beginner: ['beginner', 'all'],
  intermediate: ['intermediate', 'all'],
  advanced: ['advanced', 'all'],
};

const money = (n: number) => `$${Number(n).toFixed(0)}`;
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' });

type Sort = 'recommended' | 'price_asc' | 'price_desc' | 'volume_asc' | 'volume_desc';

export default function CatalogGrid({
  units,
  initialCategory = '',
}: {
  units: CatalogUnit[];
  initialCategory?: string;
}) {
  const [cats, setCats] = useState<string[]>(initialCategory ? [initialCategory] : []);
  const [level, setLevel] = useState('');
  const [weight, setWeight] = useState('');
  const [maxPrice, setMaxPrice] = useState(0);
  const [volMin, setVolMin] = useState('');
  const [volMax, setVolMax] = useState('');
  const [sort, setSort] = useState<Sort>('recommended');
  const [openFilters, setOpenFilters] = useState(false);

  const priceCeiling = useMemo(
    () => Math.max(10, ...units.map((u) => Math.ceil(u.price_per_day))),
    [units],
  );
  const availableCats = useMemo(
    () => [...new Set(units.map((u) => u.category))],
    [units],
  );

  const price = maxPrice || priceCeiling;

  const shown = useMemo(() => {
    const w = Number(weight) || 0;
    const vMin = Number(volMin) || 0;
    const vMax = Number(volMax) || 0;
    const out = units.filter((u) => {
      if (cats.length && !cats.includes(u.category)) return false;
      if (level && !(LEVEL_MATCH[level] ?? []).includes(u.skill_level)) return false;
      if (u.price_per_day > price) return false;
      if (w > 0 && u.weight_min_kg != null && u.weight_max_kg != null) {
        if (w < u.weight_min_kg || w > u.weight_max_kg) return false;
      }
      if (vMin > 0 && (u.volume_l ?? 0) < vMin) return false;
      if (vMax > 0 && (u.volume_l ?? Infinity) > vMax) return false;
      return true;
    });
    const byVol = (u: CatalogUnit) => u.volume_l ?? 0;
    switch (sort) {
      case 'price_asc':
        return [...out].sort((a, b) => a.price_per_day - b.price_per_day);
      case 'price_desc':
        return [...out].sort((a, b) => b.price_per_day - a.price_per_day);
      case 'volume_asc':
        return [...out].sort((a, b) => byVol(a) - byVol(b));
      case 'volume_desc':
        return [...out].sort((a, b) => byVol(b) - byVol(a));
      default:
        return out;
    }
  }, [units, cats, level, weight, price, volMin, volMax, sort]);

  const activeCount =
    cats.length + (level ? 1 : 0) + (weight ? 1 : 0) + (maxPrice ? 1 : 0) + (volMin || volMax ? 1 : 0);

  function toggleCat(c: string) {
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }
  function reset() {
    setCats([]);
    setLevel('');
    setWeight('');
    setMaxPrice(0);
    setVolMin('');
    setVolMax('');
    setSort('recommended');
  }

  return (
    <div className="cat">
      <div className="cat-bar">
        <div className="cat-chips">
          {availableCats.map((c) => (
            <button
              key={c}
              type="button"
              className={cats.includes(c) ? 'on' : ''}
              onClick={() => toggleCat(c)}
            >
              {CATEGORY_LABEL[c] ?? c}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="cat-more"
          aria-expanded={openFilters}
          onClick={() => setOpenFilters((v) => !v)}
        >
          {openFilters ? 'Menos filtros' : 'Más filtros'}
          {activeCount > 0 && <span className="cat-badge">{activeCount}</span>}
        </button>

        <span className="cat-count">
          {shown.length} {shown.length === 1 ? 'tabla' : 'tablas'}
        </span>

        <label className="cat-sort">
          <span>Ordenar</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="recommended">Recomendado</option>
            <option value="price_asc">Precio: menor primero</option>
            <option value="price_desc">Precio: mayor primero</option>
            <option value="volume_asc">Volumen: menor primero</option>
            <option value="volume_desc">Volumen: mayor primero</option>
          </select>
        </label>
      </div>

      {openFilters && (
        <div className="cat-adv">
          <label>
            ¿Cuánto pesás?
            <span className="cat-hint">Te dejamos las tablas que te van</span>
            <input
              type="number"
              min={20}
              max={160}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="kg"
            />
          </label>
          <label>
            Tu nivel
            <span className="cat-hint">&nbsp;</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="">Cualquier nivel</option>
              <option value="beginner">Principiante</option>
              <option value="intermediate">Intermedio</option>
              <option value="advanced">Avanzado</option>
            </select>
          </label>
          <label>
            Hasta {money(price)} por día
            <span className="cat-hint">&nbsp;</span>
            <input
              type="range"
              min={5}
              max={priceCeiling}
              step={1}
              value={price}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
            />
          </label>
          <label>
            Volumen (litros)
            <span className="cat-hint">Si ya sabés cuál buscás</span>
            <span className="cat-range">
              <input
                type="number"
                value={volMin}
                onChange={(e) => setVolMin(e.target.value)}
                placeholder="mín"
              />
              <em>-</em>
              <input
                type="number"
                value={volMax}
                onChange={(e) => setVolMax(e.target.value)}
                placeholder="máx"
              />
            </span>
          </label>
          {activeCount > 0 && (
            <button type="button" className="cat-reset" onClick={reset}>
              Limpiar filtros
            </button>
          )}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="cat-empty">
          <b>+</b>
          <strong>Ninguna tabla coincide</strong>
          <p>
            Probá aflojando el peso o el volumen. Si buscás algo puntual, escribinos y te decimos
            qué tenemos libre hoy.
          </p>
          <button type="button" onClick={reset}>
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="cat-grid">
          {shown.map((u) => (
            <a className="cat-card" key={u.id} href={`/surfboard-rental-tamarindo/tabla/${u.slug}`}>
              <div className="cat-photo">
                {u.image ? (
                  <img src={u.image} alt={u.name} loading="lazy" />
                ) : (
                  <span className="cat-nophoto">
                    <b>+</b>
                    {CATEGORY_LABEL[u.category] ?? u.category}
                  </span>
                )}
                {u.busy_until && (
                  <span className="cat-busy">Ocupada hasta el {shortDate(u.busy_until)}</span>
                )}
              </div>
              <div className="cat-body">
                <span className="cat-cat">{CATEGORY_LABEL[u.category] ?? u.category}</span>
                <h3>
                  {u.name}
                  {u.nickname && <em> · {u.nickname}</em>}
                </h3>
                <dl className="cat-specs">
                  <div>
                    <dt>Largo</dt>
                    <dd>{u.length_label ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>Volumen</dt>
                    <dd>{u.volume_l != null ? `${u.volume_l} L` : '-'}</dd>
                  </div>
                  <div>
                    <dt>Nivel</dt>
                    <dd>{LEVEL_LABEL[u.skill_level] ?? u.skill_level}</dd>
                  </div>
                  <div>
                    <dt>Peso</dt>
                    <dd>
                      {u.weight_min_kg && u.weight_max_kg
                        ? `${u.weight_min_kg}-${u.weight_max_kg} kg`
                        : '-'}
                    </dd>
                  </div>
                </dl>
                <p className="cat-price">
                  <strong>{money(u.price_per_day)}</strong> por día
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
