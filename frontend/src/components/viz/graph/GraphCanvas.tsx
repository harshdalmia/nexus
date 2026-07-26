import { useCallback, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  Controls,
  MarkerType,
  MiniMap,
  useReactFlow,
} from '@xyflow/react';
import type { Edge, EdgeMouseHandler, NodeMouseHandler } from '@xyflow/react';
import { Crosshair, Eye, EyeOff, Layers, Maximize, Search, X } from 'lucide-react';
import { EntityNode } from '@/components/viz/graph/EntityNode';
import type { EntityFlowNode } from '@/components/viz/graph/EntityNode';
import { NODE_H, NODE_W, buildFlowModel, matchesQuery } from '@/components/viz/graph/flowModel';
import type { FlowEntity } from '@/components/viz/graph/flowModel';
import { edgeKindLabel, entityKindLabel } from '@/data/graph';
import type { EdgeKind, EntityKind, GraphEdge, GraphNode, Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Entity relationship graph.

   Implemented on React Flow rather than a 3D canvas: an AML analyst needs
   to read labels, trace a path and select precisely, and a laid-out 2D
   graph does all three better than an orbiting scene. Zoom, pan, minimap,
   clustering, search, filtering and selection all behave the way analysts
   expect from an investigation tool.
   ------------------------------------------------------------------ */

const nodeTypes = { entity: EntityNode };

const edgeStroke: Record<EdgeKind, string> = {
  'large-transfer': 'var(--r-high)',
  transfer: 'var(--f-slate)',
  'shared-device': 'var(--f-ai)',
  ownership: 'var(--s-edge)',
};

const minimapColor: Record<Severity, string> = {
  severe: 'var(--r-high)',
  review: 'var(--r-med)',
  clear: 'var(--r-safe)',
};

const filterableKinds: readonly EntityKind[] = [
  'person',
  'company',
  'account',
  'offshore',
  'device',
  'branch',
  'wallet',
];

interface EntityGraphProps {
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly expanded: boolean;
  readonly focusNeighbours?: boolean;
  /** hides the toolbar and minimap where the panel is small, e.g. a dossier tile */
  readonly compact?: boolean;
  /** network from the engine; the bundled network is used when omitted */
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
}

const GraphCanvas = ({
  selectedId,
  onSelect,
  expanded,
  focusNeighbours = true,
  compact = false,
  /* aliased: `nodes`/`edges` below are the React Flow arrays this component builds */
  nodes: sourceNodes,
  edges: sourceEdges,
}: EntityGraphProps) => {
  const [query, setQuery] = useState('');
  const [hiddenKinds, setHiddenKinds] = useState<readonly EntityKind[]>([]);
  const [unfolded, setUnfolded] = useState<readonly string[]>([]);
  const [hovered, setHovered] = useState<FlowEntity | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const { fitView, setCenter } = useReactFlow();

  const model = useMemo(
    () =>
      buildFlowModel({
        expanded,
        hiddenKinds,
        unfolded,
        ...(sourceNodes === undefined ? {} : { nodes: sourceNodes }),
        ...(sourceEdges === undefined ? {} : { edges: sourceEdges }),
      }),
    [expanded, hiddenKinds, unfolded, sourceNodes, sourceEdges],
  );

  const live = useMemo(() => {
    if (!focusNeighbours) {
      return new Set(model.entities.map((entity) => entity.id));
    }

    return model.neighbours.get(selectedId) ?? new Set([selectedId]);
  }, [focusNeighbours, model, selectedId]);

  const nodes = useMemo<EntityFlowNode[]>(
    () =>
      model.entities.map((entity) => {
        const position = model.positions.get(entity.id) ?? { x: 0, y: 0 };
        const matched = query.trim().length > 0 && matchesQuery(entity, query);
        const searching = query.trim().length > 0;

        return {
          id: entity.id,
          type: 'entity',
          position,
          draggable: false,
          selectable: true,
          data: {
            entity,
            isSelected: entity.id === selectedId,
            isNeighbour: live.has(entity.id),
            dimmed: searching ? !matched : focusNeighbours && !live.has(entity.id),
            matched,
          },
        };
      }),
    [model, selectedId, live, query, focusNeighbours],
  );

  const edges = useMemo<Edge[]>(
    () =>
      model.relations.map((relation) => {
        const isLive = live.has(relation.source) && live.has(relation.target);
        const dimmed = focusNeighbours && !isLive;
        const isHovered = hoveredEdge === relation.id;
        const stroke = edgeStroke[relation.kind];

        return {
          id: relation.id,
          source: relation.source,
          target: relation.target,
          type: 'smoothstep',
          animated: relation.kind === 'large-transfer' && isLive,
          label: isHovered || (isLive && relation.kind === 'large-transfer') ? relation.label : undefined,
          labelShowBg: true,
          labelBgPadding: [4, 2],
          labelBgBorderRadius: 2,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: dimmed ? 'var(--s-edge)' : stroke,
          },
          style: {
            stroke: dimmed ? 'var(--s-line)' : stroke,
            strokeWidth: relation.kind === 'large-transfer' ? 2 : isHovered ? 1.8 : 1.2,
            strokeDasharray:
              relation.kind === 'shared-device' ? '3 4' : relation.kind === 'ownership' ? '1 5' : undefined,
            opacity: dimmed ? 0.4 : 1,
          },
        };
      }),
    [model, live, focusNeighbours, hoveredEdge],
  );

  const handleNodeClick = useCallback<NodeMouseHandler<EntityFlowNode>>(
    (_, node) => {
      const { entity } = node.data;

      if (entity.isCluster) {
        setUnfolded((current) => [...current, entity.id]);

        return;
      }

      onSelect(entity.id);
    },
    [onSelect],
  );

  const handleEdgeEnter = useCallback<EdgeMouseHandler>((_, edge) => setHoveredEdge(edge.id), []);
  const handleEdgeLeave = useCallback<EdgeMouseHandler>(() => setHoveredEdge(null), []);

  const focusSelected = useCallback(() => {
    const position = model.positions.get(selectedId);

    if (position === undefined) {
      return;
    }

    void setCenter(position.x + NODE_W / 2, position.y + NODE_H / 2, { zoom: 1.15, duration: 520 });
  }, [model, selectedId, setCenter]);

  const toggleKind = (kind: EntityKind) => {
    setHiddenKinds((current) =>
      current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind],
    );
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-canvas">
      <ReactFlow<EntityFlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={(_, node) => setHovered(node.data.entity)}
        onNodeMouseLeave={() => setHovered(null)}
        onEdgeMouseEnter={handleEdgeEnter}
        onEdgeMouseLeave={handleEdgeLeave}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
        fitView
        fitViewOptions={{ padding: 0.22, duration: 420 }}
        minZoom={0.25}
        maxZoom={2.2}
        defaultEdgeOptions={{ type: 'smoothstep' }}
        panOnScroll={false}
        zoomOnDoubleClick={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="color-mix(in oklab, var(--s-rule) 85%, transparent)"
        />
        {!compact && (
          <>
            <Controls
              position="bottom-left"
              showInteractive={false}
              style={{ marginBottom: 10, marginLeft: 10 }}
            />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              maskColor="color-mix(in oklab, var(--s-abyss) 60%, transparent)"
              style={{ width: 148, height: 96, marginBottom: 10, marginRight: 10 }}
              nodeColor={(node) => minimapColor[(node as EntityFlowNode).data.entity.severity]}
              nodeStrokeWidth={0}
              nodeBorderRadius={2}
            />
          </>
        )}
      </ReactFlow>

      {/* ------------------------------- toolbar ------------------------------- */}
      {!compact && (
        <div className="canvas-chrome absolute top-2 left-2 flex items-center gap-1 p-1">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-1.5 size-3 text-faint" aria-hidden="true" />
            <span className="sr-only">Search entities</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="search entities, roles, facts…"
              className="field w-[13.5rem] pl-6 text-label"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1.5 text-faint hover:text-ink"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </label>

          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-rule" />

          <div className="flex items-center gap-0.5" role="group" aria-label="Filter entity types">
            {filterableKinds.map((kind) => {
              const hidden = hiddenKinds.includes(kind);

              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => toggleKind(kind)}
                  title={`${hidden ? 'Show' : 'Hide'} ${entityKindLabel[kind]}`}
                  aria-pressed={!hidden}
                  className={`rounded-[2px] px-1.5 py-0.5 text-meta tracking-wider uppercase transition-colors ${
                    hidden
                      ? 'text-ghost line-through hover:text-faint'
                      : 'bg-raise text-dim hover:text-ink'
                  }`}
                >
                  {kind.slice(0, 4)}
                </button>
              );
            })}
          </div>

          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-rule" />

          <button
            type="button"
            onClick={focusSelected}
            className="ctl ctl-ghost px-1.5 text-meta"
            title="Centre the camera on the selected entity"
          >
            <Crosshair className="size-3" aria-hidden="true" />
            focus
          </button>
          <button
            type="button"
            onClick={() => void fitView({ padding: 0.22, duration: 420 })}
            className="ctl ctl-ghost px-1.5 text-meta"
            title="Fit the whole graph"
          >
            <Maximize className="size-3" aria-hidden="true" />
            fit
          </button>
          {unfolded.length > 0 && (
            <button
              type="button"
              onClick={() => setUnfolded([])}
              className="ctl ctl-ghost px-1.5 text-meta"
              title="Re-cluster peripheral entities"
            >
              <Layers className="size-3" aria-hidden="true" />
              recluster
            </button>
          )}
          {hiddenKinds.length > 0 && (
            <button
              type="button"
              onClick={() => setHiddenKinds([])}
              className="ctl ctl-ghost px-1.5 text-meta"
              title="Show all entity types"
            >
              <Eye className="size-3" aria-hidden="true" />
              all types
            </button>
          )}
        </div>
      )}

      {/* ------------------------------- readouts ------------------------------- */}
      {hovered !== null && (
        <div
          className={`canvas-chrome anim-scale-in pointer-events-none absolute w-[15rem] ${
            compact ? 'top-2 left-2' : 'top-12 left-2'
          }`}
        >
          <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
            <span className="ident text-dense text-ink">{hovered.label}</span>
            <span className="ml-auto truncate text-meta tracking-wider text-faint uppercase">
              {entityKindLabel[hovered.kind]}
            </span>
          </div>
          <p className="px-2 pt-1.5 text-meta text-dim">{hovered.role}</p>
          <dl className="flex flex-col px-2 py-1.5">
            {hovered.facts.slice(0, 5).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-px">
                <dt className="text-meta text-faint">{label}</dt>
                <dd className="num truncate text-meta text-dim">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-line px-2 py-1 text-meta text-faint">
            {hovered.isCluster ? 'click to unfold this cluster' : 'click to re-scope the investigation'}
          </p>
        </div>
      )}

      {!compact && (
        <div className="canvas-chrome absolute top-2 right-2 flex flex-col gap-1 px-2 py-1.5">
          <span className="num flex items-center gap-1.5 text-meta text-faint">
            <Layers className="size-2.5" aria-hidden="true" />
            {model.entities.length} entities · {model.relations.length} relationships
          </span>
          {model.clusteredCount > 0 && (
            <span className="num flex items-center gap-1.5 text-meta text-info">
              {model.clusteredCount} peripheral entities clustered
            </span>
          )}
          {hiddenKinds.length > 0 && (
            <span className="flex items-center gap-1.5 text-meta text-rev">
              <EyeOff className="size-2.5" aria-hidden="true" />
              {hiddenKinds.length} type{hiddenKinds.length > 1 ? 's' : ''} hidden
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
            {(Object.keys(edgeStroke) as EdgeKind[]).map((kind) => (
              <span key={kind} className="flex items-center gap-1 text-meta text-faint">
                <span
                  aria-hidden="true"
                  className="h-px w-3.5"
                  style={{
                    background: edgeStroke[kind],
                    ...(kind === 'shared-device' || kind === 'ownership'
                      ? { borderTop: `1px dashed ${edgeStroke[kind]}`, background: 'transparent' }
                      : {}),
                  }}
                />
                {edgeKindLabel[kind]}
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
};

export const GraphCanvasPanel = (props: EntityGraphProps) => (
  <ReactFlowProvider>
    <GraphCanvas {...props} />
  </ReactFlowProvider>
);

export default GraphCanvasPanel;
