import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';
import type { ReportDto } from '@/lib/api/types';
import { useAgent } from '@/store/agentStore';

/* ------------------------------------------------------------------
   The draft report for the run currently on screen.

   Fetched rather than derived: the backend assembles the paragraphs from
   that run's evidence and renders the downloadable artefacts, so it owns
   both the prose and the byte sizes. The hook's only job is to say which
   of three states we are in — a report, still loading, or a stated reason
   there is none — because the blocks that use it must never fall back to
   a specimen document.
   ------------------------------------------------------------------ */

export interface RunReportResult {
  readonly report: ReportDto | null;
  readonly loading: boolean;
  /** Why there is no report. Always populated when `report` is null and not loading. */
  readonly reason: string;
}

const NO_RUN =
  'No investigation has been run in this session, so there is no evidence to draft a report from.';

export const useRunReport = (): RunReportResult => {
  const { origin } = useAgent();
  const runId = origin.runId;
  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState(NO_RUN);

  /* A demo run has no run_id on the engine, so there is nothing to fetch. Saying that
     is better than quietly showing a fixture report beside demo numbers. */
  const live = origin.source === 'engine' && runId !== null;

  useEffect(() => {
    if (!live || runId === null) {
      setReport(null);
      setReason(
        origin.source === 'engine'
          ? NO_RUN
          : 'This is a demo run, so the engine holds no report for it.',
      );
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);

    api
      .getReport(runId, controller.signal)
      .then((response) => {
        if (cancelled) return;
        if (response.data.available) {
          setReport(response.data);
        } else {
          setReport(null);
          setReason(response.data.reason ?? 'This run flagged nothing, so there is no draft.');
        }
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setReport(null);
        setReason(
          cause instanceof ApiError ? cause.message : 'The report could not be loaded.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [live, runId, origin.source]);

  return { report, loading, reason };
};
