import { useEffect, useState } from 'react';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { Heatmap } from '@/components/viz/Heatmap';
import { VizRenderer } from '@/components/viz/VizRenderer';
import { patternMix } from '@/data/models';
import { exposureHeat, heatWeeks } from '@/data/queue';
import { useEngineHealth } from '@/hooks/useEngineHealth';
import { api } from '@/lib/api';
import type { CorridorHeatDto, DistributionsDto } from '@/lib/api/types';
import { AlertQueue } from '@/workspaces/watchtower/AlertQueue';
import { SignalStack } from '@/workspaces/watchtower/SignalStack';
import { useWorkspaceActions } from '@/store/workspaceStore';
import type { ChartSpec } from '@/types/aml';

/* Fallback mix, used only while the engine is unreachable. */
const demoMix: ChartSpec = {
  kind: 'hbars',
  title: 'Typology mix',
  subtitle: 'open alert population by detected pattern',
  data: patternMix.map((pattern) => ({
    label: pattern.label,
    value: pattern.value,
    severity: pattern.value > 3000 ? 'severe' : pattern.value > 1300 ? 'review' : 'clear',
    note: `${pattern.value.toLocaleString('en-US')} alerts`,
  })),
};

/** Live: how the dataset's transactions distribute across amount bands. */
const bandSpec = (distributions: DistributionsDto): ChartSpec => ({
  kind: 'hbars',
  title: 'Amount bands',
  subtitle: `${distributions.transactions.toLocaleString('en-US')} transactions in the loaded dataset`,
  unit: 'transactions',
  data: distributions.amount_bands.map((band) => ({
    label: band.label,
    value: band.count,
    /* The $9k–$9.99k band is the one the engine's near-threshold rule examines. */
    severity: band.label.includes('$9k') ? 'severe' : band.count > 0 ? 'clear' : undefined,
    note: `${band.count.toLocaleString('en-US')} txns`,
  })),
  footnote: 'the $9k–$9.99k band is what the near-threshold rule counts',
});

export const WatchtowerWorkspace = () => {
  const { addScope, navigate, notify } = useWorkspaceActions();
  const { state } = useEngineHealth();
  const [heat, setHeat] = useState<CorridorHeatDto | null>(null);
  const [distributions, setDistributions] = useState<DistributionsDto | null>(null);

  const live = state === 'ready';

  useEffect(() => {
    if (!live) {
      setHeat(null);
      setDistributions(null);

      return undefined;
    }

    const controller = new AbortController();

    /* Daily columns: the loaded slice spans under three weeks, so a monthly grid
       would collapse to a single column. */
    void Promise.allSettled([
      api.getCorridorHeat({ bucket: 'day', rows: 6, signal: controller.signal }),
      api.getDistributions(controller.signal),
    ]).then(([corridor, spread]) => {
      if (corridor.status === 'fulfilled') {
        setHeat(corridor.value.data);
      }

      if (spread.status === 'fulfilled') {
        setDistributions(spread.value.data);
      }
    });

    return () => controller.abort();
  }, [live]);

  const heatRows = heat === null ? exposureHeat : heat.rows;
  /* Column headers are month-day; the full ISO date does not fit the grid. */
  const heatColumns = heat === null ? heatWeeks : heat.columns.map((column) => column.slice(5));
  const rowLabel = heat?.row_label ?? 'jurisdiction';

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <AlertQueue />
        <div className="flex min-h-0 flex-[2] flex-col xl:flex-row">
          <Panel className="hair-r min-h-0 flex-1 border-0">
            <PanelHead
              title="corridor exposure"
              meta={
                <span className="truncate text-label text-faint">
                  {heat === null
                    ? 'jurisdiction × week · demo data'
                    : `${rowLabel} × day · value share of the busiest cell`}
                </span>
              }
            />
            <div className="scroll min-h-0 flex-1">
              <Heatmap
                rows={heatRows}
                columns={heatColumns}
                rowLabel={rowLabel}
                onCellSelect={(row, column) => {
                  addScope({ id: 'sc-juris-sel', kind: 'jurisdiction', label: `${row} · ${column}` });
                  navigate('ledger');
                  notify('Scope applied', `Ledger filtered to ${row} in ${column}.`, 'info');
                }}
              />
            </div>
            {heat !== null && (
              <p className="hair-t px-4 py-2 text-meta leading-snug text-faint">{heat.note}</p>
            )}
          </Panel>

          <Panel className="min-h-0 w-full shrink-0 border-0 xl:w-[27rem]">
            <PanelHead
              title={distributions === null ? 'typology mix' : 'amount bands'}
              meta={
                <span className="truncate text-label text-faint">
                  {distributions === null
                    ? 'what the open queue is made of'
                    : 'where the dataset’s value actually sits'}
                </span>
              }
            />
            <VizRenderer spec={distributions === null ? demoMix : bandSpec(distributions)} />
          </Panel>
        </div>
      </div>

      <SignalStack />
    </div>
  );
};
