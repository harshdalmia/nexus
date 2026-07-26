import { Children, createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useCollapsed } from '@/hooks/useCollapsed';

/* Panels come in two kinds: fixed, and collapsible when given a collapseId.
   The fold state itself lives in useCollapsed so this module exports only
   components (which is what keeps Fast Refresh working). */

interface CollapseContext {
  readonly shut: boolean;
  readonly toggle: () => void;
  readonly enabled: boolean;
  readonly title: string;
}

const PanelCollapse = createContext<CollapseContext>({
  shut: false,
  toggle: () => undefined,
  enabled: false,
  title: '',
});

interface PanelProps {
  readonly children: ReactNode;
  readonly className?: string;
  /** Give a panel a stable id to make it collapsible. Omit for a fixed panel. */
  readonly collapseId?: string;
  /** Start folded on first sight — for secondary detail, never for primary evidence. */
  readonly defaultCollapsed?: boolean;
}

/* Panels are frames in a seamed grid: 1px borders, no shadows, no radius.
   Callers pass hair-* classes to decide which seams they own. */
export const Panel = ({
  children,
  className = '',
  collapseId,
  defaultCollapsed = false,
}: PanelProps) => {
  const { shut, toggle } = useCollapsed(collapseId, defaultCollapsed);
  const enabled = collapseId !== undefined;
  const value = useMemo(
    () => ({ shut: enabled && shut, toggle, enabled, title: '' }),
    [enabled, shut, toggle],
  );

  /* Every panel puts its header first, so a collapsible panel can wrap
     everything after the header in the animated region itself. That keeps the
     change at each call site down to one prop — no restructuring, and no risk
     of a body being left outside the fold. */
  const [head, ...body] = enabled ? Children.toArray(children) : [];

  return (
    <PanelCollapse.Provider value={value}>
      <section
        data-collapsed={value.shut ? 'true' : undefined}
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-panel ${className}`}
      >
        {enabled ? (
          <>
            {head}
            {/* No extra layout box while open: the body's children stay direct
                flex items of the panel, exactly as they were before. */}
            <div
              className={value.shut ? 'panel-shut' : 'panel-open'}
              aria-hidden={value.shut}
            >
              {body}
            </div>
          </>
        ) : (
          children
        )}
      </section>
    </PanelCollapse.Provider>
  );
};

interface PanelHeadProps {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  readonly accent?: ReactNode;
  /** Shown in place of `meta` while the panel is shut, so a folded panel still says what it holds. */
  readonly summary?: ReactNode;
}

export const PanelHead = ({ title, meta, actions, accent, summary }: PanelHeadProps) => {
  const { enabled, shut, toggle } = useContext(PanelCollapse);
  const detail = shut && summary !== undefined ? summary : meta;

  return (
    <header className="panel-head">
      {accent}
      {enabled && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!shut}
          aria-label={`${shut ? 'Expand' : 'Collapse'} ${title}`}
          className="collapse-toggle"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
      )}
      {enabled ? (
        <h2 className="eyebrow shrink-0">
          <button type="button" onClick={toggle} className="text-left" tabIndex={-1}>
            {title}
          </button>
        </h2>
      ) : (
        <h2 className="eyebrow shrink-0">{title}</h2>
      )}
      {detail !== undefined && (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 truncate text-2xs text-faint">
          {detail}
        </div>
      )}
      {actions !== undefined && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      )}
    </header>
  );
};

export const PanelBody = ({
  children,
  className = '',
  scroll = true,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly scroll?: boolean;
}) => (
  /* No collapse handling here: `Panel` already wraps everything after the
     header, so a body is folded whether or not it uses this component. */
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
}) => {
  const { shut } = useContext(PanelCollapse);

  if (shut) {
    return null;
  }

  return (
    <footer
      className={`flex shrink-0 items-center gap-3.5 border-t border-line bg-panel px-[var(--panel-x)] py-2.5 text-2xs text-faint ${className}`}
    >
      {children}
    </footer>
  );
};

/* Sections that are not built on Panel/PanelBody (the dossier cards, the
   execution stage blocks) use this instead: same animation, same store, but it
   wraps arbitrary markup. */
export const Collapse = ({
  shut,
  children,
}: {
  readonly shut: boolean;
  readonly children: ReactNode;
}) => (
  <div className={shut ? 'panel-shut' : 'panel-open'} aria-hidden={shut}>
    {children}
  </div>
);

/** The chevron button on its own, for headers that are not a `PanelHead`. */
export const CollapseToggle = ({
  shut,
  onToggle,
  label,
}: {
  readonly shut: boolean;
  readonly onToggle: () => void;
  readonly label: string;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={!shut}
    aria-label={`${shut ? 'Expand' : 'Collapse'} ${label}`}
    className="collapse-toggle"
  >
    <ChevronDown className="size-4" aria-hidden="true" />
  </button>
);
