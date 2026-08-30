import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { findScenario } from '@/data/scenarios';
import { ApiError, apiBaseUrl } from '@/lib/api/client';
import { api, scenarioFromRun } from '@/lib/api';
import { useAudit } from '@/store/auditStore';
import { useCases } from '@/store/caseStore';
import { useDataSource } from '@/store/dataSourceStore';
import type { RunPhase, Scenario, StepState } from '@/types/aml';

/* ------------------------------------------------------------------
   The run machine.

   A virtual clock advances at `speed` × real time and every derived
   value — node state, node progress, unlocked dossier sections, live
   risk score, streamed rows — is a pure function of that clock. This
   keeps a 30-second orchestration honest (no fake instant results),
   makes the progressive reveal deterministic, and lets an analyst
   accelerate or replay a run without any of it drifting out of sync.
   ------------------------------------------------------------------ */

const TICK_MS = 90;
const SKIPPED_REVEAL_MS = 320;
const ROW_STREAM_MS = 1200;

export interface ScheduledStep {
  readonly index: number;
  readonly start: number;
  readonly end: number;
}

/** Where the run on screen came from. */
export type RunSource = 'engine' | 'demo';

export interface RunOrigin {
  readonly source: RunSource;
  /** why the demo set was used, when it was */
  readonly fallbackReason: string | null;
  readonly runId: string | null;
}

/* A live run replays on its own reported latencies — no padding, so the elapsed
   clock on screen matches the execution time in the run document. Use the speed
   control to slow a fast run down for reading. */

interface AgentRun {
  readonly phase: RunPhase;
  readonly scenario: Scenario | null;
  readonly query: string;
  readonly startedAt: string | null;
  /** virtual milliseconds since dispatch */
  readonly elapsedMs: number;
  readonly totalMs: number;
  readonly stepStates: readonly StepState[];
  /** 0–1 for the node currently running */
  readonly stepProgress: readonly number[];
  readonly runningIndex: number;
  readonly revealedRows: number;
  readonly unlocked: readonly string[];
  readonly liveRisk: number;
  readonly ranCount: number;
  readonly skippedCount: number;
  readonly failedCount: number;
  /** virtual start/end of every node, so the UI can age a completed node */
  readonly schedule: readonly ScheduledStep[];
  readonly isBusy: boolean;
  readonly stageExpanded: boolean;
  readonly speed: number;
  /** engine vs bundled demo data, and why */
  readonly origin: RunOrigin;
  /** true while the engine is being asked, before the replay starts */
  readonly isDispatching: boolean;
  readonly setSpeed: (speed: number) => void;
  readonly run: (query: string) => void;
  readonly reset: () => void;
  readonly collapseStage: () => void;
  readonly expandStage: () => void;
}

const DEMO_ORIGIN: RunOrigin = {
  source: 'demo',
  fallbackReason: null,
  runId: null,
};

const AgentContext = createContext<AgentRun | null>(null);

