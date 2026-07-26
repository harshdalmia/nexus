import { Suspense, lazy } from 'react';
import { Loader2 } from 'lucide-react';
import type { GraphEdge, GraphNode } from '@/types/aml';

/* React Flow and the layout engine load on demand: the graph only appears in
   the case workspace, the graph workspace and one dossier tile, so it should
   not sit in the initial bundle. */
const GraphCanvasPanel = lazy(async () => {
  const module = await import('@/components/viz/graph/GraphCanvas');

  return { default: module.GraphCanvasPanel };
});

export interface EntityGraphProps {
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly expanded: boolean;
  readonly focusNeighbours?: boolean;
  readonly compact?: boolean;
  /** live network from the engine; omit to render the bundled network */
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
}

const GraphSkeleton = () => (
  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2.5 bg-canvas">
    <span className="flex items-center gap-2 text-2xs text-faint">
      <Loader2 className="size-3.5 animate-spin text-info" aria-hidden="true" />
      resolving entity network…
    </span>
    <span className="sweep-line h-px w-40 bg-line" />
  </div>
);

export const EntityGraph = (props: EntityGraphProps) => (
  <Suspense fallback={<GraphSkeleton />}>
    <GraphCanvasPanel {...props} />
  </Suspense>
);
