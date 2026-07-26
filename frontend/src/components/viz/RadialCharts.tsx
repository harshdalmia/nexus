import { useState } from 'react';
import { ChartFrame, toneOf } from '@/components/viz/ChartFrame';
import { num } from '@/lib/format';
import type { ChartSpec, Datum } from '@/types/aml';

const polar = (cx: number, cy: number, r: number, angle: number): readonly [number, number] => [
  cx + r * Math.cos(angle - Math.PI / 2),
  cy + r * Math.sin(angle - Math.PI / 2),
];

const arcPath = (
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number,
): string => {
  const [x1, y1] = polar(cx, cy, outer, start);
  const [x2, y2] = polar(cx, cy, outer, end);
  const [x3, y3] = polar(cx, cy, inner, end);
  const [x4, y4] = polar(cx, cy, inner, start);
  const large = end - start > Math.PI ? 1 : 0;

  return [
    `M${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A${String(outer)} ${String(outer)} 0 ${String(large)} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A${String(inner)} ${String(inner)} 0 ${String(large)} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
};

const Segments = ({
  data,
  inner,
  hover,
  onHover,
}: {
  readonly data: readonly Datum[];
  readonly inner: number;
  readonly hover: number | null;
  readonly onHover: (index: number | null) => void;
}) => {
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  let cursor = 0;

  return (
    <>
      {data.map((item, index) => {
        const start = (cursor / total) * Math.PI * 2;
        cursor += item.value;
        const end = (cursor / total) * Math.PI * 2;
        const isActive = hover === index;
        const tone = toneOf(item.severity, index);

        return (
          <g key={item.label}>
            <path
              d={arcPath(50, 50, isActive ? 46 : 43.5, inner, start + 0.014, end - 0.014)}
              fill={`color-mix(in oklab, ${tone} ${isActive ? '82' : '62'}%, transparent)`}
              className="cursor-pointer transition-all duration-150"
              onMouseEnter={() => onHover(index)}
              onMouseLeave={() => onHover(null)}
              opacity={hover === null || isActive ? 1 : 0.4}
            />
            {/* outer cap: a precise edge on every wedge */}
            <path
              d={arcPath(50, 50, isActive ? 46 : 43.5, isActive ? 44 : 41.8, start + 0.014, end - 0.014)}
              fill={tone}
              opacity={hover === null || isActive ? 1 : 0.4}
              className="pointer-events-none transition-all duration-150"
            />
          </g>
        );
      })}
    </>
  );
};

const Legend = ({
  data,
  total,
  hover,
  onHover,
  formatValue,
}: {
  readonly data: readonly Datum[];
  readonly total: number;
  readonly hover: number | null;
  readonly onHover: (index: number | null) => void;
  readonly formatValue: (item: Datum) => string;
}) => (
  <ul className="flex min-w-0 flex-1 flex-col justify-center divide-y divide-line/70">
    {data.map((item, index) => (
      <li key={item.label}>
        <button
          type="button"
          onMouseEnter={() => onHover(index)}
          onMouseLeave={() => onHover(null)}
          onFocus={() => onHover(index)}
          onBlur={() => onHover(null)}
          className={`flex w-full items-baseline gap-2 py-1 text-left transition-opacity duration-150 ${
            hover === null || hover === index ? 'opacity-100' : 'opacity-40'
          }`}
        >
          <span
            aria-hidden="true"
            className="mt-1 h-2 w-[3px] shrink-0 rounded-[1px]"
            style={{ background: toneOf(item.severity, index) }}
          />
          <span className="min-w-0 flex-1 truncate text-label text-dim">{item.label}</span>
          <span className="num shrink-0 text-body text-ink">{formatValue(item)}</span>
          <span className="num w-11 shrink-0 text-right text-meta text-faint">
            {((item.value / total) * 100).toFixed(0)}%
          </span>
        </button>
      </li>
    ))}
  </ul>
);

export const PieChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const data = spec.data ?? [];
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={128}>
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-[118px] w-[118px] shrink-0" role="img" aria-label={spec.title}>
          <circle cx="50" cy="50" r="46" fill="none" stroke="var(--s-line)" strokeWidth="0.6" />
          <Segments data={data} inner={16} hover={hover} onHover={setHover} />
        </svg>
        <Legend data={data} total={total} hover={hover} onHover={setHover} formatValue={(item) => num(item.value)} />
      </div>
    </ChartFrame>
  );
};

export const DonutChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const data = spec.data ?? [];
  const total = data.reduce((sum, item) => sum + item.value, 0) || 1;
  const [hover, setHover] = useState<number | null>(null);
  const active = hover === null ? null : data[hover];

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={128}>
      <div className="flex min-h-0 flex-1 items-center gap-4">
        <div className="relative h-[118px] w-[118px] shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={spec.title}>
            {/* quarter ticks around the ring */}
            {[0, 90, 180, 270].map((deg) => {
              const [x1, y1] = polar(50, 50, 47.5, (deg * Math.PI) / 180);
              const [x2, y2] = polar(50, 50, 44.5, (deg * Math.PI) / 180);

              return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--s-rule)" strokeWidth="0.8" />;
            })}
            <Segments data={data} inner={28} hover={hover} onHover={setHover} />
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="metric text-metric text-ink">
              {active === null ? Math.round(total) : Math.round(active.value)}
            </span>
            <span className="max-w-[5.5rem] truncate text-center text-meta tracking-wide text-faint uppercase">
              {active === null ? 'composite' : active.label}
            </span>
          </div>
        </div>
        <Legend
          data={data}
          total={total}
          hover={hover}
          onHover={setHover}
          formatValue={(item) => item.value.toFixed(1)}
        />
      </div>
    </ChartFrame>
  );
};

/* Gauge with banded track and a needle: the instrument reference, not a
   progress ring. Bands are the operating ranges, the needle is the reading. */
export const GaugeChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const gauge = spec.gauge ?? { value: 0, label: '0', caption: '' };
  const ratio = Math.min(1, Math.max(0, gauge.value));
  const sweep = Math.PI * 1.4;
  const start = -sweep / 2;
  const end = start + sweep * ratio;
  const tone = ratio >= 0.85 ? 'var(--r-safe)' : ratio >= 0.6 ? 'var(--f-ai)' : 'var(--r-med)';
  const [needleX, needleY] = polar(50, 58, 40, end);
  const [baseX, baseY] = polar(50, 58, 12, end);

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={128}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="relative">
          <svg viewBox="0 0 100 80" className="h-[106px] w-[142px]" role="img" aria-label={`${spec.title}: ${gauge.label}`}>
            <path d={arcPath(50, 58, 44, 36, start, start + sweep)} fill="var(--s-sunken)" />
            {/* operating bands */}
            <path
              d={arcPath(50, 58, 44, 41, start, start + sweep * 0.6)}
              fill="color-mix(in oklab, var(--r-med) 45%, transparent)"
            />
            <path
              d={arcPath(50, 58, 44, 41, start + sweep * 0.6, start + sweep * 0.85)}
              fill="color-mix(in oklab, var(--f-ai) 45%, transparent)"
            />
            <path
              d={arcPath(50, 58, 44, 41, start + sweep * 0.85, start + sweep)}
              fill="color-mix(in oklab, var(--r-safe) 55%, transparent)"
            />
            <path d={arcPath(50, 58, 40, 36, start, end)} fill={tone} className="anim-fade" />
            {/* ticks every 10% */}
            {Array.from({ length: 11 }, (_, index) => index / 10).map((step) => {
              const angle = start + sweep * step;
              const [x1, y1] = polar(50, 58, 35, angle);
              const [x2, y2] = polar(50, 58, step % 0.5 === 0 ? 30 : 32.5, angle);

              return (
                <line
                  key={step}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--s-edge)"
                  strokeWidth={step % 0.5 === 0 ? 0.9 : 0.5}
                />
              );
            })}
            <line x1={baseX} y1={baseY} x2={needleX} y2={needleY} stroke="var(--t-ink)" strokeWidth="1.1" />
            <circle cx="50" cy="58" r="2.4" fill="var(--t-ink)" />
          </svg>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
            <span className="metric text-metric-lg" style={{ color: tone }}>
              {gauge.label}
            </span>
          </div>
        </div>
        <p className="max-w-[26ch] pt-1.5 text-center text-label leading-relaxed text-muted">{gauge.caption}</p>
      </div>
    </ChartFrame>
  );
};
