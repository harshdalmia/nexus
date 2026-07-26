import type { ReactNode } from 'react';
import type { Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Shared chart chrome. Every visualisation in the product is built on
   this frame so plots, axes, ticks, legends and readouts are one
   family rather than a set of library defaults.
   ------------------------------------------------------------------ */

export const severityVar: Record<Severity, string> = {
  severe: 'var(--r-high)',
  review: 'var(--r-med)',
  clear: 'var(--r-safe)',
};

export const severityMuted: Record<Severity, string> = {
  severe: 'color-mix(in oklab, var(--r-high) 32%, transparent)',
  review: 'color-mix(in oklab, var(--r-med) 32%, transparent)',
  clear: 'color-mix(in oklab, var(--r-safe) 28%, transparent)',
};

/** categorical ramp, used only when a series carries no semantic meaning */
export const seriesPalette = [
  'var(--f-info)',
  'var(--f-ai)',
  'var(--r-med)',
  'var(--r-safe)',
  'var(--r-high)',
] as const;

export const toneOf = (severity: Severity | undefined, index = 0): string =>
  severity === undefined ? seriesPalette[index % seriesPalette.length] : severityVar[severity];

interface ChartFrameProps {
  readonly subtitle?: string;
  readonly footnote?: string;
  readonly legend?: ReadonlyArray<{ readonly label: string; readonly color: string }>;
  readonly children: ReactNode;
  readonly minHeight?: number;
  /** vertical axis caption, drawn rotated against the plot */
  readonly yLabel?: string;
  readonly xLabel?: string;
}

export const ChartFrame = ({
  subtitle,
  footnote,
  legend,
  children,
  minHeight = 148,
  yLabel,
  xLabel,
}: ChartFrameProps) => (
  <figure className="flex min-h-0 flex-1 flex-col gap-2 px-4.5 py-3.5">
    {(subtitle !== undefined || legend !== undefined) && (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {subtitle !== undefined && (
          <figcaption className="text-2xs tracking-tight text-faint">{subtitle}</figcaption>
        )}
        {legend !== undefined && legend.length > 0 && (
          <ul className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            {legend.map(({ label, color }) => (
              <li key={label} className="flex items-center gap-1.5 text-meta text-muted">
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[7px] rounded-[1px]"
                  style={{ background: color, boxShadow: `0 0 0 1px color-mix(in oklab, ${color} 40%, transparent)` }}
                />
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>
    )}

    <div className="flex min-h-0 flex-1 items-stretch gap-1.5" style={{ minHeight }}>
      {yLabel !== undefined && (
        <span className="tick-label shrink-0 self-center [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">
          {yLabel}
        </span>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>

    {(footnote !== undefined || xLabel !== undefined) && (
      <div className="flex items-baseline justify-between gap-3">
        {footnote !== undefined && (
          <p className="border-l border-rule pl-2 text-meta leading-relaxed text-faint">{footnote}</p>
        )}
        {xLabel !== undefined && <span className="tick-label ml-auto shrink-0">{xLabel}</span>}
      </div>
    )}
  </figure>
);

/** horizontal grid rules drawn inside a plot well */
export const GridLines = ({ steps = 4 }: { readonly steps?: number }) => (
  <>
    {Array.from({ length: steps + 1 }, (_, index) => index / steps).map((line) => (
      <span
        key={line}
        aria-hidden="true"
        className={`absolute inset-x-0 border-t ${
          line === 0 ? 'border-rule' : 'border-line/60 border-dashed'
        }`}
        style={{ bottom: `${String(line * 100)}%` }}
      />
    ))}
  </>
);

/** a labelled reference line, e.g. the $10,000 CTR threshold */
export const ReferenceLine = ({
  position,
  label,
  orientation = 'x',
  tone = 'var(--r-med)',
}: {
  readonly position: number;
  readonly label: string;
  readonly orientation?: 'x' | 'y';
  readonly tone?: string;
}) => (
  <span
    aria-hidden="true"
    className={`pointer-events-none absolute ${orientation === 'x' ? 'inset-y-0' : 'inset-x-0'}`}
    style={
      orientation === 'x'
        ? { left: `${String(position)}%`, borderLeft: `1px dashed ${tone}`, opacity: 0.55 }
        : { bottom: `${String(position)}%`, borderTop: `1px dashed ${tone}`, opacity: 0.55 }
    }
  >
    <span
      className="num absolute top-0 left-1 text-meta whitespace-nowrap"
      style={{ color: tone, transform: orientation === 'y' ? 'translateY(-100%)' : undefined }}
    >
      {label}
    </span>
  </span>
);

/** the one tooltip shape used by every chart */
export const Readout = ({
  x,
  y,
  title,
  value,
  note,
  tone,
}: {
  readonly x: string;
  readonly y: string;
  readonly title: string;
  readonly value: string;
  readonly note?: string;
  readonly tone?: string;
}) => (
  <div
    className="anim-scale-in overlay-shadow pointer-events-none absolute z-10 min-w-[7.5rem] -translate-x-1/2 rounded-[3px] border border-rule bg-panel"
    style={{ left: x, top: y }}
  >
    <div className="flex items-center gap-1.5 border-b border-line px-2 py-1">
      {tone !== undefined && (
        <span aria-hidden="true" className="h-2 w-[2px] rounded-[1px]" style={{ background: tone }} />
      )}
      <p className="truncate text-meta tracking-tight text-faint">{title}</p>
    </div>
    <div className="px-2 py-1">
      <p className="metric text-card text-ink">{value}</p>
      {note !== undefined && <p className="truncate pt-0.5 text-meta text-muted">{note}</p>}
    </div>
  </div>
);
