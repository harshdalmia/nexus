import { Command, Loader2, Menu, Moon, Rows3, Sun, TriangleAlert } from 'lucide-react';
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
  const { setPalette, removeScope, resetScope, toggleTheme, toggleDensity, navigate, setNav } =
    useWorkspaceActions();
  const { isBusy, elapsedMs, ranCount, scenario } = useAgent();
  const entry = navEntry(workspace);
  const totalNodes = scenario?.steps.length ?? 14;

  return (
    /* The investigation bar: title, live run, scope filters and the global
       controls. It is the most-read strip in the product, so it gets real
       height and real gutters instead of admin-dashboard density. */
    <header className="hair-b relative flex h-20 shrink-0 items-center gap-3 bg-panel px-4 shadow-[var(--elev-1)] lg:gap-6 lg:px-7">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-info/45 via-transparent to-transparent"
      />

      {/* Drawer handle. Below lg the rail is off-canvas, so this is the only way
          to reach navigation without the keyboard. */}
      <button
        type="button"
        onClick={() => setNav(true)}
        aria-label="Open navigation"
        className="grid size-10 shrink-0 place-items-center rounded-[2px] border border-rule bg-sunken text-dim shadow-[var(--elev-1)] transition-colors hover:text-ink lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 shrink items-baseline gap-3.5">
        {/* The workspace title is the largest thing in the chrome; at 36px it eats a
            narrow viewport, so it steps down rather than pushing the controls off. */}
        <h1 className="display truncate text-card leading-none tracking-[-0.035em] sm:text-section lg:text-page">
          {entry.title}
        </h1>
        <p className="hidden truncate text-label tracking-tight text-faint 2xl:block">{entry.question}</p>
      </div>

      {isBusy && workspace !== 'ask' && (
        <button
          type="button"
          onClick={() => navigate('ask')}
          className="ctl ctl-primary anim-fade shrink-0 gap-1.5 text-xs2"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          <span className="hidden sm:inline">investigating</span>
          <span className="num hidden md:inline">
            {(elapsedMs / 1000).toFixed(1)}s · {ranCount}/{totalNodes}
          </span>
        </button>
      )}

      {/* Scope rail: the chips here are the most-read controls in the product, so
          they get real horizontal room rather than the minimum. Hidden below md,
          where it would leave no room for the title or the palette; the same chips
          remain editable in the workspace filter bars. Held back to `xl`: between
          lg and xl it shrinks to a truncated "scope" label with no room for a
          single chip, which is worse than not showing it. */}
      <div className="hair-l scroll hidden min-w-0 flex-1 items-center gap-3.5 overflow-x-auto overflow-y-hidden pl-4 xl:flex xl:pl-7">
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

      {/* Pushed right on narrow screens, where the scope rail is not there to do it. */}
      <button
        type="button"
        onClick={() => setPalette(true)}
        className="ctl ml-auto shrink-0 gap-2 text-xs2 xl:ml-0"
        aria-label="Ask or jump to a workspace"
      >
        <Command className="size-4" aria-hidden="true" />
        <span className="hidden text-faint lg:inline">ask or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      <div className="flex shrink-0 items-center gap-2 sm:pl-4 lg:border-l lg:border-line">
        <button
          type="button"
          onClick={() => navigate('watchtower')}
          className="ctl ctl-danger gap-1.5 text-xs2"
          aria-label="2 cases breaching SLA — open Watchtower"
        >
          <TriangleAlert className="size-4" aria-hidden="true" />
          <span className="num hidden sm:inline">2 SLA</span>
        </button>
        {/* Density and theme are preferences, not tasks: they drop out first, and
            stay reachable from the command palette. */}
        <span className="hidden items-center gap-2 xl:flex">
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
        </span>
        <span
          className="ml-1.5 hidden size-9 place-items-center rounded-[2px] border border-rule bg-sunken text-label font-semibold tracking-wider text-dim shadow-[var(--elev-1)] sm:grid"
          title="Harsh R. · AML analyst L2"
        >
          HR
        </span>
      </div>
    </header>
  );
};
