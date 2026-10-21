interface Point {
  readonly label: string;
  readonly value: number;
}

interface Props {
  readonly points: readonly Point[];
  /** Descripción para lectores de pantalla (qué mide y entre qué fechas). */
  readonly label: string;
  readonly format: (n: number) => string;
}

const W = 600;
const H = 220;
const PAD = { l: 56, r: 16, t: 14, b: 30 };

/** Gráfica de líneas en SVG (sin dependencias). Debajo lleva una tabla con los mismos datos para quien no pueda ver la gráfica. */
export function LineChart({ points, label, format }: Props) {
  if (points.length === 0) return null;
  const max = Math.max(1, ...points.map((p) => p.value));
  const x = (i: number): number => (points.length === 1 ? (W + PAD.l - PAD.r) / 2 : PAD.l + (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number): number => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [0, 0.5, 1];
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={label} className="chart__svg">
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} />
            <text className="chart__tick" x={PAD.l - 8} y={y(max * t) + 4} textAnchor="end">
              {format(Math.round(max * t))}
            </text>
          </g>
        ))}
        {points.length > 1 && <path className="chart__line" d={path} fill="none" />}
        {points.map((p, i) => (
          <circle key={p.label} className="chart__dot" cx={x(i)} cy={y(p.value)} r={4}>
            <title>{`${p.label}: ${format(p.value)}`}</title>
          </circle>
        ))}
        {first !== undefined && (
          <text className="chart__tick" x={x(0)} y={H - 8} textAnchor={points.length === 1 ? 'middle' : 'start'}>
            {first.label}
          </text>
        )}
        {last !== undefined && points.length > 1 && (
          <text className="chart__tick" x={x(points.length - 1)} y={H - 8} textAnchor="end">
            {last.label}
          </text>
        )}
      </svg>
      <details className="chart__data">
        <summary>Ver los datos en una tabla</summary>
        <table className="stats">
          <caption className="visually-hidden">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Fecha</th>
              <th scope="col">Valor</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.label}>
                <th scope="row">{p.label}</th>
                <td>{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
