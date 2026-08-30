import { useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen, ShieldHalf, X } from 'lucide-react';
import { groupLabels, navEntries } from '@/components/chrome/navigation';
import { Kbd } from '@/components/primitives/Button';
import { savedViews } from '@/data/ledger';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

const badgeTone = {
  severe: 'border-sev-line bg-sev-bg text-sev',
  review: 'border-rev-line bg-rev-bg text-rev',
  model: 'border-model-line bg-model-bg text-model',
} as const;

export const NavRail = () => {
  const { workspace, railCollapsed, navOpen } = useWorkspaceState();
  const { navigate, toggleRail, setNav, addScope, notify } = useWorkspaceActions();
  const isDesktop = useIsDesktop();
  const groups = ['operate', 'analyse', 'govern'] as const;

  /* The icon-only width is a desktop preference. In the drawer the rail is always
     full width, so labels stay — a 272px drawer showing only icons would waste the
     space it just took over the workspace. */
  const showLabels = !isDesktop || !railCollapsed;

  /* Escape closes the drawer, matching the palette and the shortcut sheet. Only
     bound while it is open, so it never competes with the workspace hotkeys. */
  useEffect(() => {
    if (!navOpen) {
      return undefined;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNav(false);
      }
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, setNav]);

  /* Two layouts from one tree.
     lg and up: an in-flow column that the workspace sits beside, width toggled
     by `railCollapsed`.
     Below lg: taken out of flow and slid off-canvas, because 272px of a 390px
     viewport is not navigation, it is the whole screen. The collapsed width is
     ignored there — a drawer that opens half-width would be a worse version of
     both states. */
  return (
    <>
      {/* Scrim. Pointer-events follow visibility so it cannot swallow clicks
          while hidden, and it never mounts a second tree on desktop. */}
      <div
        aria-hidden="true"
        onClick={() => setNav(false)}
        className={`fixed inset-0 z-40 bg-abyss/70 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${
          navOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      />

      <nav
        aria-label="Workspaces"
        aria-hidden={navOpen ? undefined : 'true'}
        data-nav-open={navOpen ? 'true' : undefined}
        className={`hair-r fixed inset-y-0 left-0 z-50 flex w-[272px] shrink-0 flex-col bg-sunken shadow-[var(--elev-3)] transition-transform duration-250 ease-[var(--ease-out-quint)] lg:static lg:z-auto lg:translate-x-0 lg:shadow-none lg:transition-[width] ${
          navOpen ? 'translate-x-0' : '-translate-x-full'
        } ${railCollapsed ? 'lg:w-[74px]' : 'lg:w-[272px]'}`}
      >
        {/* Logo plate — mark only, centred in both rail widths. The product name
            already sits in the command bar and the browser title, so repeating it
            here only competed with the navigation. */}
        <div className="hair-b flex h-20 shrink-0 items-center justify-center gap-2 bg-panel px-4 shadow-[var(--elev-1)]">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-[3px] border border-info-line bg-info-bg shadow-[var(--elev-1)]"
            title="Sentinel — financial intelligence"
          >
            <ShieldHalf className="size-5 text-info" aria-hidden="true" />
            <span className="sr-only">Sentinel — financial intelligence</span>
          </span>
          {/* Dismiss lives in the drawer header on touch, where there is no
              keyboard and the scrim is not an obvious affordance. */}
          <button
            type="button"
            onClick={() => setNav(false)}
            aria-label="Close navigation"
            className="ml-auto grid size-9 place-items-center rounded-[2px] text-faint transition-colors hover:bg-raise hover:text-ink lg:hidden"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

      <div className="scroll flex min-h-0 flex-1 flex-col gap-5 py-4">
        {groups.map((group) => (
          <div key={group} className="nav-group flex flex-col gap-0.5">
            {showLabels && (
              <p className="flex items-center gap-2.5 px-5 pb-2.5">
                <span className="eyebrow">{groupLabels[group]}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-line" />
              </p>
            )}
            {navEntries
              .filter((entry) => entry.group === group)
              .map(({ id, label, icon: Icon, hotkey, badge }) => {
                const isActive = workspace === id;

                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => navigate(id)}
                    aria-current={isActive ? 'page' : undefined}
                    title={showLabels ? undefined : `${label} (g then ${hotkey})`}
                    className={`group relative flex h-13 items-center gap-3.5 pr-4 pl-5 text-body transition-colors duration-150 ${
                      isActive
                        ? 'bg-panel text-ink shadow-[var(--elev-1)]'
                        : 'text-muted hover:bg-panel/60 hover:text-dim'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute inset-y-0 left-0 w-[2px] transition-colors ${
                        isActive ? 'bg-info' : 'bg-transparent group-hover:bg-rule'
                      }`}
                    />
                    <Icon
                      className={`size-4.5 shrink-0 ${isActive ? 'text-info' : 'text-faint group-hover:text-muted'}`}
                      aria-hidden="true"
                    />
                    {showLabels && (
                      <>
                        <span className="flex-1 truncate text-left tracking-tight">{label}</span>
                        {badge !== undefined ? (
                          <span className={`badge ${badgeTone[badge.severity]}`}>{badge.value}</span>
                        ) : (
                          <span className="opacity-0 transition-opacity group-hover:opacity-100">
                            <Kbd>{hotkey}</Kbd>
                          </span>
                        )}
                      </>
                    )}
                  </button>
                );
              })}
          </div>
        ))}

        {showLabels && (
          <div className="nav-group flex flex-col gap-0.5">
            <p className="flex items-center gap-2.5 px-5 pt-1 pb-2.5">
              <span className="eyebrow">saved views</span>
              <span aria-hidden="true" className="h-px flex-1 bg-line" />
            </p>
            {savedViews.map(({ id, label, count, filters }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  addScope({ id: `sc-${id}`, kind: 'pattern', label });
                  navigate('ledger');
                  notify('View applied', `${label} · ${filters.join(' · ')}`, 'info');
                }}
                className="group flex h-11 items-center gap-3 px-5 text-label text-muted transition-colors hover:bg-panel/60 hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-[7px] w-[2px] shrink-0 bg-rule transition-colors group-hover:bg-info"
                />
                <span className="flex-1 truncate text-left tracking-tight">{label}</span>
                <span className="num text-meta text-faint">{count.toLocaleString('en-US')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

        {/* Collapsing is a desktop affordance: the drawer has no narrow state, so
            offering the control there would do nothing visible. */}
        <div
          className={`hair-t hidden shrink-0 items-center gap-2.5 bg-panel px-4 py-3.5 lg:flex ${
            showLabels ? '' : 'justify-center'
          }`}
        >
          <button
            type="button"
            onClick={toggleRail}
            className="grid size-8 place-items-center rounded-[2px] text-faint transition-colors hover:bg-raise hover:text-ink"
            aria-label={railCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {railCollapsed ? (
              <PanelLeftOpen className="size-4.5" aria-hidden="true" />
            ) : (
              <PanelLeftClose className="size-4.5" aria-hidden="true" />
            )}
          </button>
          {showLabels && (
            <span className="flex items-center gap-1 text-meta tracking-wide text-faint uppercase">
              <Kbd>[</Kbd> collapse
            </span>
          )}
        </div>
      </nav>
    </>
  );
};
