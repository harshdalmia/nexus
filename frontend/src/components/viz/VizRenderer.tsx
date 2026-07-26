import { BarChart, HBarChart, StackedBarChart, WaterfallChart } from '@/components/viz/BarCharts';
import { ChartFrame } from '@/components/viz/ChartFrame';
import { Heatmap } from '@/components/viz/Heatmap';
import { AreaChart, LineChart } from '@/components/viz/LineCharts';
import { DonutChart, GaugeChart, PieChart } from '@/components/viz/RadialCharts';
import { SankeyChart } from '@/components/viz/Sankey';
import { CorridorChart, ScatterChart, TreemapChart } from '@/components/viz/ScatterTreemap';
import type { ChartSpec } from '@/types/aml';

/* Visualization metadata in, component out. Adding a chart kind to the
   backend contract means adding one case here — no screen changes. */
export const VizRenderer = ({
  spec,
  onScope,
}: {
  readonly spec: ChartSpec;
  readonly onScope?: (label: string) => void;
}) => {
  switch (spec.kind) {
    case 'bars':
      return <BarChart spec={spec} />;
    case 'stacked':
      return <StackedBarChart spec={spec} />;
    case 'hbars':
      return <HBarChart spec={spec} />;
    case 'waterfall':
      return <WaterfallChart spec={spec} />;
    case 'line':
      return <LineChart spec={spec} />;
    case 'area':
      return <AreaChart spec={spec} />;
    case 'pie':
      return <PieChart spec={spec} />;
    case 'donut':
      return <DonutChart spec={spec} />;
    case 'gauge':
      return <GaugeChart spec={spec} />;
    case 'sankey':
      return <SankeyChart spec={spec} />;
    case 'scatter':
      return <ScatterChart spec={spec} />;
    case 'treemap':
      return <TreemapChart spec={spec} />;
    case 'corridor':
      return <CorridorChart spec={spec} />;
    case 'heatmap':
      return (
        <ChartFrame subtitle={spec.subtitle} footnote={spec.footnote} minHeight={0}>
          <Heatmap
            rows={spec.heatRows ?? []}
            columns={spec.heatColumns ?? []}
            rowLabel="jurisdiction"
            onCellSelect={(row, column) => onScope?.(`${row} · ${column}`)}
          />
        </ChartFrame>
      );
    default:
      return null;
  }
};
