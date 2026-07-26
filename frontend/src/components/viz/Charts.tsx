import { num, percent } from '@/lib/format';
import type { Severity } from '@/types/aml';

interface PyramidProps {
  readonly steps: ReadonlyArray<{
    readonly label: string;
    readonly value: number;
    readonly width: number;
    readonly severity: Severity;
  }>;
}

const stepTone: Record<Severity, { readonly bar: string; readonly text: string; readonly tint: string }> = {
  severe: { bar: 'bg-sev', text: 'text-sev', tint: 'color-mix(in oklab, var(--r-high) 14%, var(--s-panel))' },
  review: { bar: 'bg-rev', text: 'text-rev', tint: 'color-mix(in oklab, var(--r-med) 12%, var(--s-panel))' },
  clear: { bar: 'bg-ok', text: 'text-dim', tint: 'var(--s-raise)' },
};

/**
 * The alert funnel. Each stage is a measured plate with its own retention
 * figure, so the narrowing is quantified rather than merely illustrated.
 */
export const Pyramid = ({ steps }: PyramidProps) => (
  <ol className="flex flex-col items-center gap-1 px-3 py-2.5">
    {steps.map(({ label, value, width, severity }, index) => {
      const previous = steps[index - 1];
      const retained = previous === undefined ? null : value / previous.value;
      const tone = stepTone[severity];

      return (
        <li
          key={label}
          className="anim-grow-w relative flex items-center gap-3 rounded-[2px] border border-line px-2.5 py-1.5 shadow-[var(--elev-1)] transition-[width] duration-500"
          style={{ width: `${String(width)}%`, background: tone.tint, animationDelay: `${String(index * 70)}ms` }}
        >
          <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[2.5px] rounded-l-[2px] ${tone.bar}`} />
          <span className={`metric shrink-0 text-metric ${tone.text}`}>{num(value)}</span>
          <span className="min-w-0 flex-1 truncate text-label tracking-tight text-dim">{label}</span>
          {retained !== null && (
            <span className="num shrink-0 text-meta text-faint">{percent(retained, 1)} kept</span>
          )}
        </li>
      );
    })}
  </ol>
);

/**
 * Confidence dial used inside dense panels: a ring plus the value, with a
 * tick at the 0.85 acceptance mark so a reading has a reference.
 */
export const DonutConfidence = ({ value }: { readonly value: number }) => {
  const dash = Math.min(1, Math.max(0, value)) * 100;
  const tone = value >= 0.85 ? 'var(--r-safe)' : value >= 0.6 ? 'var(--f-ai)' : 'var(--r-med)';

  return (
    <svg
      viewBox="0 0 40 40"
      className="size-10"
      role="img"
      aria-label={`Confidence ${(value * 100).toFixed(0)} percent`}
    >
      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--s-sunken)" strokeWidth="3.5" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="var(--s-rule)" strokeWidth="0.6" />
      <circle
        cx="20"
        cy="20"
        r="16"
        fill="none"
        stroke={tone}
        strokeWidth="3.5"
        strokeDasharray={`${String(dash)} 100`}
        strokeLinecap="butt"
        transform="rotate(-90 20 20)"
        pathLength={100}
      />
      {/* acceptance mark at 0.85 */}
      <line
        x1="20"
        y1="2"
        x2="20"
        y2="6"
        stroke="var(--t-faint)"
        strokeWidth="0.9"
        transform="rotate(306 20 20)"
      />
      <text x="20" y="23.5" textAnchor="middle" className="font-mono text-[11px]" fill="var(--t-ink)">
        {value.toFixed(2)}
      </text>
    </svg>
  );
};
