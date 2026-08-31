import { useMemo, useState } from 'react';
import { Focus, Layers2, Pin, Table2 } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Segmented } from '@/components/primitives/Chip';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { ScoreValue, SeverityTag, Tone } from '@/components/primitives/Severity';
import { EntityGraph } from '@/components/viz/EntityGraph';
import { DemoBadge } from '@/components/primitives/DataState';
import { edgeKindLabel, entityKindLabel, graphEdges, graphNodes } from '@/data/graph';
import { useLiveGraph } from '@/hooks/useLiveGraph';
import { useAudit } from '@/store/auditStore';
import { useDataSource } from '@/store/dataSourceStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

type ViewMode = 'graph' | 'table';

/* Every graph has an equivalent table. Force-directed canvases are hostile
   to screen readers and to anyone who needs to sort by degree, so the
   adjacency view is a first-class peer rather than a fallback. */
export const GraphWorkspace = () => {
  const { selectedEntityId, activeCaseId } = useWorkspaceState();
  const { selectEntity, addScope, pin, notify, navigate } = useWorkspaceActions();
  const { record } = useAudit();
  const { isLive } = useDataSource();
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<ViewMode>('graph');
  const [focusNeighbours, setFocusNeighbours] = useState(true);

  /* When the engine is up and the selection is a real account node, the canvas,
     the connection list and the adjacency table all read the engine's own ego
     network. Otherwise every one of them reads the bundled network — they are
     never mixed, so a row and a node always describe the same graph. */
  const { graph, loading, error } = useLiveGraph(selectedEntityId, isLive);

  /* The bundled network is the fallback only when there is no engine to ask.
     With a live engine and a demo-shaped id ("4521" rather than "bank|account")
     there is genuinely nothing to resolve, so the demo topology still stands in —
     but the badge below says which one is on screen either way. */
  const liveGraph = graph !== null;
  const nodes = graph?.nodes ?? graphNodes;
  const edges = graph?.edges ?? graphEdges;

  const node = nodes.find((item) => item.id === selectedEntityId) ?? nodes[Math.min(6, nodes.length - 1)];

  const connections = useMemo(
    () =>
      edges
        .filter((edge) => edge.from === node.id || edge.to === node.id)
        .map((edge) => {
          const otherId = edge.from === node.id ? edge.to : edge.from;
          const direction = edge.from === node.id ? 'out' : 'in';
          const other = nodes.find((item) => item.id === otherId);

          return { edge, other, direction };
        }),
    [node.id, nodes, edges],
  );

  const adjacency = useMemo(
    () =>
      edges.map((edge) => ({
        edge,
        from: nodes.find((item) => item.id === edge.from),
        to: nodes.find((item) => item.id === edge.to),
      })),
    [nodes, edges],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <Panel collapseId="graph.canvas" className="min-h-0 flex-1 border-0">
        <PanelHead
          title="entity canvas"
          meta={
            <span className="flex items-center gap-2">
              <span className="num text-ink">{node.id}</span>
              <span className="truncate">{node.role}</span>
              <Tone kind={liveGraph ? 'info' : 'neutral'}>
                {liveGraph
                  ? `engine · ${String(nodes.length)} entities · ${String(edges.length)} relationships`
                  : expanded
                    ? '10 entities · 2 hops'
                    : '7 entities · 1 hop'}
              </Tone>
              {!liveGraph && <DemoBadge />}
              {loading && <span className="text-meta text-faint">resolving…</span>}
              {error !== null && <span className="text-meta text-rev">{error}</span>}
            </span>
          }
          actions={
            <>
              <Segmented
                label="Graph view mode"
                value={mode}
                onChange={setMode}
                options={[
                  { id: 'graph', label: 'canvas' },
                  { id: 'table', label: 'adjacency' },
                ]}
              />
              <Button size="xs" variant="ghost" onClick={() => setFocusNeighbours((value) => !value)}>
                <Focus className="size-3" aria-hidden="true" />
                {focusNeighbours ? 'showing neighbours' : 'showing all'}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setExpanded((value) => !value)}>
                <Layers2 className="size-3" aria-hidden="true" />
                {expanded ? 'hop 1' : 'hop 2'}
              </Button>
            </>
          }
        />

        {mode === 'graph' ? (
          <EntityGraph
            selectedId={node.id}
            onSelect={(id) => {
              selectEntity(id);
              record({
                action: 'graph.interaction',
                detail: `Node ${id} opened on the entity canvas`,
                entity: id,
                workspace: 'graph',
                metadata: {
                  source: liveGraph ? 'engine' : 'demo',
                  hops: expanded ? '2' : '1',
                  nodes: String(nodes.length),
                },
              });
            }}
            expanded={expanded}
            focusNeighbours={focusNeighbours}
            {...(graph === null ? {} : { nodes: graph.nodes, edges: graph.edges })}
          />
        ) : (
          <div className="scroll min-h-0 flex-1">
            <table className="w-full border-separate border-spacing-0 text-dense">
              <caption className="sr-only">Adjacency list for ring A-114</caption>
              <thead className="sticky top-0">
                <tr>
                  {['from', 'relationship', 'to', 'detail'].map((header) => (
                    <th key={header} scope="col" className="eyebrow border-b border-line bg-panel px-2 py-1 text-left">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adjacency.map(({ edge, from, to }) => (
                  <tr key={edge.id} className="drow">
                    <td className="px-2">
                      <button
                        type="button"
                        onClick={() => selectEntity(edge.from)}
                        className="num text-info hover:underline"
                      >
                        {edge.from}
                      </button>
                      <span className="pl-2 text-meta text-faint">
                        {from === undefined ? '' : entityKindLabel[from.kind]}
                      </span>
                    </td>
                    <td className="px-2 text-muted">{edgeKindLabel[edge.kind]}</td>
                    <td className="px-2">
                      <button
                        type="button"
                        onClick={() => selectEntity(edge.to)}
                        className="num text-info hover:underline"
                      >
                        {edge.to}
                      </button>
                      <span className="pl-2 text-meta text-faint">
                        {to === undefined ? '' : entityKindLabel[to.kind]}
                      </span>
                    </td>
                    <td className="px-2 text-muted">{edge.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel collapseId="graph.inspector" className="hair-l min-h-0 w-full shrink-0 border-0 xl:w-[23rem] 2xl:w-[27rem]">
        <PanelHead title="entity inspector" meta={entityKindLabel[node.kind]} />

        <div className="scroll min-h-0 flex-1">
          <section className="hair-b px-6 py-5">
            <p className="flex items-center gap-2">
              <span className="num text-card font-medium text-ink">{node.id}</span>
              <SeverityTag severity={node.severity} />
              <ScoreValue score={Math.round(node.centrality * 100)} className="ml-auto" />
            </p>
            <p className="pt-1 text-label text-muted">{node.role}</p>
            <div className="flex flex-wrap gap-1.5 pt-2">
              <Button
                size="xs"
                onClick={() => {
                  addScope({ id: 'sc-entity', kind: 'entity', label: node.id });
                  navigate('ledger');
                  notify('Scope committed', `Ledger and analytics now framed on ${node.id}.`, 'info');
                }}
              >
                <Table2 className="size-2.5" aria-hidden="true" />
                scope everything to this entity
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  pin({
                    id: `sp-node-${node.id}`,
                    kind: 'entity',
                    label: `${node.id} · ${node.role}`,
                    meta: `centrality ${node.centrality.toFixed(2)} · ${entityKindLabel[node.kind]}`,
                    caseId: activeCaseId,
                  });
                  notify('Pinned to spine', `${node.id} attached to ${activeCaseId}.`, 'clear');
                }}
              >
                <Pin className="size-2.5" aria-hidden="true" />
                pin
              </Button>
            </div>
          </section>

          <section className="hair-b px-6 py-5">
            <p className="eyebrow pb-2.5">facts</p>
            <dl className="flex flex-col">
              {node.facts.map(([key, value]) => (
                <div key={key} className="flex items-baseline justify-between gap-3 py-[3px]">
                  <dt className="text-label text-faint">{key}</dt>
                  <dd className="num text-right text-label text-muted">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="px-6 py-5">
            <p className="eyebrow pb-2.5">connections · {connections.length}</p>
            <ul className="flex flex-col">
              {connections.map(({ edge, other, direction }) => (
                <li key={edge.id} className="flex items-start gap-2 py-[3px]">
                  <span
                    className={`num mt-px shrink-0 text-meta ${direction === 'out' ? 'text-sev' : 'text-info'}`}
                  >
                    {direction === 'out' ? '→' : '←'}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectEntity(other?.id ?? edge.to)}
                    className="num shrink-0 text-label text-ink hover:underline"
                  >
                    {other?.id ?? edge.to}
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block text-label leading-snug text-muted">{edge.label}</span>
                    <span className="block text-meta text-faint">{edgeKindLabel[edge.kind]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="hair-t px-6 py-4 text-meta leading-relaxed text-faint">
          Centrality from NetworkX betweenness over the 30-day transaction graph. Clicking a node
          re-scopes the ledger, analytics and assistant to that entity.
        </footer>
      </Panel>
    </div>
  );
};
