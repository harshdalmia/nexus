import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';
import { graphFromDto } from '@/lib/api/mapGraph';
import type { LiveGraph } from '@/lib/api/mapGraph';

/* ------------------------------------------------------------------
   The engine's ego network for one account.

   Only attempted for identifiers the engine could know — a `bank|account`
   node. Demo entity ids ("4521") are left to the bundled network, so the
   graph never blanks out when the frontend is running standalone.
   ------------------------------------------------------------------ */

export interface LiveGraphResult {
  readonly graph: LiveGraph | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const isEngineNode = (id: string): boolean => id.includes('|');

export const useLiveGraph = (nodeId: string, enabled: boolean): LiveGraphResult => {
  const [graph, setGraph] = useState<LiveGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !isEngineNode(nodeId)) {
      setGraph(null);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    api
      .getEntityGraph(nodeId)
      .then((response) => {
        if (!cancelled) {
          setGraph(graphFromDto(response.data));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return;
        }
        setGraph(null);
        setError(cause instanceof ApiError ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nodeId, enabled]);

  return { graph, loading, error };
};
