import dagre from '@dagrejs/dagre';
import { graphEdges, graphNodes } from '@/data/graph';
import type { EdgeKind, EntityKind, GraphEdge, GraphNode, Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Layout and simplification for the entity graph.

   Pure functions: dagre produces a left-to-right layered layout so money
   reads placement → consolidation → layering, which is how an analyst
   describes the ring out loud. Clustering keeps dense investigations
   readable without hiding exposure.
   ------------------------------------------------------------------ */

/** above this many visible entities, peripheral nodes collapse per type */
export const CLUSTER_THRESHOLD = 40;

export const NODE_W = 232;
export const NODE_H = 84;

export interface FlowEntity {
  readonly id: string;
  readonly label: string;
  readonly kind: EntityKind;
  readonly role: string;
  readonly severity: Severity;
  readonly centrality: number;
  readonly hop: 1 | 2;
  readonly facts: ReadonlyArray<readonly [string, string]>;
  readonly isCluster: boolean;
  readonly memberIds: readonly string[];
}

export interface FlowRelation {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
  readonly label: string;
  readonly hop: 1 | 2;
}

export interface FlowModel {
  readonly entities: readonly FlowEntity[];
  readonly relations: readonly FlowRelation[];
  readonly positions: Map<string, { x: number; y: number }>;
  readonly neighbours: Map<string, Set<string>>;
  readonly clusteredCount: number;
}

const severityRank: Record<Severity, number> = { severe: 3, review: 2, clear: 1 };

const clusterNoun: Record<EntityKind, string> = {
  person: 'individuals',
  company: 'companies',
  account: 'accounts',
  offshore: 'offshore accounts',
  device: 'devices',
  branch: 'branches',
  wallet: 'wallets',
};

const toEntity = (node: GraphNode): FlowEntity => ({
  id: node.id,
  label: node.label,
  kind: node.kind,
  role: node.role,
  severity: node.severity,
  centrality: node.centrality,
  hop: node.hop,
  facts: node.facts,
  isCluster: false,
  memberIds: [node.id],
});

const toRelation = (edge: GraphEdge): FlowRelation => ({
  id: edge.id,
  source: edge.from,
  target: edge.to,
  kind: edge.kind,
  label: edge.label,
  hop: edge.hop,
});

/** dagre layered layout, left to right */
const layout = (
  entities: readonly FlowEntity[],
  relations: readonly FlowRelation[],
): Map<string, { x: number; y: number }> => {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: 26, ranksep: 96, marginx: 24, marginy: 24, ranker: 'tight-tree' });
  graph.setDefaultEdgeLabel(() => ({}));

  entities.forEach((entity) => {
    graph.setNode(entity.id, { width: NODE_W, height: NODE_H });
  });

  relations.forEach((relation) => {
    if (graph.hasNode(relation.source) && graph.hasNode(relation.target)) {
      graph.setEdge(relation.source, relation.target, { weight: relation.kind === 'large-transfer' ? 3 : 1 }, relation.id);
    }
  });

  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();

  entities.forEach((entity) => {
    const placed = graph.node(entity.id) as { x: number; y: number } | undefined;

    positions.set(
      entity.id,
      placed === undefined
        ? { x: 0, y: 0 }
        : { x: Math.round(placed.x - NODE_W / 2), y: Math.round(placed.y - NODE_H / 2) },
    );
  });

  return positions;
};

interface BuildOptions {
  readonly expanded: boolean;
  /** entity kinds the analyst has hidden */
  readonly hiddenKinds: readonly EntityKind[];
  /** cluster ids the analyst has unfolded */
  readonly unfolded: readonly string[];
  /** live network from the engine; falls back to the bundled network when absent */
  readonly nodes?: readonly GraphNode[];
  readonly edges?: readonly GraphEdge[];
}

