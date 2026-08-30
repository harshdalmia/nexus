import { useState } from 'react';
import { FolderSearch, Maximize2, Minimize2, Network, Pin } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { ScoreValue, SeverityTag, Tone } from '@/components/primitives/Severity';
import { EntityGraph } from '@/components/viz/EntityGraph';
import { useLiveGraph } from '@/hooks/useLiveGraph';
import { caseViews, useCases } from '@/store/caseStore';
import { useDataSource } from '@/store/dataSourceStore';
import { AssistantPanel } from '@/workspaces/cases/AssistantPanel';
import { CaseIndex } from '@/workspaces/cases/CaseIndex';
import { CaseTimeline } from '@/workspaces/cases/CaseTimeline';
import { EvidenceSpine } from '@/workspaces/cases/EvidenceSpine';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

export const CasesWorkspace = () => {
  const { activeCaseId, selectedEntityId } = useWorkspaceState();
  const { selectEntity, pin, notify, navigate } = useWorkspaceActions();
  const { cases: sessionCases } = useCases();
  const { isDemo } = useDataSource();
  const [expanded, setExpanded] = useState(false);

  const records = caseViews(sessionCases, isDemo);
  const record = records.find((item) => item.id === activeCaseId) ?? records[0];
  const subject = record?.session?.entity ?? selectedEntityId;

  /* The canvas reads the engine's own network for the case subject when there is one. */
  const { graph } = useLiveGraph(subject, record?.live ?? false);

  /* Against a live engine the case list starts genuinely empty, and the sample case
     is not shown in its place. Every panel below is a view of one case, so there is
     nothing to render until an investigation produces one. */
  if (record === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <CaseIndex />
        <div className="flex min-h-0 flex-1 flex-col">
          <EmptyState
            icon={<FolderSearch className="size-4" aria-hidden="true" />}
            title="No case open"
            body="A case is what an investigation leaves behind: a subject, a score, an escalation and the evidence that produced them. Ask a question and the run becomes the first case here."
            actions={[{ label: 'Go to Ask', primary: true, onClick: () => navigate('ask') }]}
            hint="Sample cases appear only when the app is running on demo data."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hair-b flex min-h-0 flex-[3] flex-col lg:flex-row">
        <CaseIndex />

        <Panel collapseId="cases.graph" className="min-h-0 flex-1 border-0">
          <PanelHead
            title="money flow"
            meta={
              <span className="flex items-center gap-2">
                <span className="num text-ink">{record.id}</span>
                <span className="truncate text-muted">{record.name}</span>
                <SeverityTag severity={record.severity} />
                <ScoreValue score={record.score} />
                <Tone kind={record.live ? 'info' : 'neutral'}>
                  {graph !== null
                    ? `${String(graph.nodes.length)} entities · ${String(graph.edges.length)} relationships`
                    : record.live
                      ? `${record.pattern} · exposure ${record.exposure}`
                      : 'ring #A-114 · hub centrality 0.81'}
                </Tone>
              </span>
            }
            actions={
              <>
                <Button size="xs" variant="ghost" onClick={() => setExpanded((value) => !value)}>
                  {expanded ? (
                    <Minimize2 className="size-3" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="size-3" aria-hidden="true" />
                  )}
                  {expanded ? 'collapse hop 2' : 'expand 1 hop'}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => {
                    pin({
                      id: 'sp-graph-a114',
                      kind: 'graph',
                      label: 'Ring #A-114 money-flow graph',
                      meta: `${expanded ? '10' : '7'} entities · hub ${selectedEntityId}`,
                      caseId: activeCaseId,
                    });
                    notify('Pinned to spine', 'Graph snapshot attached to the case.', 'clear');
                  }}
                >
                  <Pin className="size-3" aria-hidden="true" />
                  pin graph
                </Button>
                <Button size="xs" onClick={() => navigate('graph')}>
                  <Network className="size-3" aria-hidden="true" />
                  full canvas
                </Button>
              </>
            }
          />
          <EntityGraph
            selectedId={graph === null ? selectedEntityId : subject}
            onSelect={selectEntity}
            expanded={expanded}
            {...(graph === null ? {} : { nodes: graph.nodes, edges: graph.edges })}
          />
          <div className="hair-t flex flex-wrap items-center gap-x-4 gap-y-1 px-6 py-4 text-meta text-faint">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full border border-sev" aria-hidden="true" />
              account / hub
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 border border-rev" aria-hidden="true" />
              company
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rotate-45 border border-sev" aria-hidden="true" />
              offshore
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-4 bg-sev" aria-hidden="true" />
              transfer over $50k
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-4 border-t border-dashed border-model" aria-hidden="true" />
              shared device
            </span>
            <span className="ml-auto">shape encodes entity type · size encodes centrality</span>
          </div>
        </Panel>

        <AssistantPanel />
      </div>

      <div className="flex min-h-0 flex-[2] flex-col xl:flex-row">
        <EvidenceSpine />
        <CaseTimeline />
      </div>
    </div>
  );
};
