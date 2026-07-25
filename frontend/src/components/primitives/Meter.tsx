import type { ReactNode } from 'react';
import type { Severity } from '@/types/aml';

const fills: Record<Severity | 'info' | 'model', string> = {
  severe: 'bg-sev',
  review: 'bg-rev',
  clear: 'bg-ok',
  info: 'bg-info',
  model: 'bg-model',
};

interface MeterProps {
  readonly label: string;
  readonly value: string;
  readonly ratio: number;
  readonly tone?: Severity | 'info' | 'model';
  readonly mono?: boolean;
  readonly note?: string;
  readonly labelWidth?: string;
}

/**
 * A measured bar, not a progress bar: it sits in a recessed track with a
 * quarter-point tick pattern so a value can be read off it approximately
 * without a tooltip.
 */
export const Meter = ({
  label,
  value,
  ratio,
  tone = 'info',
  mono = false,
  note,
  labelWidth = '11rem',
}: MeterProps) => {
  const clamped = Math.min(100, Math.max(0, ratio));

  return (
    <li className="group flex items-center gap-2.5 py-[3px]">
      <span
        className={`shrink-0 truncate text-xs2 text-dim ${mono ? 'font-mono tracking-tight' : ''}`}
        style={{ width: labelWidth }}
        title={note ?? label}
      >
        {label}
      </span>

      <span className="relative h-[5px] flex-1 overflow-hidden rounded-[1px] bg-sunken shadow-[inset_0_1px_1px_0_rgb(0_0_0/0.3)]">
        {[25, 50, 75].map((tick) => (
          <span
            key={tick}
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-line"
            style={{ left: `${String(tick)}%` }}
          />
        ))}
        <span
          className={`anim-grow-w absolute inset-y-0 left-0 rounded-[1px] ${fills[tone]}`}
          style={{ width: `${String(clamped)}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-[1.5px] bg-ink/45 transition-[left] duration-500"
          style={{ left: `calc(${String(clamped)}% - 1.5px)` }}
        />
      </span>

      <span className="num w-12 shrink-0 text-right text-xs2 text-ink">{value}</span>
    </li>
  );
};

export const MeterList = ({ children }: { readonly children: ReactNode }) => (
  <ul className="flex flex-col">{children}</ul>
);