export const buildFlowModel = ({
  expanded,
  hiddenKinds,
  unfolded,
  nodes = graphNodes,
  edges = graphEdges,
}: BuildOptions): FlowModel => {
  const visible = nodes.filter(
    (node) => (expanded || node.hop === 1) && !hiddenKinds.includes(node.kind),
  );
  const visibleIds = new Set(visible.map((node) => node.id));
  const scopedEdges = edges.filter(
    (edge) => (expanded || edge.hop === 1) && visibleIds.has(edge.from) && visibleIds.has(edge.to),
  );

  let entities: FlowEntity[] = visible.map(toEntity);
  let relations: FlowRelation[] = scopedEdges.map(toRelation);
  let clusteredCount = 0;

  if (entities.length > CLUSTER_THRESHOLD) {
    const core = new Set(
      visible
        .filter((node) => node.hop === 1 || node.centrality >= 0.3)
        .map((node) => node.id),
    );
    const groups = new Map<EntityKind, typeof visible>();

    visible
      .filter((node) => !core.has(node.id))
      .forEach((node) => {
        const bucket = groups.get(node.kind) ?? [];
        groups.set(node.kind, [...bucket, node]);
      });

    const memberToProxy = new Map<string, string>();
    const proxies: FlowEntity[] = [];

    groups.forEach((members, kind) => {
      const proxyId = `cluster:${kind}`;

      if (unfolded.includes(proxyId)) {
        return;
      }

      const worst = members.reduce<Severity>(
        (acc, member) => (severityRank[member.severity] > severityRank[acc] ? member.severity : acc),
        'clear',
      );

      members.forEach((member) => memberToProxy.set(member.id, proxyId));
      clusteredCount += members.length;

      proxies.push({
        id: proxyId,
        label: `${String(members.length)} ${clusterNoun[kind]}`,
        kind,
        role: `cluster · ${String(members.length)} peripheral ${clusterNoun[kind]}`,
        severity: worst,
        centrality: Math.min(0.6, 0.2 + members.length * 0.03),
        hop: 2,
        facts: [
          ['members', members.map((member) => member.label).slice(0, 6).join(' · ')],
          ['worst severity', worst],
          ['action', 'click to unfold'],
        ],
        isCluster: true,
        memberIds: members.map((member) => member.id),
      });
    });

    entities = [
      ...entities.filter((entity) => !memberToProxy.has(entity.id)),
      ...proxies,
    ];

    const seen = new Set<string>();
    relations = relations.reduce<FlowRelation[]>((acc, relation) => {
      const source = memberToProxy.get(relation.source) ?? relation.source;
      const target = memberToProxy.get(relation.target) ?? relation.target;

      if (source === target) {
        return acc;
      }

      const key = `${source}→${target}→${relation.kind}`;

      if (seen.has(key)) {
        return acc;
      }

      seen.add(key);

      return [...acc, { ...relation, source, target }];
    }, []);
  }

  const entityIds = new Set(entities.map((entity) => entity.id));
  relations = relations.filter(
    (relation) => entityIds.has(relation.source) && entityIds.has(relation.target),
  );

  const neighbours = new Map<string, Set<string>>();
  entities.forEach((entity) => neighbours.set(entity.id, new Set([entity.id])));
  relations.forEach((relation) => {
    neighbours.get(relation.source)?.add(relation.target);
    neighbours.get(relation.target)?.add(relation.source);
  });

  return {
    entities,
    relations,
    positions: layout(entities, relations),
    neighbours,
    clusteredCount,
  };
};

export const matchesQuery = (entity: FlowEntity, query: string): boolean => {
  if (query.trim().length === 0) {
    return true;
  }

  const needle = query.trim().toLowerCase();

  return (
    entity.id.toLowerCase().includes(needle) ||
    entity.label.toLowerCase().includes(needle) ||
    entity.role.toLowerCase().includes(needle) ||
    entity.facts.some(([label, value]) => `${label} ${value}`.toLowerCase().includes(needle))
  );
};
