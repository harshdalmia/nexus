import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useEngineHealth } from '@/hooks/useEngineHealth';
import type { EngineState } from '@/hooks/useEngineHealth';
import { apiBaseUrl } from '@/lib/api/client';
import type { HealthDto } from '@/lib/api/types';
import { demoSwitch } from '@/lib/demoMode';

/* ------------------------------------------------------------------
   Where the numbers on screen come from — decided once, for the whole app.

   The rule this enforces has one clause per state, and the third clause is
   the one that matters:

     demo     the engine cannot be reached, or the deployment declared itself
              a demo. Bundled data, labelled as such.
     live     the engine answered /health with "ready". Engine data only.
     pending  we do not know yet — the first probe is still in flight, or the
              engine is up but still loading its dataset.

   `pending` is deliberately NOT demo. Showing bundled figures while a healthy
   engine is three seconds from answering is how a demo dataset ends up being
   read as production truth, so panels hold a placeholder instead and swap in
   real numbers when the probe resolves.

   Centralising this also collapses what used to be five independent /health
   pollers (status strip, watchtower, signal stack, ledger, graph) into one.
   ------------------------------------------------------------------ */

export type DataSource = 'live' | 'demo' | 'pending';

export interface DataSourceValue {
  readonly source: DataSource;
  /** Engine data is available and should be the only thing rendered. */
  readonly isLive: boolean;
  /** Bundled demo data is warranted, and must be labelled wherever it shows. */
  readonly isDemo: boolean;
  /** Not yet known. Render a placeholder, not a fallback. */
  readonly isPending: boolean;
  /** Why demo data is showing, phrased for display. Null unless `isDemo`. */
  readonly reason: string | null;
  /** True when demo mode was declared rather than inferred from a failed probe. */
  readonly forced: boolean;
  readonly engineState: EngineState;
  readonly health: HealthDto | null;
  readonly error: string | null;
}

const DataSourceContext = createContext<DataSourceValue | null>(null);

const engineLabel = (): string => apiBaseUrl.replace(/^https?:\/\//, '');

interface Verdict {
  readonly source: DataSource;
  readonly reason: string | null;
}

const verdictFor = (state: EngineState, error: string | null): Verdict => {
  /* A declared demo never touches the network, so the engine state is moot. */
  if (demoSwitch.forced) {
    return { source: 'demo', reason: demoSwitch.reason };
  }

  switch (state) {
    case 'ready':
      return { source: 'live', reason: null };

    case 'offline':
      return {
        source: 'demo',
        reason: `engine unreachable at ${engineLabel()} — showing bundled demo data`,
      };

    case 'error':
      return {
        source: 'demo',
        reason: `engine reported an error${
          error === null ? '' : ` (${error})`
        } — showing bundled demo data`,
      };

    /* Warming: the engine is alive and loading its dataset. Unknown: the first
       probe has not come back. Both are "wait", not "fall back". */
    case 'warming':
    case 'unknown':
    default:
      return { source: 'pending', reason: null };
  }
};

export const DataSourceProvider = ({ children }: { readonly children: ReactNode }) => {
  /* Skip probing altogether when demo mode was declared: there is nothing to
     ask, and the answer would not change the verdict. */
  const { state, health, error } = useEngineHealth(!demoSwitch.forced);

  const value = useMemo<DataSourceValue>(() => {
    const { source, reason } = verdictFor(state, error);

    return {
      source,
      isLive: source === 'live',
      isDemo: source === 'demo',
      isPending: source === 'pending',
      reason,
      forced: demoSwitch.forced,
      engineState: state,
      health,
      error,
    };
  }, [state, health, error]);

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
};

export const useDataSource = (): DataSourceValue => {
  const value = useContext(DataSourceContext);

  if (value === null) {
    throw new Error('useDataSource must be used inside a DataSourceProvider.');
  }

  return value;
};
