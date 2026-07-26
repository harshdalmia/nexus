import { useState } from 'react';
import {
  ChartFrame,
  GridLines,
  Readout,
  seriesPalette,
  toneOf,
} from '@/components/viz/ChartFrame';
import { num } from '@/lib/format';
import type { ChartSpec } from '@/types/aml';

/* Bars are drawn as a two-tone column: body in the state colour at 78%, plus
   a solid 2px cap. The cap gives a precise read of the value the way a tick
   would, and keeps a chart legible when printed in greyscale. */
export const BarChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const data = spec.data ?? [];
  const max = Math.max(...data.map((item) => item.value), 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} yLabel={spec.unit}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="plot relative min-h-0 flex-1">
          <GridLines />
          <div className="absolute inset-0 flex items-end gap-[3px] px-1 pt-2">
            {data.map((item, index) => {
              const tone = toneOf(item.severity, index);
              const active = hover === null || hover === index;

              return (
                <button
                  key={item.label}
                  type="button"
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  className="group relative flex h-full flex-1 items-end"
                  aria-label={`${item.label}: ${num(item.value)} ${spec.unit ?? ''}`}
                >
                  <span
                    className="anim-grow-h relative w-full transition-opacity duration-150"
                    style={{
                      height: `${String((item.value / max) * 100)}%`,
                      background: `linear-gradient(180deg, color-mix(in oklab, ${tone} 62%, transparent), color-mix(in oklab, ${tone} 26%, transparent))`,
                      opacity: active ? 1 : 0.38,
                      animationDelay: `${String(index * 45)}ms`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-[2px]"
                      style={{ background: tone }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

          {hover !== null && data[hover] !== undefined && (
            <Readout
              x={`${String(((hover + 0.5) / data.length) * 100)}%`}
              y="-6px"
              tone={toneOf(data[hover].severity, hover)}
              title={data[hover].label}
              value={`${num(data[hover].value)}${spec.unit === undefined ? '' : ` ${spec.unit}`}`}
              note={data[hover].note}
            />
          )}
        </div>

        <div className="mt-1 flex gap-[3px] px-1">
          {data.map((item, index) => (
            <span
              key={item.label}
              className={`tick-label flex-1 truncate text-center transition-colors ${
                hover === index ? 'text-dim' : ''
              }`}
            >
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </ChartFrame>
  );
};

export const StackedBarChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const series = spec.series ?? [];
  const names = spec.seriesNames ?? [];
  const max = Math.max(...series.map((point) => point.values.reduce((sum, value) => sum + value, 0)), 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <ChartFrame
      subtitle={spec.subtitle}
      footnote={spec.footnote}
      legend={names.map((label, index) => ({ label, color: seriesPalette[index % seriesPalette.length] }))}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="plot relative flex min-h-0 flex-1 items-end gap-[3px] px-1 pt-2">
          <GridLines steps={3} />
          {series.map((point, index) => {
            const total = point.values.reduce((sum, value) => sum + value, 0);
            const active = hover === null || hover === index;

            return (
              <button
                key={point.label}
                type="button"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(index)}
                onBlur={() => setHover(null)}
                className="anim-grow-h relative z-1 flex h-full flex-1 flex-col justify-end gap-px"
                style={{ animationDelay: `${String(index * 32)}ms` }}
                aria-label={`${point.label}: ${num(total)}`}
              >
                {[...point.values].reverse().map((value, reverseIndex) => {
                  const seriesIndex = point.values.length - 1 - reverseIndex;
                  const tone = seriesPalette[seriesIndex % seriesPalette.length];

                  return (
                    <span
                      key={seriesIndex}
                      className="w-full transition-opacity duration-150"
                      style={{
                        height: `${String((value / max) * 100)}%`,
                        background: `color-mix(in oklab, ${tone} ${reverseIndex === 0 ? '82' : '58'}%, transparent)`,
                        opacity: active ? 1 : 0.34,
                      }}
                    />
                  );
                })}
              </button>
            );
          })}

          {hover !== null && series[hover] !== undefined && (
            <Readout
              x={`${String(((hover + 0.5) / series.length) * 100)}%`}
              y="-6px"
              title={`point ${series[hover].label}`}
              value={num(series[hover].values.reduce((sum, value) => sum + value, 0))}
              note={series[hover].values.map((value, index) => `${names[index] ?? ''} ${String(value)}`).join(' · ')}
            />
          )}
        </div>

        <div className="mt-1 flex gap-[3px] px-1">
          {series.map((point) => (
            <span key={point.label} className="tick-label flex-1 text-center">
              {point.label}
            </span>
          ))}
        </div>
      </div>
    </ChartFrame>
  );
};

/* Horizontal bars carry the observed figure on the right and a threshold tick
   where the note implies one — the shape an AML analyst reads fastest. */
export const HBarChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const data = spec.data ?? [];
  const max = Math.max(...data.map((item) => item.value), 1);
  const [hover, setHover] = useState<number | null>(null);

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={0}>
      <ul className="flex flex-col gap-1">
        {data.map((item, index) => {
          const tone = toneOf(item.severity, index);
          const active = hover === null || hover === index;

          return (
            <li
              key={item.label}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              className="group flex items-center gap-2.5"
            >
              <span
                className={`ident w-[7.5rem] shrink-0 truncate text-meta transition-colors ${
                  hover === index ? 'text-ink' : 'text-dim'
                }`}
              >
                {item.label}
              </span>
              <span className="relative h-[7px] flex-1 overflow-hidden rounded-[1px] bg-sunken shadow-[inset_0_1px_1px_0_rgb(0_0_0/0.3)]">
                <span
                  className="anim-grow-w absolute inset-y-0 left-0 transition-opacity duration-150"
                  style={{
                    width: `${String((item.value / max) * 100)}%`,
                    background: `linear-gradient(90deg, color-mix(in oklab, ${tone} 30%, transparent), color-mix(in oklab, ${tone} 72%, transparent))`,
                    opacity: active ? 1 : 0.4,
                    animationDelay: `${String(index * 55)}ms`,
                  }}
                />
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-[2px]"
                  style={{
                    left: `calc(${String((item.value / max) * 100)}% - 2px)`,
                    background: tone,
                    opacity: active ? 1 : 0.4,
                  }}
                />
              </span>
              <span
                className={`num w-[10.5rem] shrink-0 truncate text-right text-meta transition-colors ${
                  hover === index ? 'text-dim' : 'text-faint'
                }`}
              >
                {item.note ?? num(item.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
};

/* SHAP as a proper waterfall: a running-total baseline, bars bridging between
   levels, and a final value marker. */
export const WaterfallChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const data = spec.data ?? [];
  const [hover, setHover] = useState<number | null>(null);

  let running = 0;
  const bars = data.map((item) => {
    const start = running;
    running += item.value;

    return { item, start, end: running };
  });

  const max = Math.max(...bars.map((bar) => Math.max(bar.start, bar.end)), 0.1) * 1.08;

  return (
    <ChartFrame
      subtitle={spec.subtitle}
      footnote={spec.footnote}
      legend={[
        { label: 'raises probability', color: 'var(--r-high)' },
        { label: 'lowers probability', color: 'var(--r-safe)' },
        { label: 'running total', color: 'var(--f-ai)' },
      ]}
      minHeight={168}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="plot relative min-h-0 flex-1 px-1 pt-2">
          <GridLines steps={4} />
          <div className="absolute inset-0 flex items-end gap-1.5 px-1">
            {bars.map((bar, index) => {
              const height = (Math.abs(bar.item.value) / max) * 100;
              const bottom = (Math.min(bar.start, bar.end) / max) * 100;
              const positive = bar.item.value >= 0;
              const tone = positive ? 'var(--r-high)' : 'var(--r-safe)';
              const active = hover === null || hover === index;

              return (
                <button
                  key={bar.item.label}
                  type="button"
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  className="relative h-full flex-1"
                  aria-label={`${bar.item.label}: ${bar.item.value.toFixed(2)}, running total ${bar.end.toFixed(2)}`}
                >
                  {/* connector to the next level */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-[-0.375rem] border-t border-dashed"
                    style={{
                      bottom: `${String((bar.end / max) * 100)}%`,
                      borderColor: 'color-mix(in oklab, var(--f-ai) 45%, transparent)',
                    }}
                  />
                  <span
                    className="anim-grow-h absolute inset-x-1 transition-opacity duration-150"
                    style={{
                      height: `${String(Math.max(height, 1.4))}%`,
                      bottom: `${String(bottom)}%`,
                      background: `color-mix(in oklab, ${tone} 55%, transparent)`,
                      borderTop: positive ? `2px solid ${tone}` : 'none',
                      borderBottom: positive ? 'none' : `2px solid ${tone}`,
                      opacity: active ? 1 : 0.35,
                      animationDelay: `${String(index * 60)}ms`,
                    }}
                  />
                </button>
              );
            })}
          </div>

          {hover !== null && bars[hover] !== undefined && (
            <Readout
              x={`${String(((hover + 0.5) / bars.length) * 100)}%`}
              y="-6px"
              tone={bars[hover].item.value >= 0 ? 'var(--r-high)' : 'var(--r-safe)'}
              title={bars[hover].item.label.replace(/_/g, ' ')}
              value={`${bars[hover].item.value > 0 ? '+' : ''}${bars[hover].item.value.toFixed(2)}`}
              note={`running total ${bars[hover].end.toFixed(2)}`}
            />
          )}
        </div>

        <div className="mt-1 flex gap-1.5 px-1">
          {bars.map((bar, index) => (
            <span
              key={bar.item.label}
              className={`tick-label flex-1 truncate text-center transition-colors ${
                hover === index ? 'text-dim' : ''
              }`}
              title={bar.item.label}
            >
              {bar.item.label.replace(/_/g, ' ').slice(0, 11)}
            </span>
          ))}
        </div>
      </div>
    </ChartFrame>
  );
};
