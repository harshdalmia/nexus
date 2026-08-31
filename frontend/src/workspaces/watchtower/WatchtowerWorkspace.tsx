import { useEffect, useState } from 'react';
import { SourceMeta, SourcePending } from '@/components/primitives/DataState';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { Heatmap } from '@/components/viz/Heatmap';
import { VizRenderer } from '@/components/viz/VizRenderer';
import { patternMix } from '@/data/models';
import { exposureHeat, heatWeeks } from '@/data/queue';
import { useDataSource } from '@/store/dataSourceStore';
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
  const { isLive: live, isDemo } = useDataSource();
  const [heat, setHeat] = useState<CorridorHeatDto | null>(null);
  const [distributions, setDistributions] = useState<DistributionsDto | null>(null);

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

  /* Bundled figures are used only when the source is settled as demo. While the
     engine's state is unresolved — or it is live but the fetch is still out —
     the grid holds a placeholder rather than borrowing the demo set. */
  const heatRows = isDemo ? exposureHeat : (heat?.rows ?? []);
  /* Column headers are month-day; the full ISO date does not fit the grid. */
  const heatColumns = isDemo ? heatWeeks : (heat?.columns.map((column) => column.slice(5)) ?? []);
  const rowLabel = heat?.row_label ?? 'jurisdiction';
  const heatReady = isDemo || heat !== null;
  const mixReady = isDemo || distributions !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 flex-1 flex-col">
        <AlertQueue />
        <div className="flex min-h-0 flex-[2] flex-col xl:flex-row">
          <Panel collapseId="watchtower.board" className="hair-r min-h-0 flex-1 border-0">
            <PanelHead
              title="corridor exposure"
              meta={
                <SourceMeta
                  live={`${rowLabel} × day · value share of the busiest cell`}
                  demo="jurisdiction × week"
                />
              }
            />
            <div className="scroll min-h-0 flex-1">
              {heatReady ? (
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
              ) : (
                <SourcePending label="loading corridor exposure from the engine" />
              )}
            </div>
            {heat !== null && (
              <p className="hair-t px-4 py-2 text-meta leading-snug text-faint">{heat.note}</p>
            )}
          </Panel>

          <Panel collapseId="watchtower.context" className="min-h-0 w-full shrink-0 border-0 xl:w-[28rem] 2xl:w-[32rem]">
            <PanelHead
              title={distributions === null ? 'typology mix' : 'amount bands'}
              meta={
                <SourceMeta
                  live="where the dataset’s value actually sits"
                  demo="what the open queue is made of"
                />
              }
            />
            {mixReady ? (
              <VizRenderer spec={distributions === null ? demoMix : bandSpec(distributions)} />
            ) : (
              <SourcePending label="loading amount bands from the engine" />
            )}
          </Panel>
        </div>
      </div>

      <SignalStack />
    </div>
  );
};
