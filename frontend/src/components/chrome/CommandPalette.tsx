import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CornerDownLeft, Layers, Search, Sparkles, User } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { navEntries } from '@/components/chrome/navigation';
import { Kbd } from '@/components/primitives/Button';
import { cases } from '@/data/queue';
import { scenarios } from '@/data/scenarios';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import type { WorkspaceId } from '@/types/aml';

type CommandClass = 'ask' | 'jump' | 'act';

interface Command {
  readonly id: string;
  readonly klass: CommandClass;
  readonly label: string;
  readonly meta: string;
  readonly icon: LucideIcon;
  readonly run: () => void;
}

const classLabel: Record<CommandClass, string> = {
  ask: 'ask the agent',
  jump: 'jump to',
  act: 'do',
};

const classTone: Record<CommandClass, string> = {
  ask: 'text-model',
  jump: 'text-info',
  act: 'text-muted',
};

export const CommandPalette = () => {
  const { paletteOpen } = useWorkspaceState();
  const { setPalette, navigate, openCase, requestQuery, selectEntity, addScope, notify } =
    useWorkspaceActions();
  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setValue('');
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [paletteOpen]);

  const commands = useMemo<readonly Command[]>(() => {
    const trimmed = value.trim();
    const freeform: readonly Command[] =
      trimmed.length > 3
        ? [
            {
              id: 'ask-free',
              klass: 'ask',
              label: trimmed,
              meta: 'run through the agent · plan is selected from intent',
              icon: Sparkles,
              run: () => requestQuery(trimmed),
            },
          ]
        : [];

    const sampleQueries: readonly Command[] = scenarios.map((scenario) => ({
      id: `ask-${scenario.id}`,
      klass: 'ask',
      label: scenario.query,
      meta: `${scenario.action} · ${String(scenario.steps.filter((step) => step.status === 'ran').length)} of ${String(scenario.steps.length)} tools`,
      icon: Sparkles,
      run: () => requestQuery(scenario.query),
    }));

    const workspaceJumps: readonly Command[] = navEntries.map((entry) => ({
      id: `nav-${entry.id}`,
      klass: 'jump',
      label: entry.label,
      meta: `workspace · g then ${entry.hotkey}`,
      icon: entry.icon,
      run: () => navigate(entry.id as WorkspaceId),
    }));

    const caseJumps: readonly Command[] = cases.map((record) => ({
      id: `case-${record.id}`,
      klass: 'jump',
      label: `${record.id} · ${record.name}`,
      meta: `case · entity ${record.entity} · score ${String(record.score)}`,
      icon: Layers,
      run: () => openCase(record.id),
    }));

    const entityJumps: readonly Command[] = cases.map((record) => ({
      id: `entity-${record.entity}`,
      klass: 'jump',
      label: `${record.entity} · ${record.name}`,
      meta: 'entity · open in graph',
      icon: User,
      run: () => {
        selectEntity(record.entity);
        addScope({ id: 'sc-entity', kind: 'entity', label: record.entity });
        navigate('graph');
      },
    }));

    const actions: readonly Command[] = [
      {
        id: 'act-sar',
        klass: 'act',
        label: 'Generate SAR draft from evidence spine',
        meta: 'reports · C-114',
        icon: ArrowRight,
        run: () => {
          navigate('reports');
          notify('SAR draft refreshed', 'Narrative rebuilt from the current evidence spine.', 'review');
        },
      },
      {
        id: 'act-export',
        klass: 'act',
        label: 'Export current view to CSV',
        meta: 'ledger · redacts PII columns',
        icon: ArrowRight,
        run: () => notify('Export queued', 'CSV will appear in Reports → artefacts.', 'info'),
      },
      {
        id: 'act-tune',
        klass: 'act',
        label: 'Tune STRUCT_001 threshold',
        meta: 'models · live alert recount',
        icon: ArrowRight,
        run: () => navigate('models'),
      },
    ];

    const pool = [...freeform, ...sampleQueries, ...workspaceJumps, ...caseJumps, ...entityJumps, ...actions];

    if (trimmed.length === 0) {
      return pool.filter((command) => command.klass !== 'ask' || command.id.startsWith('ask-')).slice(0, 12);
    }

    const needle = trimmed.toLowerCase();

    return pool
      .filter(
        (command) =>
          command.id === 'ask-free' ||
          command.label.toLowerCase().includes(needle) ||
          command.meta.toLowerCase().includes(needle),
      )
      .slice(0, 12);
  }, [value, requestQuery, navigate, openCase, selectEntity, addScope, notify]);

  useEffect(() => {
    setCursor(0);
  }, [value]);

  if (!paletteOpen) {
    return null;
  }

  const grouped = (['ask', 'jump', 'act'] as const)
    .map((klass) => ({ klass, items: commands.filter((command) => command.klass === klass) }))
    .filter((group) => group.items.length > 0);

  let runningIndex = -1;

  return (
    <div
      className="anim-fade fixed inset-0 z-50 bg-canvas/70 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => setPalette(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="anim-scale-in overlay-shadow absolute top-[14vh] left-1/2 flex w-[min(680px,92vw)] -translate-x-1/2 flex-col border border-edge bg-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
          <Search className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((current) => Math.min(commands.length - 1, current + 1));
              }

              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((current) => Math.max(0, current - 1));
              }

              if (event.key === 'Enter') {
                event.preventDefault();
                commands[cursor]?.run();
              }

              if (event.key === 'Escape') {
                setPalette(false);
              }
            }}
            placeholder="Ask a question, jump to a case or entity, or run an action…"
            aria-label="Command input"
            className="flex-1 bg-transparent text-read text-ink placeholder:text-faint focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="scroll max-h-[52vh] py-1">
          {grouped.map(({ klass, items }) => (
            <div key={klass} className="pb-1">
              <p className={`eyebrow px-3 py-1 ${classTone[klass]}`}>{classLabel[klass]}</p>
              {items.map((command) => {
                runningIndex += 1;
                const index = runningIndex;
                const Icon = command.icon;
                const isActive = index === cursor;

                return (
                  <button
                    key={command.id}
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={command.run}
                    className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-75 ${
                      isActive ? 'bg-sel' : 'hover:bg-raise'
                    }`}
                  >
                    <Icon className={`size-3.5 shrink-0 ${classTone[command.klass]}`} aria-hidden="true" />
                    <span
                      className={`flex-1 truncate text-dense ${
                        command.klass === 'jump' ? 'font-mono' : ''
                      } text-ink`}
                    >
                      {command.label}
                    </span>
                    <span className="hidden truncate text-2xs text-faint sm:block">{command.meta}</span>
                    {isActive && <CornerDownLeft className="size-3 shrink-0 text-faint" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ))}

          {commands.length === 0 && (
            <p className="px-3 py-6 text-center text-xs2 text-muted">
              Nothing matched. Type a full question and press enter to send it to the agent instead.
            </p>
          )}
        </div>

        <footer className="flex items-center gap-3 border-t border-line px-3 py-1.5 text-meta text-faint">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> run
          </span>
          <span className="ml-auto">
            questions route to the planner · jumps preserve the current scope
          </span>
        </footer>
      </div>
    </div>
  );
};