const apiLabel = (): string => apiBaseUrl.replace(/^https?:\/\//, '');

const clockLabel = (): string =>
  new Date().toLocaleTimeString('en-GB', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const buildSchedule = (scenario: Scenario): readonly ScheduledStep[] => {
  let cursor = 0;

  return scenario.steps.map((step, index) => {
    const span = step.status === 'skipped' ? SKIPPED_REVEAL_MS : step.durationMs;
    const scheduled = { index, start: cursor, end: cursor + span };
    cursor += span;

    return scheduled;
  });
};

export const AgentProvider = ({ children }: { readonly children: ReactNode }) => {
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [schedule, setSchedule] = useState<readonly ScheduledStep[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [query, setQuery] = useState('');
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [stageExpanded, setStageExpanded] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [origin, setOrigin] = useState<RunOrigin>(DEMO_ORIGIN);
  const [isDispatching, setDispatching] = useState(false);
  const { record } = useAudit();
  const { upsertFromRun } = useCases();
  /* Read the app-wide verdict rather than discovering it per query: when the
     deployment has already declared itself a demo there is no engine to dial,
     and a 120s timeout per query would be a pointless way to find that out. */
  const { isDemo, reason: demoReason } = useDataSource();

  const speedRef = useRef(speed);
  speedRef.current = speed;
  const timer = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  const totalMs = schedule.length === 0 ? 0 : schedule[schedule.length - 1].end;

  useEffect(() => {
    if (phase !== 'running' || totalMs === 0) {
      return undefined;
    }

    timer.current = window.setInterval(() => {
      setElapsedMs((current) => {
        const next = current + TICK_MS * speedRef.current;

        if (next >= totalMs) {
          return totalMs;
        }

        return next;
      });
    }, TICK_MS);

    return stopTimer;
  }, [phase, totalMs, stopTimer]);

  useEffect(() => {
    if (phase === 'running' && totalMs > 0 && elapsedMs >= totalMs) {
      stopTimer();
      setPhase('complete');
      /* the stage holds for a beat on completion, then hands the screen
         to the dossier and folds itself into the permanent plan rail */
      window.setTimeout(() => setStageExpanded(false), 900);
    }
  }, [phase, elapsedMs, totalMs, stopTimer]);

  /** Hand a scenario to the replay machine, whatever produced it. */
  const start = useCallback(
    (next: Scenario, trimmed: string, nextOrigin: RunOrigin) => {
      stopTimer();
      setScenario(next);
      setSchedule(buildSchedule(next));
      setQuery(trimmed);
      setOrigin(nextOrigin);
      setStartedAt(clockLabel());
      setElapsedMs(0);
      setStageExpanded(true);
      setPhase('running');
    },
    [stopTimer],
  );

  const run = useCallback(
    (rawQuery: string) => {
      const trimmed = rawQuery.trim();

      if (trimmed.length === 0) {
        return;
      }

      record({
        action: 'investigation.started',
        detail: `Dispatched “${trimmed}”`,
        status: 'pending',
        workspace: 'ask',
        metadata: { target: apiLabel() },
      });

      /* Already settled as a demo — a declared demo build, or an engine that has
         been probed and cannot be reached. Replay the bundled scenario straight
         away instead of waiting on a request that is known to fail. */
      if (isDemo) {
        const demo = findScenario(trimmed);
        const reason = demoReason ?? 'no engine available — replaying bundled demo data';

        start(demo, trimmed, { source: 'demo', fallbackReason: reason, runId: null });

        record({
          action: 'investigation.completed',
          detail: `${demo.resultHeadline} (bundled demo data)`,
          investigation: demo.caseId ?? null,
          entity: demo.rows[0]?.entity ?? null,
          workspace: 'ask',
          metadata: { source: 'demo', scenario: demo.id, reason },
        });

        return;
      }

      /* The engine is asked first. It runs the real pipeline, which takes
         seconds, so the console shows a dispatching state until the run
         document arrives — then the replay animates the actual trace.

         If the engine is unreachable, still warming, or rejects the query, the
         bundled demo scenario for that query is replayed instead and the UI
         says so. The product stays usable without a backend. */
      setDispatching(true);

      void api
        .investigate(trimmed)
        .then((response) => {
          const dto = response.data;
          start(scenarioFromRun(dto), trimmed, {
            source: 'engine',
            fallbackReason: null,
            runId: dto.run_id,
          });

          record({
            action: 'investigation.completed',
            detail:
              `${dto.headline} · ${String(dto.execution.selected_tools.length)} tools invoked, ` +
              `${String(dto.execution.skipped_tools.length)} declined`,
            investigation: dto.case_id,
            entity: dto.findings[0]?.node ?? null,
            workspace: 'ask',
            metadata: {
              source: 'engine',
              run_id: dto.run_id,
              risk: String(dto.risk.score),
              tier: dto.risk.tier ?? 'none',
              escalation: dto.recommendation.action ?? 'none',
              duration: `${(dto.execution.execution_time_ms / 1000).toFixed(1)}s`,
            },
          });

          /* The report is assembled by the reporting tool at the end of a run,
             so a completed run is also a generated report. */
          /* A completed run with a finding is a case: it has a subject, a score, an
             escalation and cited evidence. */
          upsertFromRun(dto);

          record({
            action: 'report.generated',
            detail: `Dossier assembled with ${String(dto.sections.length)} sections`,
            investigation: dto.case_id,
            workspace: 'ask',
            metadata: {
              sections: String(dto.sections.length),
              charts: String(dto.charts.filter((dataset) => dataset.available).length),
              findings: String(dto.findings.length),
            },
          });
        })
        .catch((error: unknown) => {
          const reason =
            error instanceof ApiError
              ? error.isOffline
                ? `engine unreachable at ${apiLabel()} — replaying bundled demo data`
                : error.isWarming
                  ? 'engine is still loading its dataset — replaying bundled demo data'
                  : `engine returned ${error.code} — replaying bundled demo data`
              : 'engine call failed — replaying bundled demo data';

          const demo = findScenario(trimmed);
          start(demo, trimmed, { source: 'demo', fallbackReason: reason, runId: null });

          record({
            action: 'investigation.failed',
            detail: `Engine call did not complete — ${reason}`,
            status: 'blocked',
            workspace: 'ask',
            metadata: {
              code: error instanceof ApiError ? error.code : 'UNKNOWN',
              fallback: `demo scenario ${demo.id}`,
            },
          });

          record({
            action: 'investigation.completed',
            detail: `${demo.resultHeadline} (bundled demo data)`,
            investigation: demo.caseId ?? null,
            entity: demo.rows[0]?.entity ?? null,
            workspace: 'ask',
            metadata: { source: 'demo', scenario: demo.id },
          });
        })
        .finally(() => setDispatching(false));
    },
    [start, record, upsertFromRun, isDemo, demoReason],
  );

  const reset = useCallback(() => {
    stopTimer();
    setScenario(null);
    setSchedule([]);
    setElapsedMs(0);
    setPhase('idle');
    setQuery('');
    setStartedAt(null);
    setStageExpanded(false);
    setOrigin(DEMO_ORIGIN);
    setDispatching(false);
  }, [stopTimer]);

  const value = useMemo<AgentRun>(() => {
    if (scenario === null) {
      return {
        phase: 'idle',
        scenario: null,
        query: '',
        startedAt: null,
        elapsedMs: 0,
        totalMs: 0,
        stepStates: [],
        stepProgress: [],
        runningIndex: -1,
        revealedRows: 0,
        unlocked: [],
        liveRisk: 0,
        ranCount: 0,
        skippedCount: 0,
        failedCount: 0,
        schedule: [],
        isBusy: isDispatching,
        stageExpanded: false,
        speed,
        origin,
        isDispatching,
        setSpeed,
        run,
        reset,
        collapseStage: () => setStageExpanded(false),
        expandStage: () => setStageExpanded(true),
      };
    }

    const stepStates: StepState[] = scenario.steps.map((step, index) => {
      const slot = schedule[index];

      if (slot === undefined) {
        return 'queued';
      }

      if (elapsedMs < slot.start) {
        return 'queued';
      }

      if (elapsedMs >= slot.end) {
        switch (step.status) {
          case 'skipped':
            return 'skipped';
          case 'failed':
            return 'failed';
          default:
            return 'done';
        }
      }

      return step.status === 'skipped' ? 'skipped' : 'running';
    });

    const stepProgress = scenario.steps.map((_, index) => {
      const slot = schedule[index];

      if (slot === undefined || stepStates[index] === 'queued') {
        return 0;
      }

      if (stepStates[index] !== 'running') {
        return 1;
      }

      return Math.min(1, Math.max(0, (elapsedMs - slot.start) / Math.max(1, slot.end - slot.start)));
    });

    const runningIndex = stepStates.findIndex((state) => state === 'running');

    const resolved = new Set(
      scenario.steps
        .filter((_, index) => stepStates[index] === 'done' || stepStates[index] === 'failed')
        .map((step) => step.tool),
    );

    const unlocked = scenario.sections
      .filter((sectionItem) => resolved.has(sectionItem.unlockAfter))
      .map((sectionItem) => sectionItem.id);

    /* rows stream out of whichever node resolves them */
    const rowSource = scenario.steps.findIndex(
      (step) =>
        (step.tool === 'detection_engine' || step.tool === 'direct_aggregation') && step.status !== 'skipped',
    );
    const rowSlot = rowSource === -1 ? undefined : schedule[rowSource];
    const revealedRows =
      rowSlot === undefined || elapsedMs < rowSlot.end
        ? 0
        : Math.min(
            scenario.rows.length,
            Math.ceil(((elapsedMs - rowSlot.end) / ROW_STREAM_MS) * scenario.rows.length) || 1,
          );

    /* the headline risk score materialises while the risk engine runs */
    const riskIndex = scenario.steps.findIndex((step) => step.tool === 'risk_engine' && step.status === 'ran');
    const riskSlot = riskIndex === -1 ? undefined : schedule[riskIndex];
    const target = scenario.explanation?.score ?? 0;
    const liveRisk =
      riskSlot === undefined
        ? 0
        : elapsedMs >= riskSlot.end
          ? target
          : elapsedMs <= riskSlot.start
            ? 0
            : Math.round(target * ((elapsedMs - riskSlot.start) / Math.max(1, riskSlot.end - riskSlot.start)));

    return {
      phase,
      scenario,
      query,
      startedAt,
      elapsedMs,
      totalMs,
      stepStates,
      stepProgress,
      runningIndex,
      revealedRows,
      unlocked,
      liveRisk,
      ranCount: stepStates.filter((state) => state === 'done').length,
      skippedCount: stepStates.filter((state) => state === 'skipped').length,
      failedCount: stepStates.filter((state) => state === 'failed').length,
      schedule,
      isBusy: phase === 'running' || isDispatching,
      stageExpanded,
      speed,
      origin,
      isDispatching,
      setSpeed,
      run,
      reset,
      collapseStage: () => setStageExpanded(false),
      expandStage: () => setStageExpanded(true),
    };
  }, [
    scenario, schedule, elapsedMs, phase, query, startedAt, stageExpanded, speed,
    totalMs, origin, isDispatching, run, reset,
  ]);

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
};

export const useAgent = (): AgentRun => {
  const value = useContext(AgentContext);

  if (value === null) {
    throw new Error('useAgent must be used inside AgentProvider');
  }

  return value;
};
