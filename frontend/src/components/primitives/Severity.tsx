import type { ReactNode } from 'react';
import { severityOfScore } from '@/types/aml';
import type { Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Risk expression. Three signals every time, so state survives
   greyscale printing and colour-blind vision:
     1. colour band
     2. a solid cap or bar
     3. a three-letter abbreviation
   ------------------------------------------------------------------ */

export const severityText: Record<Severity, string> = {
  severe: 'high',
  review: 'med',
  clear: 'low',
};

export const severityFg: Record<Severity, string> = {
  severe: 'text-sev',
  review: 'text-rev',
  clear: 'text-ok',
};

export const severityBg: Record<Severity, string> = {
  severe: 'bg-sev',
  review: 'bg-rev',
  clear: 'bg-ok',
};

export const severityChip: Record<Severity, string> = {
  severe: 'bg-sev-bg text-sev border-sev-line',
  review: 'bg-rev-bg text-rev border-rev-line',
  clear: 'bg-ok-bg text-ok border-ok-line',
};

/** critical is reserved for scores at or above 90 — the deep crimson band */
export const isCritical = (score: number): boolean => score >= 90;

export const SeverityBar = ({ severity }: { readonly severity: Severity }) => (
  <span
    aria-hidden="true"
    className={`inline-block h-3 w-[2.5px] shrink-0 translate-y-px rounded-[1px] ${severityBg[severity]}`}
  />
);

interface TagProps {
  readonly severity: Severity;
  readonly children?: ReactNode;
  readonly className?: string;
}

export const SeverityTag = ({ severity, children, className = '' }: TagProps) => (
  <span className={`badge badge-cap ${severityChip[severity]} ${className}`}>
    {children ?? severityText[severity]}
  </span>
);

/**
 * The score itself. Display face, tight tracking, tabular — large enough to
 * be the first thing the eye lands on in a dense row, with a four-segment
 * gauge behind it so magnitude reads pre-attentively.
 */
export const ScoreValue = ({
  score,
  className = '',
}: {
  readonly score: number;
  readonly className?: string;
}) => {
  const severity = severityOfScore(score);
  const critical = isCritical(score);
  const filled = Math.round((score / 100) * 4);

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span aria-hidden="true" className="flex items-end gap-[1.5px]">
        {[0, 1, 2, 3].map((step) => (
          <span
            key={step}
            className={`w-[2px] rounded-[1px] transition-colors duration-150 ${
              step < filled
                ? critical
                  ? 'bg-crit'
                  : severityBg[severity]
                : 'bg-rule'
            }`}
            style={{ height: `${String(4 + step * 2.5)}px` }}
          />
        ))}
      </span>
      <span
        className={`metric text-card ${critical ? 'text-crit' : severityFg[severity]}`}
        title={critical ? 'critical band' : undefined}
      >
        {score}
      </span>
    </span>
  );
};

export const Tone = ({
  kind,
  children,
  className = '',
}: {
  readonly kind: 'info' | 'model' | 'neutral';
  readonly children: ReactNode;
  readonly className?: string;
}) => {
  const tones = {
    info: 'bg-info-bg text-info border-info-line',
    model: 'bg-model-bg text-model border-model-line',
    neutral: 'bg-raise text-muted border-rule',
  } as const;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-px text-meta font-medium tracking-tight ${tones[kind]} ${className}`}
    >
      {children}
    </span>
  );
};
