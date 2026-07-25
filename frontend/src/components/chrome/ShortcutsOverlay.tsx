import { Kbd } from '@/components/primitives/Button';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

const groups = [
  {
    title: 'navigate',
    items: [
      { keys: ['⌘', 'K'], label: 'command palette — ask or jump' },
      { keys: ['g', 'w'], label: 'watchtower' },
      { keys: ['g', 'a'], label: 'ask' },
      { keys: ['g', 'c'], label: 'cases' },
      { keys: ['g', 'g'], label: 'entity graph' },
      { keys: ['g', 'l'], label: 'ledger' },
      { keys: ['g', 'm'], label: 'models & rules' },
      { keys: ['g', 'r'], label: 'reports' },
      { keys: ['g', 'u'], label: 'audit trail' },
    ],
  },
  {
    title: 'work a list',
    items: [
      { keys: ['j'], label: 'next row' },
      { keys: ['k'], label: 'previous row' },
      { keys: ['space'], label: 'peek inline, keeping context' },
      { keys: ['↵'], label: 'open in the relevant workspace' },
      { keys: ['x'], label: 'select for a bulk action' },
      { keys: ['esc'], label: 'unwind one level' },
    ],
  },
  {
    title: 'investigate',
    items: [
      { keys: ['p'], label: 'pin the active item to the evidence spine' },
      { keys: ['e'], label: 'escalate the active case' },
      { keys: ['d'], label: 'dismiss with a documented reason' },
      { keys: ['/'], label: 'focus the query input' },
    ],
  },
  {
    title: 'layout',
    items: [
      { keys: ['['], label: 'collapse the navigation rail' },
      { keys: [']'], label: 'collapse the context panel' },
      { keys: ['z'], label: 'switch row density' },
      { keys: ['?'], label: 'this list' },
    ],
  },
] as const;

export const ShortcutsOverlay = () => {
  const { shortcutsOpen } = useWorkspaceState();
  const { setShortcuts } = useWorkspaceActions();

  if (!shortcutsOpen) {
    return null;
  }

  return (
    <div
      className="anim-fade fixed inset-0 z-50 grid place-items-center bg-canvas/75 p-6 backdrop-blur-[2px]"
      role="presentation"
      onClick={() => setShortcuts(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="anim-scale-in overlay-shadow w-[min(760px,94vw)] border border-edge bg-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-dense font-semibold">Keyboard map</h2>
          <p className="text-2xs text-faint">
            The whole triage loop is reachable without a mouse. Peek, then commit.
          </p>
          <button
            type="button"
            onClick={() => setShortcuts(false)}
            className="ml-auto text-2xs text-faint hover:text-ink"
          >
            close
          </button>
        </header>

        <div className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.title}>
              <p className="eyebrow pb-1.5">{group.title}</p>
              <ul className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <span className="flex w-16 shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                    <span className="text-xs2 text-muted">{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
