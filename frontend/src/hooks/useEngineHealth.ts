import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';
import type { HealthDto } from '@/lib/api/types';

/* ------------------------------------------------------------------
   Engine health, polled.

   The dataset takes ~30-60s to load, so the API answers /health
   immediately with status "warming". Polling keeps the status strip
   honest about whether the numbers on screen can come from the engine
   yet, and stops once the engine is ready.
   ------------------------------------------------------------------ */

const POLL_WARMING_MS = 4_000;
const POLL_OFFLINE_MS = 15_000;

export type EngineState = 'unknown' | 'warming' | 'ready' | 'error' | 'offline';

export interface EngineHealth {
  readonly state: EngineState;
  readonly health: HealthDto | null;
  readonly error: string | null;
}

/**
 * @param enabled Set false to skip probing entirely — used when the app is
 * running in explicit demo mode, where there is no engine to ask and a poll
 * would only produce a console full of failed requests. The state then stays
 * `unknown`, and the caller is expected to have already decided on demo data.
 */
export const useEngineHealth = (enabled = true): EngineHealth => {
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [state, setState] = useState<EngineState>('unknown');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const controller = new AbortController();
    let timer: number | undefined;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const response = await api.getHealth(controller.signal);

        if (cancelled) {
          return;
        }

        setHealth(response.data);
        setError(response.data.error);
        setState(response.data.status === 'ready' ? 'ready' : response.data.status);

        /* Ready is terminal: no reason to keep polling a loaded engine. */
        if (response.data.status !== 'ready') {
          timer = window.setTimeout(() => void poll(), POLL_WARMING_MS);
        }
      } catch (cause) {
        if (cancelled) {
          return;
        }

        const offline = cause instanceof ApiError && (cause.isOffline || cause.code === 'TIMEOUT');
        setState(offline ? 'offline' : 'error');
        setError(cause instanceof ApiError ? cause.message : String(cause));
        timer = window.setTimeout(() => void poll(), POLL_OFFLINE_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      controller.abort();

      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [enabled]);

  return { state, health, error };
};
