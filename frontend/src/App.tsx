import { CommandBar } from '@/components/chrome/CommandBar';
import { CommandPalette } from '@/components/chrome/CommandPalette';
import { NavRail } from '@/components/chrome/NavRail';
import { ShortcutsOverlay } from '@/components/chrome/ShortcutsOverlay';
import { StatusStrip } from '@/components/chrome/StatusStrip';
import { ToastStack } from '@/components/chrome/ToastStack';
import { useHotkeys } from '@/hooks/useHotkeys';
import { AgentProvider } from '@/store/agentStore';
import { AuditProvider } from '@/store/auditStore';
import { CaseProvider } from '@/store/caseStore';
import { DataSourceProvider } from '@/store/dataSourceStore';
import { WorkspaceProvider, useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import { AskWorkspace } from '@/workspaces/ask/AskWorkspace';
import { AuditWorkspace } from '@/workspaces/audit/AuditWorkspace';
import { CasesWorkspace } from '@/workspaces/cases/CasesWorkspace';
import { GraphWorkspace } from '@/workspaces/graph/GraphWorkspace';
import { LedgerWorkspace } from '@/workspaces/ledger/LedgerWorkspace';
import { ModelsWorkspace } from '@/workspaces/models/ModelsWorkspace';
import { ReportsWorkspace } from '@/workspaces/reports/ReportsWorkspace';
import { WatchtowerWorkspace } from '@/workspaces/watchtower/WatchtowerWorkspace';

const Workspace = () => {
  const { workspace } = useWorkspaceState();

  switch (workspace) {
    case 'watchtower':
      return <WatchtowerWorkspace />;
    case 'ask':
      return <AskWorkspace />;
    case 'cases':
      return <CasesWorkspace />;
    case 'graph':
      return <GraphWorkspace />;
    case 'ledger':
      return <LedgerWorkspace />;
    case 'models':
      return <ModelsWorkspace />;
    case 'reports':
      return <ReportsWorkspace />;
    case 'audit':
      return <AuditWorkspace />;
    default:
      return null;
  }
};

const Shell = () => {
  const { workspace, paletteOpen, shortcutsOpen, activeCaseId } = useWorkspaceState();
  const {
    navigate,
    setPalette,
    setShortcuts,
    toggleRail,
    toggleInspector,
    toggleDensity,
    notify,
    pin,
  } = useWorkspaceActions();

  useHotkeys({
    meta: {
      k: () => setPalette(!paletteOpen),
    },
    keys: {
      escape: () => {
        setPalette(false);
        setShortcuts(false);
      },
      '?': () => setShortcuts(!shortcutsOpen),
      '[': toggleRail,
      ']': toggleInspector,
      e: () => {
        if (workspace === 'cases' || workspace === 'watchtower') {
          notify('Escalated', `${activeCaseId} escalated to L3 with the current evidence spine.`, 'severe');
        }
      },
      d: () => {
        if (workspace === 'cases' || workspace === 'watchtower') {
          notify('Disposition recorded', `${activeCaseId} dismissed — reason logged to the audit trail.`, 'info');
        }
      },
      p: () => {
        pin({
          id: `sp-quick-${activeCaseId}`,
          kind: 'note',
          label: `Marked for follow-up while in ${workspace}`,
          meta: `analyst bookmark · ${activeCaseId}`,
          caseId: activeCaseId,
        });
        notify('Pinned to spine', `Bookmark added to ${activeCaseId}.`, 'clear');
      },
      z: toggleDensity,
    },
    sequences: {
      'g w': () => navigate('watchtower'),
      'g a': () => navigate('ask'),
      'g c': () => navigate('cases'),
      'g g': () => navigate('graph'),
      'g l': () => navigate('ledger'),
      'g m': () => navigate('models'),
      'g r': () => navigate('reports'),
      'g u': () => navigate('audit'),
    },
  });

  return (
    /* `dvh` rather than `vh`: on mobile browsers `100vh` is the viewport with the
       URL bar retracted, so a `vh`-sized shell puts the status strip under the
       browser chrome until you scroll. */
    <div className="flex h-[100dvh] w-full overflow-hidden bg-canvas">
      <a
        href="#workspace"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-60 focus:border focus:border-info-line focus:bg-panel focus:px-2 focus:py-1 focus:text-xs2 focus:text-info"
      >
        Skip to workspace
      </a>

      <NavRail />

      <div className="flex min-w-0 flex-1 flex-col">
        <CommandBar />
        {/* `key` restarts the entrance animation on every workspace change, so a
            switch reads as a new surface arriving rather than a repaint. */}
        <main
          id="workspace"
          key={workspace}
          className="anim-fade-up flex min-h-0 flex-1 flex-col"
          aria-label={workspace}
        >
          <Workspace />
        </main>
        <StatusStrip />
      </div>

      <CommandPalette />
      <ShortcutsOverlay />
      <ToastStack />
    </div>
  );
};

export const App = () => (
  <WorkspaceProvider>
    {/* Outermost of the data providers: every panel and the agent itself ask it
        whether to render engine numbers, bundled ones, or neither yet. */}
    <DataSourceProvider>
      {/* Audit and cases sit above the agent so a completed run can record itself
          into both as it happens. */}
      <AuditProvider>
        <CaseProvider>
          <AgentProvider>
            <Shell />
          </AgentProvider>
        </CaseProvider>
      </AuditProvider>
    </DataSourceProvider>
  </WorkspaceProvider>
);
