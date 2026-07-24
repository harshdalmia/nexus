import type { ReactNode } from 'react';

interface PanelProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/* Panels are frames in a seamed grid: 1px borders, no shadows, no radius.
   Callers pass hair-* classes to decide which seams they own. */
export const Panel = ({ children, className = '' }: PanelProps) => (
  <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel ${className}`}>
    {children}
  </section>
);

interface PanelHeadProps {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  readonly accent?: ReactNode;
}

export const PanelHead = ({ title, meta, actions, accent }: PanelHeadProps) => (
  <header className="panel-head">
    {accent}
    <h2 className="eyebrow shrink-0">{title}</h2>
    {meta !== undefined && (
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-2xs text-faint">{meta}</div>
    )}
    {actions !== undefined && (
      <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
    )}
  </header>
);

export const PanelBody = ({
  children,
  className = '',
  scroll = true,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly scroll?: boolean;
}) => (
  <div className={`flex min-h-0 flex-1 flex-col ${scroll ? 'scroll' : 'overflow-hidden'} ${className}`}>
    {children}
  </div>
);

export const PanelFoot = ({
  children,
  className = '',
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) => (
  <footer
    className={`flex shrink-0 items-center gap-3 border-t border-line bg-panel px-2.5 py-1.5 text-2xs text-faint ${className}`}
  >
    {children}
  </footer>
);
