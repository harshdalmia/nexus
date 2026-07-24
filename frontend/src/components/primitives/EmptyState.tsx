import type { ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';

interface Action {
  readonly label: string;
  readonly onClick: () => void;
  readonly primary?: boolean;
}

interface EmptyStateProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly actions?: readonly Action[];
  readonly hint?: ReactNode;
}

/* Instructional, never "No data". The plate carries the same recessed
   treatment as a panel header so an empty region still reads as part of the
   instrument rather than a hole in the page. */
export const EmptyState = ({ icon, title, body, actions = [], hint }: EmptyStateProps) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-8 py-12 text-center">
    <span className="relative grid size-9 place-items-center rounded-[3px] border border-rule bg-sunken text-faint shadow-[var(--elev-1)]">
      {icon}
      <span aria-hidden="true" className="absolute -top-px left-1.5 h-px w-3 bg-info/60" />
    </span>

    <div className="flex flex-col gap-1.5">
      <p className="display text-body-lg tracking-tight text-ink">{title}</p>
      <p className="max-w-[46ch] text-xs2 leading-relaxed text-muted">{body}</p>
    </div>

    {actions.length > 0 && (
      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-1.5">
        {actions.map(({ label, onClick, primary = false }) => (
          <Button key={label} variant={primary ? 'primary' : 'quiet'} onClick={onClick}>
            {label}
          </Button>
        ))}
      </div>
    )}

    {hint !== undefined && (
      <p className="mt-0.5 border-t border-line pt-2 text-meta tracking-tight text-faint">{hint}</p>
    )}
  </div>
);
