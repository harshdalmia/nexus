import { PanelLeftClose, PanelLeftOpen, ShieldHalf } from 'lucide-react';
import { groupLabels, navEntries } from '@/components/chrome/navigation';
import { Kbd } from '@/components/primitives/Button';
import { savedViews } from '@/data/ledger';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

const badgeTone = {
  severe: 'border-sev-line bg-sev-bg text-sev',
  review: 'border-rev-line bg-rev-bg text-rev',
  model: 'border-model-line bg-model-bg text-model',
} as const;

export const NavRail = () => {
  const { workspace, railCollapsed } = useWorkspaceState();
  const { navigate, toggleRail, addScope, notify } = useWorkspaceActions();
  const groups = ['operate', 'analyse', 'govern'] as const;

  return (
    <nav
      aria-label="Workspaces"
      className={`hair-r flex shrink-0 flex-col bg-sunken transition-[width] duration-200 ${
        railCollapsed ? 'w-[74px]' : 'w-[272px]'
      }`}
    >
      {/* Logo plate — mark only, centred in both rail widths. The product name
          already sits in the command bar and the browser title, so repeating it
          here only competed with the navigation. */}
      <div className="hair-b flex h-20 items-center justify-center bg-panel px-4 shadow-[var(--elev-1)]">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[3px] border border-info-line bg-info-bg shadow-[var(--elev-1)]"
          title="Sentinel — financial intelligence"
        >
          <ShieldHalf className="size-5 text-info" aria-hidden="true" />
          <span className="sr-only">Sentinel — financial intelligence</span>
        </span>
      </div>

      <div className="scroll flex min-h-0 flex-1 flex-col gap-5 py-4">
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-0.5">
            {!railCollapsed && (
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
                    title={railCollapsed ? `${label} (g then ${hotkey})` : undefined}
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
                    {!railCollapsed && (
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

        {!railCollapsed && (
          <div className="flex flex-col gap-0.5">
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

      <div
        className={`hair-t flex items-center gap-2.5 bg-panel px-4 py-3.5 ${
          railCollapsed ? 'justify-center' : ''
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
        {!railCollapsed && (
          <span className="flex items-center gap-1 text-meta tracking-wide text-faint uppercase">
            <Kbd>[</Kbd> collapse
          </span>
        )}
      </div>
    </nav>
  );
};
