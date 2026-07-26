import { useMemo, useState } from 'react';
import { ChartFrame, severityVar } from '@/components/viz/ChartFrame';
import { money } from '@/lib/format';
import type { ChartSpec } from '@/types/aml';

const W = 720;
const H = 260;
const NODE_W = 12;

/* A deliberately small, deterministic Sankey. Money laundering flows are
   shallow (placement → consolidation → layering), so a four-column layout
   reads better than a general-purpose force layout. */
export const SankeyChart = ({ spec }: { readonly spec: ChartSpec }) => {
  const nodes = spec.sankey?.nodes ?? [];
  const links = spec.sankey?.links ?? [];
  const [hover, setHover] = useState<string | null>(null);

  const layout = useMemo(() => {
    const total = links.reduce((sum, link) => sum + link.value, 0) || 1;
    const columns = [0, 1, 2, 3] as const;
    const positions = new Map<string, { x: number; y: number; h: number }>();

    columns.forEach((column) => {
      const columnNodes = nodes.filter((node) => node.column === column);
      const throughput = columnNodes.map((node) => {
        const inbound = links.filter((link) => link.to === node.id).reduce((sum, link) => sum + link.value, 0);
        const outbound = links.filter((link) => link.from === node.id).reduce((sum, link) => sum + link.value, 0);

        return Math.max(inbound, outbound);
      });
      const columnTotal = throughput.reduce((sum, value) => sum + value, 0) || 1;
      const gap = 14;
      const usable = H - gap * Math.max(0, columnNodes.length - 1);
      let y = 0;

      columnNodes.forEach((node, index) => {
        const h = Math.max(18, (throughput[index] / columnTotal) * usable);
        positions.set(node.id, { x: (column / 3) * (W - NODE_W), y, h });
        y += h + gap;
      });
    });

    /* stack ribbons within each node so they never overlap */
    const outCursor = new Map<string, number>();
    const inCursor = new Map<string, number>();

    const ribbons = links.map((link) => {
      const from = positions.get(link.from);
      const to = positions.get(link.to);

      if (from === undefined || to === undefined) {
        return null;
      }

      const fromOut = links.filter((item) => item.from === link.from).reduce((sum, item) => sum + item.value, 0) || 1;
      const toIn = links.filter((item) => item.to === link.to).reduce((sum, item) => sum + item.value, 0) || 1;
      const thicknessFrom = (link.value / fromOut) * from.h;
      const thicknessTo = (link.value / toIn) * to.h;
      const y0 = from.y + (outCursor.get(link.from) ?? 0);
      const y1 = to.y + (inCursor.get(link.to) ?? 0);
      outCursor.set(link.from, (outCursor.get(link.from) ?? 0) + thicknessFrom);
      inCursor.set(link.to, (inCursor.get(link.to) ?? 0) + thicknessTo);

      const x0 = from.x + NODE_W;
      const x1 = to.x;
      const mid = (x0 + x1) / 2;

      return {
        link,
        share: link.value / total,
        path: [
          `M${x0.toFixed(1)} ${y0.toFixed(1)}`,
          `C${mid.toFixed(1)} ${y0.toFixed(1)}, ${mid.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`,
          `L${x1.toFixed(1)} ${(y1 + thicknessTo).toFixed(1)}`,
          `C${mid.toFixed(1)} ${(y1 + thicknessTo).toFixed(1)}, ${mid.toFixed(1)} ${(y0 + thicknessFrom).toFixed(1)}, ${x0.toFixed(1)} ${(y0 + thicknessFrom).toFixed(1)}`,
          'Z',
        ].join(' '),
      };
    });

    return { positions, ribbons: ribbons.filter((ribbon) => ribbon !== null) };
  }, [nodes, links]);

  return (
    <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={210}>
      <div className="relative min-h-0 flex-1">
        <svg
          viewBox={`0 0 ${String(W)} ${String(H + 26)}`}
          className="h-full w-full"
          role="img"
          aria-label={`${spec.title}. ${links
            .map((link) => `${link.from} to ${link.to} ${money(link.value)}`)
            .join('; ')}`}
        >
          {layout.ribbons.map((ribbon) => {
            const isActive = hover === null || hover === ribbon.link.from || hover === ribbon.link.to;

            return (
              <path
                key={`${ribbon.link.from}-${ribbon.link.to}`}
                d={ribbon.path}
                fill={severityVar[ribbon.link.severity ?? 'review']}
                opacity={isActive ? 0.32 : 0.08}
                className="transition-opacity duration-150"
              />
            );
          })}

          {nodes.map((node) => {
            const position = layout.positions.get(node.id);

            if (position === undefined) {
              return null;
            }

            const tone = severityVar[node.severity ?? 'review'];
            const isEnd = node.column === 3;

            return (
              <g
                key={node.id}
                onMouseEnter={() => setHover(node.id)}
                onMouseLeave={() => setHover(null)}
                className="cursor-default"
              >
                <rect x={position.x} y={position.y} width={NODE_W} height={position.h} fill={tone} rx={1} />
                <text
                  x={isEnd ? position.x - 6 : position.x + NODE_W + 6}
                  y={position.y + position.h / 2 + 3}
                  textAnchor={isEnd ? 'end' : 'start'}
                  className="font-mono text-[13px]"
                  fill={hover === node.id ? 'var(--t-ink)' : 'var(--t-muted)'}
                >
                  {node.label}
                </text>
              </g>
            );
          })}

          {layout.ribbons.map((ribbon) => (
            <text
              key={`label-${ribbon.link.from}-${ribbon.link.to}`}
              x={W / 2}
              y={H + 18}
              className="font-mono text-[12px]"
              fill="var(--t-faint)"
              textAnchor="middle"
              opacity={hover === ribbon.link.from || hover === ribbon.link.to ? 1 : 0}
            >
              {ribbon.link.from} → {ribbon.link.to} · {money(ribbon.link.value)} ·{' '}
              {(ribbon.share * 100).toFixed(1)}% of traced flow
            </text>
          ))}
        </svg>
      </div>
    </ChartFrame>
  );
};
