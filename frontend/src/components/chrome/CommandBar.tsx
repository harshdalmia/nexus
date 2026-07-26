import { Command, Loader2, Moon, Rows3, Sun, TriangleAlert } from 'lucide-react';
import { navEntry } from '@/components/chrome/navigation';
import { IconButton, Kbd } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { useAgent } from '@/store/agentStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

const kindPrefix: Record<string, string> = {
  time: 'when',
  entity: 'entity',
  pattern: 'pattern',
  jurisdiction: 'geo',
  case: 'case',
};

export const CommandBar = () => {
  const { workspace, scope, theme, density } = useWorkspaceState();
  const { setPalette, removeScope, resetScope, toggleTheme, toggleDensity, navigate } =
    useWorkspaceActions();
  const { isBusy, elapsedMs, ranCount, scenario } = useAgent();
  const entry = navEntry(workspace);
  const totalNodes = scenario?.steps.length ?? 14;

  return (
    /* The investigation bar: title, live run, scope filters and the global
       controls. It is the most-read strip in the product, so it gets real
       height and real gutters instead of admin-dashboard density. */
    <header className="hair-b relative flex h-20 shrink-0 items-center gap-6 bg-panel px-7 shadow-[var(--elev-1)]">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-info/45 via-transparent to-transparent"
      />
      <div className="flex min-w-0 shrink-0 items-baseline gap-3.5">
        <h1 className="display text-page leading-none tracking-[-0.035em]">{entry.title}</h1>
        <p className="hidden truncate text-label tracking-tight text-faint 2xl:block">{entry.question}</p>
      </div>

      {isBusy && workspace !== 'ask' && (
        <button
          type="button"
          onClick={() => navigate('ask')}
          className="ctl ctl-primary anim-fade shrink-0 gap-1.5 text-xs2"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          investigating
          <span className="num">
            {(elapsedMs / 1000).toFixed(1)}s · {ranCount}/{totalNodes}
          </span>
        </button>
      )}

      {/* Scope rail: the chips here are the most-read controls in the product, so
          they get real horizontal room rather than the minimum. */}
      <div className="hair-l scroll flex min-w-0 flex-1 items-center gap-3.5 overflow-x-auto overflow-y-hidden pl-7">
        <span className="eyebrow shrink-0">scope</span>
        {scope.map((chip) => (
          <Chip
            key={chip.id}
            prefix={kindPrefix[chip.kind]}
            tone={chip.locked === true ? 'locked' : 'neutral'}
            onRemove={chip.locked === true ? undefined : () => removeScope(chip.id)}
          >
            {chip.label}
          </Chip>
        ))}
        {scope.length > 2 && (
          <button
            type="button"
            onClick={resetScope}
            className="shrink-0 text-label text-faint underline decoration-dotted transition-colors hover:text-ink"
          >
            reset
          </button>
        )}
      </div>

      <button type="button" onClick={() => setPalette(true)} className="ctl shrink-0 gap-2 text-xs2">
        <Command className="size-4" aria-hidden="true" />
        <span className="hidden text-faint sm:inline">ask or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="hair-l flex shrink-0 items-center gap-2 pl-4">
        <button
          type="button"
          onClick={() => navigate('watchtower')}
          className="ctl ctl-danger gap-1.5 text-xs2"
          aria-label="2 cases breaching SLA — open Watchtower"
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
          <span className="num">2 SLA</span>
        </button>
        <IconButton
          label={`Density: ${density}`}
          active={density === 'relaxed'}
          onClick={toggleDensity}
        >
          <Rows3 className="size-3.5" aria-hidden="true" />
        </IconButton>
        <IconButton label={`Theme: ${theme}`} onClick={toggleTheme}>
          {theme === 'dark' ? (
            <Sun className="size-3.5" aria-hidden="true" />
          ) : (
            <Moon className="size-3.5" aria-hidden="true" />
          )}
        </IconButton>
        <span
          className="ml-1.5 grid size-9 place-items-center rounded-[2px] border border-rule bg-sunken text-label font-semibold tracking-wider text-dim shadow-[var(--elev-1)]"
          title="Harsh R. · AML analyst L2"
        >
          HR
        </span>
      </div>
    </header>
  );
};
