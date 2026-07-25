import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';
import type { CatalogueSummaryDto } from '@/lib/api/types';

/* ------------------------------------------------------------------
   The detection catalogue: hypotheses, weights, screening, artifacts,
   plus this session's measured outcomes.

   One fetch serves the whole Models workspace. The endpoint has no
   engine dependency, so it answers while the dataset is still loading —
   the declared parts of the catalogue are available immediately, and the
   measured parts fill in once runs exist.
   ------------------------------------------------------------------ */

export interface CatalogueResult {
  readonly catalogue: CatalogueSummaryDto | null;
  readonly loading: boolean;
  readonly error: string | null;
}

export const useCatalogue = (runsCompleted: number): CatalogueResult => {
  const [catalogue, setCatalogue] = useState<CatalogueSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* `runsCompleted` is a refetch trigger: a new investigation changes the outcome
     counts, the funnel and the measured contributions. */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    api
      .getCatalogue(controller.signal)
      .then((response) => {
        if (!cancelled) {
          setCatalogue(response.data);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setCatalogue(null);
          setError(cause instanceof ApiError ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [runsCompleted]);

  return { catalogue, loading, error };
};
