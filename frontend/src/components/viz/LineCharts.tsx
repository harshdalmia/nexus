import { useState } from 'react';
import { ChartFrame, GridLines, Readout } from '@/components/viz/ChartFrame';
import { num } from '@/lib/format';
import type { ChartSpec } from '@/types/aml';

const W = 100;
const H = 100;

const buildPath = (values: readonly number[], max: number, min: number): string => {
  const span = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * W;
      const y = H - ((value - min) / span) * H;

      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
};

interface LineProps {
  readonly spec: ChartSpec;
  readonly filled?: boolean;
}

/* A crosshair chart: hovering anywhere snaps to the nearest sample, drops a
   vertical rule, marks the point and prints the value. The line draws itself
   once on mount so a section arriving in the dossier is legible as motion. */
export const LineChart = ({ spec, filled = false }: LineProps) => {
  const data = spec.data ?? [];
  const values = data.map((item) => item.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const [hover, setHover] = useState<number | null>(null);
  const path = buildPath(values, max, min);
  const area = `${path} L${W} ${H} L0 ${H} Z`;
  const tone = filled ? 'var(--r-high)' : 'var(--f-info)';
  const last = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;
  const trend = last - first;

  return (
    <ChartFrame
      subtitle={spec.subtitle}
      footnote={spec.footnote}
      yLabel={spec.unit}
      legend={[
        {
          label: `${trend >= 0 ? '▲' : '▼'} ${num(Math.abs(trend))} across the window`,
          color: trend >= 0 ? 'var(--r-high)' : 'var(--r-safe)',
        },
      ]}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          className="plot relative min-h-0 flex-1"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientX - rect.left) / rect.width;
            setHover(Math.min(values.length - 1, Math.max(0, Math.round(ratio * (values.length - 1)))));
          }}
        >
          <GridLines steps={4} />

          <svg
            viewBox={`0 0 ${String(W)} ${String(H)}`}
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label={`${spec.title}: ${String(values.length)} points from ${num(first)} to ${num(last)}`}
          >
            {filled && (
              <>
                <defs>
                  <linearGradient id={`area-${spec.title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={tone} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={tone} stopOpacity="0.015" />
                  </linearGradient>
                </defs>
                <path d={area} fill={`url(#area-${spec.title.replace(/\s/g, '')})`} />
              </>
            )}
            <path
              d={path}
              fill="none"
              stroke={tone}
              strokeWidth={1.5}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className="anim-draw"
              style={{ strokeDasharray: 1400, ['--dash' as string]: '1400' }}
            />
            {/* terminal marker: where the series ends matters most */}
            <circle
              cx={W}
              cy={H - ((last - min) / (max - min || 1)) * H}
              r={2}
              fill={tone}
              vectorEffect="non-scaling-stroke"
            />
            {hover !== null && (
              <circle
                cx={(hover / Math.max(1, values.length - 1)) * W}
                cy={H - (((values[hover] ?? 0) - min) / (max - min || 1)) * H}
                r={2.6}
                fill="var(--s-panel)"
                stroke={tone}
                strokeWidth={1.6}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hover !== null && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px"
                style={{
                  left: `${String((hover / Math.max(1, values.length - 1)) * 100)}%`,
                  background: 'color-mix(in oklab, var(--f-info) 45%, transparent)',
                }}
              />
              <Readout
                x={`${String((hover / Math.max(1, values.length - 1)) * 100)}%`}
                y="-6px"
                tone={tone}
                title={data[hover]?.label ?? ''}
                value={`${num(values[hover] ?? 0)}${spec.unit === undefined ? '' : ` ${spec.unit}`}`}
              />
            </>
          )}
        </div>

        <div className="mt-1 flex justify-between">
          {data
            .filter((_, index) => index % Math.max(1, Math.ceil(data.length / 6)) === 0)
            .map((item) => (
              <span key={item.label} className="tick-label">
                {item.label}
              </span>
            ))}
        </div>
      </div>
    </ChartFrame>
  );
};

export const AreaChart = ({ spec }: { readonly spec: ChartSpec }) => <LineChart spec={spec} filled />;
