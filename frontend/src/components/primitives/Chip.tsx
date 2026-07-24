import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ChipProps {
  readonly children: ReactNode;
  readonly onRemove?: () => void;
  readonly onClick?: () => void;
  readonly tone?: 'neutral' | 'info' | 'model' | 'locked';
  readonly prefix?: string;
  readonly active?: boolean;
}

const tones = {
  neutral: 'border-rule bg-raise text-dim hover:border-edge hover:text-ink',
  info: 'border-info-line bg-info-bg text-info',
  model: 'border-model-line bg-model-bg text-model',
  locked: 'border-line bg-sunken text-faint',
} as const;

/* filter and scope chips: a labelled key on the left in a darker gutter,
   the value in ink — reads as a set condition, not a pill */
export const Chip = ({
  children,
  onRemove,
  onClick,
  tone = 'neutral',
  prefix,
  active = false,
}: ChipProps) => {
  const body = (
    <>
      {prefix !== undefined && (
        <span className="-ml-2 mr-1 flex h-full items-center border-r border-inherit bg-sunken/70 px-1.5 text-meta tracking-wider text-faint uppercase">
          {prefix}
        </span>
      )}
      <span className="truncate">{children}</span>
    </>
  );

  return (
    <span
      /* 26px tall with real gutters: scope and filter chips are read constantly and
         were previously too tight to scan or hit comfortably. */
      className={`inline-flex h-[26px] max-w-[18rem] items-center gap-1.5 overflow-hidden rounded-[2px] border text-label transition-colors duration-130 ${
        active ? 'border-info-line bg-info-bg text-info' : tones[tone]
      } ${prefix === undefined ? 'px-2' : 'pr-2 pl-2'}`}
    >
      {onClick === undefined ? (
        <span className="inline-flex h-full items-center gap-1 truncate">{body}</span>
      ) : (
        <button type="button" onClick={onClick} className="inline-flex h-full items-center gap-1 truncate">
          {body}
        </button>
      )}
      {onRemove !== undefined && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove filter"
          className="grid size-4 shrink-0 place-items-center rounded-[1px] text-faint transition-colors hover:bg-sev-bg hover:text-sev"
        >
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
};

/* segmented control: one recessed track, the active segment raised */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly id: T; readonly label: string }>;
  readonly onChange: (next: T) => void;
  readonly label: string;
}) => (
  <div
    role="group"
    aria-label={label}
    className="inline-flex items-stretch gap-px rounded-[2px] border border-rule bg-sunken p-px shadow-[inset_0_1px_2px_0_rgb(0_0_0/0.25)]"
    style={{ height: 'var(--control-h)' }}
  >
    {options.map(({ id, label: optionLabel }) => {
      const isActive = value === id;

      return (
        <button
          key={id}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(id)}
          className={`rounded-[1px] px-2.5 text-label font-medium tracking-tight transition-colors duration-130 ${
            isActive
              ? 'bg-raise text-ink shadow-[var(--elev-1)]'
              : 'text-faint hover:text-dim'
          }`}
        >
          {optionLabel}
        </button>
      );
    })}
  </div>
);
