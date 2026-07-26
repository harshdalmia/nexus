/* Live entity graph -> the frontend's GraphNode / GraphEdge shapes.

   The backend publishes graph *data* and deliberately no coordinates, so
   positions stay at the origin and dagre lays the graph out client-side
   exactly as it does for the bundled network. */

import type { GraphDto, GraphEdgeDto, GraphNodeDto } from '@/lib/api/types';
import type { EdgeKind, GraphEdge, GraphNode, Severity } from '@/types/aml';

const roleLabel: Record<GraphNodeDto['kind'], string> = {
  hub: 'investigation subject',
  feeder: 'pays into the subject',
  beneficiary: 'receives from the subject',
  account: 'counterparty',
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const toNode = (node: GraphNodeDto, maxDegree: number): GraphNode => {
  const degree = node.in_degree + node.out_degree;

  return {
    id: node.id,
    label: node.label,
    /* AMLworld models bank accounts only — it carries no entity typing, so every
       node is an account rather than a guessed person/company. */
    kind: 'account',
    /* dagre assigns the real position; these satisfy the shared shape. */
    x: 0,
    y: 0,
    hop: node.hop <= 1 ? 1 : 2,
    role: node.role || roleLabel[node.kind],
    /* Node size reads from measured degree share when the engine reports no
       centrality for the node. */
    centrality:
      node.centrality ?? (maxDegree === 0 ? 0 : Number((degree / maxDegree).toFixed(2))),
    severity: (node.severity ?? 'clear') as Severity,
    facts: [
      ...node.facts.map((fact) => [fact.label, fact.value] as const),
      ['inbound value', money.format(node.in_value)] as const,
      ['outbound value', money.format(node.out_value)] as const,
      [
        'risk',
        node.risk === null
          ? 'not scored in this run'
          : `${String(Math.round(node.risk))} / 100`,
      ] as const,
      ...(node.entity_id === null ? [] : [['entity id', node.entity_id] as const]),
    ],
  };
};

const toEdge = (edge: GraphEdgeDto, centre: string): GraphEdge => ({
  id: edge.id,
  from: edge.source,
  to: edge.target,
  kind: edge.kind as EdgeKind,
  label: `${edge.label}${edge.tx_count > 1 ? ` · ${String(edge.tx_count)} txns` : ''}`,
  hop: edge.source === centre || edge.target === centre ? 1 : 2,
});

export interface LiveGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly centre: string;
  readonly truncated: boolean;
  readonly stats: Record<string, number>;
}

export const graphFromDto = (dto: GraphDto): LiveGraph => {
  const maxDegree = dto.nodes.reduce(
    (highest, node) => Math.max(highest, node.in_degree + node.out_degree),
    0,
  );

  return {
    nodes: dto.nodes.map((node) => toNode(node, maxDegree)),
    edges: dto.edges.map((edge) => toEdge(edge, dto.center)),
    centre: dto.center,
    truncated: dto.truncated,
    stats: dto.stats,
  };
};
