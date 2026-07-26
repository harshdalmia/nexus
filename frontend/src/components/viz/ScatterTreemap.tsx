import { useMemo, useState } from 'react';
import { ChartFrame, severityVar } from '@/components/viz/ChartFrame';
import { money, num } from '@/lib/format';
import type { ChartSpec, Datum } from '@/types/aml';

export const ScatterChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const points = spec.scatter ?? [];
  const [hover, setHover] = useState<string | null>(null);
  const maxX = Math.max(...points.map((point) => point.x), 1);
  const maxY = Math.max(...points.map((point) => point.y), 1);
  const active = points.find((point) => point.id === hover);

  return (
    <ChartFrame
      subtitle={spec.subtitle}
      footnote={spec.footnote}
      legend={[
        { label: 'severe cluster', color: severityVar.severe },
        { label: 'review cluster', color: severityVar.review },
        { label: 'baseline behaviour', color: severityVar.clear },
      ]}
      minHeight={190}
    >
      <div className="relative min-h-0 flex-1 border-b border-l border-line">
        {[0.25, 0.5, 0.75].map((line) => (
          <span
            key={`h-${String(line)}`}
            aria-hidden="true"
            className="absolute inset-x-0 border-t border-line/40"
            style={{ bottom: `${String(line * 100)}%` }}
          />
        ))}
        {/* the $10,000 reporting line, the only reference an AML analyst cares about here */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 border-l border-dashed border-rev/60"
          style={{ left: `${String((10000 / maxX) * 100)}%` }}
        >
          <span className="num absolute -top-1 left-1 text-meta text-rev">$10k CTR line</span>
        </span>

        {points.map((point) => {
          const size = 6 + point.size * 0.5;
          const isActive = hover === point.id;

          return (
            <button
              key={point.id}
              type="button"
              onMouseEnter={() => setHover(point.id)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(point.id)}
              onBlur={() => setHover(null)}
              aria-label={`${point.label}: mean ${money(point.x)}, velocity ${point.y.toFixed(1)} per day`}
              className="anim-fade absolute -translate-x-1/2 translate-y-1/2 rounded-full border transition-transform duration-150"
              style={{
                left: `${String((point.x / maxX) * 100)}%`,
                bottom: `${String((point.y / maxY) * 100)}%`,
                width: size,
                height: size,
                borderColor: severityVar[point.severity],
                background: `color-mix(in oklab, ${severityVar[point.severity]} 32%, transparent)`,
                transform: `translate(-50%, 50%) scale(${isActive ? '1.35' : '1'})`,
                opacity: hover === null || isActive ? 1 : 0.45,
              }}
            />
          );
        })}

        {active !== undefined && (
          <div
            className="overlay-shadow pointer-events-none absolute z-10 w-40 -translate-x-1/2 border border-edge bg-panel px-2 py-1"
            style={{
              left: `min(max(${String((active.x / maxX) * 100)}%, 5rem), calc(100% - 5rem))`,
              bottom: `calc(${String((active.y / maxY) * 100)}% + 0.75rem)`,
            }}
          >
            <p className="truncate text-label text-ink">{active.label}</p>
            <p className="num text-meta text-muted">mean {money(active.x)}</p>
            <p className="num text-meta text-muted">{active.y.toFixed(1)} txns/day</p>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-meta text-faint">
        <span className="num">mean transaction amount →</span>
        <span className="num">↑ velocity, txns per day</span>
      </div>
    </ChartFrame>
  );
};

interface Tile {
  readonly datum: Datum;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/* simple slice-and-dice treemap: deterministic, stable across renders and
   good enough for six to eight segments */
const layoutTiles = (data: readonly Datum[]): readonly Tile[] => {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const tiles: Tile[] = [];
  let x = 0;
  let y = 0;
  let remaining = total;
  let horizontal = true;

  data.forEach((datum, index) => {
    const share = datum.value / remaining;
    const isLast = index === data.length - 1;
    const availableW = 100 - x;
    const availableH = 100 - y;

    if (isLast) {
      tiles.push({ datum, x, y, w: availableW, h: availableH });

      return;
    }

    if (horizontal) {
      const w = availableW * share;
      tiles.push({ datum, x, y, w, h: availableH });
      x += w;
    } else {
      const h = availableH * share;
      tiles.push({ datum, x, y, w: availableW, h });
      y += h;
    }

    remaining -= datum.value;
    horizontal = !horizontal;
  });

  return tiles;
};

export const TreemapChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const data = spec.data ?? [];
  const tiles = useMemo(() => layoutTiles(data), [data]);
  const [hover, setHover] = useState<string | null>(null);
  const isMoney = data.some((item) => item.value > 10000);

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={158}>
      <div className="relative min-h-0 flex-1">
        {tiles.map(({ datum, x, y, w, h }) => (
          <button
            key={datum.label}
            type="button"
            onMouseEnter={() => setHover(datum.label)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(datum.label)}
            onBlur={() => setHover(null)}
            aria-label={`${datum.label}: ${isMoney ? money(datum.value) : num(datum.value)}`}
            className="anim-fade absolute flex flex-col items-start justify-end overflow-hidden border border-panel p-1.5 text-left transition-[filter] duration-100 hover:brightness-125"
            style={{
              left: `${String(x)}%`,
              top: `${String(y)}%`,
              width: `${String(w)}%`,
              height: `${String(h)}%`,
              background: `color-mix(in oklab, ${severityVar[datum.severity ?? 'clear']} ${
                hover === datum.label ? '38%' : '22%'
              }, transparent)`,
            }}
          >
            <span className="metric text-metric text-ink">
              {isMoney ? money(datum.value) : num(datum.value)}
            </span>
            <span className="w-full truncate text-meta text-dim">{datum.label}</span>
          </button>
        ))}
      </div>
    </ChartFrame>
  );
};

export const CorridorChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const flows = spec.corridor ?? [];
  const max = Math.max(...flows.map((flow) => flow.value), 1);
  const [hover, setHover] = useState<number | null>(null);

  const nodes = Array.from(new Set(flows.flatMap((flow) => [flow.from, flow.to])));
  const angleOf = (id: string): number => (nodes.indexOf(id) / nodes.length) * Math.PI * 2 - Math.PI / 2;
  const point = (id: string): readonly [number, number] => [
    50 + 34 * Math.cos(angleOf(id)),
    50 + 34 * Math.sin(angleOf(id)),
  ];

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={168}>
      <div className="flex min-h-0 flex-1 items-center gap-3">
        <svg viewBox="0 0 100 100" className="h-[152px] w-[152px] shrink-0" role="img" aria-label={spec.title}>
          {flows.map((flow, index) => {
            const [x1, y1] = point(flow.from);
            const [x2, y2] = point(flow.to);
            const isActive = hover === null || hover === index;

            return (
              <path
                key={`${flow.from}-${flow.to}`}
                d={`M${x1.toFixed(1)} ${y1.toFixed(1)} Q50 50 ${x2.toFixed(1)} ${y2.toFixed(1)}`}
                fill="none"
                stroke={severityVar[flow.severity]}
                strokeWidth={0.8 + (flow.value / max) * 3.2}
                opacity={isActive ? 0.75 : 0.15}
                className="transition-opacity duration-150"
              />
            );
          })}
          {nodes.map((id) => {
            const [x, y] = point(id);

            return (
              <g key={id}>
                <circle cx={x} cy={y} r={7.5} fill="var(--s-panel)" stroke="var(--s-edge)" strokeWidth={0.8} />
                <text
                  x={x}
                  y={y + 2.6}
                  textAnchor="middle"
                  className="font-mono text-[9px]"
                  fill="var(--t-ink)"
                >
                  {id}
                </text>
              </g>
            );
          })}
        </svg>

        <ul className="flex min-w-0 flex-1 flex-col gap-1">
          {flows.map((flow, index) => (
            <li key={`${flow.from}-${flow.to}`}>
              <button
                type="button"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                className={`flex w-full items-baseline gap-2 text-left transition-opacity ${
                  hover === null || hover === index ? 'opacity-100' : 'opacity-45'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="mt-1 size-2 shrink-0"
                  style={{ background: severityVar[flow.severity] }}
                />
                <span className="num shrink-0 text-body text-ink">
                  {flow.from}→{flow.to}
                </span>
                <span className="num min-w-0 flex-1 truncate text-right text-body text-dim">
                  {money(flow.value)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  );
};
