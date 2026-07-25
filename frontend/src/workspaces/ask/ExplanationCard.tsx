import { Eye, FileWarning, Pin, ScanEye, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Meter, MeterList } from '@/components/primitives/Meter';
import { SeverityTag, Tone } from '@/components/primitives/Severity';
import { SkeletonLines } from '@/components/primitives/Skeleton';
import { useAudit } from '@/store/auditStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import { severityOfLevel } from '@/types/aml';
import type { EscalationAction, Explanation } from '@/types/aml';

export const ExplanationSkeleton = () => (
  <div className="px-5 py-4">
    <div className="flex items-center gap-2 pb-2">
      <Tone kind="model">explainability running</Tone>
      <span className="text-2xs text-faint">
        composing the narrative from rule reasons and SHAP drivers…
      </span>
    </div>
    <SkeletonLines lines={4} label="Generating explanation" />
  </div>
);

interface ExplanationCardProps {
  readonly explanation: Explanation;
  readonly query: string;
}

/* The narrative is the deliverable an examiner reads, so it gets prose
   typography and a measure cap; everything supporting it stays dense. */
export const ExplanationCard = ({ explanation, query }: ExplanationCardProps) => {
  const { subject, level, score, confidence, narrative, evidence, breakdown, modelVersion } = explanation;
  const { pin, notify } = useWorkspaceActions();
  const { activeCaseId } = useWorkspaceState();
  const { record } = useAudit();

  /* Analyst feedback on an explanation is a risk review: it is the moment a human
     accepts or challenges the score, which the trail has to carry. */
  const reviewRisk = (verdict: 'useful' | 'not useful') => {
    record({
      action: 'risk.reviewed',
      detail: `Explanation for ${subject} marked ${verdict} at risk ${String(score)} (${level})`,
      investigation: activeCaseId,
      entity: subject,
      status: verdict === 'useful' ? 'ok' : 'blocked',
      workspace: 'ask',
      metadata: {
        verdict,
        risk: String(score),
        level,
        model: modelVersion,
        query,
      },
    });
  };

  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 px-4 pt-3.5 pb-1.5">
        <Tone kind="model">
          <ScanEye className="size-2.5" aria-hidden="true" />
          analyst-grade explanation
        </Tone>
        <span className="num text-xs2 text-ink">{subject}</span>
        <SeverityTag severity={severityOfLevel(level)}>
          {level} · {score}
        </SeverityTag>
        <span className="ml-auto flex items-baseline gap-2">
          <span className="text-meta text-faint">confidence</span>
          <span className="metric text-metric-lg text-model">
            {typeof confidence === 'number' ? confidence.toFixed(2) : confidence}
          </span>
          <span className="num text-meta text-faint">{modelVersion}</span>
        </span>
      </header>

      {query.length > 0 && (
        <p className="px-5 pt-1 text-label text-muted">
          answering <span className="text-ink">“{query}”</span>
        </p>
      )}

      {/* The backend emits the narrative as newline-separated lines (a headline, a verdict,
          a score line, then indented evidence). HTML collapses newlines, so without
          whitespace-pre-line the whole thing renders as one unreadable run-on block. */}
      <p className="max-w-[72ch] px-5 pt-1.5 pb-5 text-read whitespace-pre-line text-ink">{narrative}</p>

      <div className="hair-t grid gap-0 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="hair-r px-4 py-3.5">
          <p className="eyebrow pb-1.5">evidence · linked to this flag</p>
          <ul className="flex flex-col gap-1">
            {evidence.map((item) => (
              <li key={item} className="group flex items-start gap-2">
                <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 bg-info" />
                <span className="flex-1 text-label leading-relaxed text-muted">{item}</span>
                <button
                  type="button"
                  aria-label="Pin this evidence item"
                  onClick={() => {
                    pin({
                      id: `sp-ev-${item.slice(0, 14)}`,
                      kind: 'rule',
                      label: item,
                      meta: `from query · ${query}`,
                      caseId: activeCaseId,
                    });
                    notify('Pinned to spine', 'Evidence item attached to the case narrative.', 'clear');
                  }}
                  className="mt-0.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-info"
                >
                  <Pin className="size-2.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-4 py-3.5">
          <p className="eyebrow pb-1.5">score composition</p>
          <MeterList>
            {breakdown.map((component) => (
              <Meter
                key={component.label}
                label={`${component.label} · ${component.weight.toFixed(2)}`}
                value={String(component.value)}
                ratio={component.value}
                tone={component.value >= 75 ? 'severe' : component.value >= 40 ? 'review' : 'clear'}
                labelWidth="9.5rem"
              />
            ))}
          </MeterList>
          <p className="pt-1.5 text-meta leading-relaxed text-faint">
            weights read from <code>configs/risk_weights.yaml</code> · retunable without a model retrain
          </p>
        </div>
      </div>

      <footer className="hair-t mt-auto flex items-center gap-2 px-3 py-1.5">
        <span className="text-meta text-faint">was this explanation useful?</span>
        <button
          type="button"
          aria-label="Explanation was useful"
          onClick={() => {
            notify('Feedback recorded', 'Marked useful — reinforces the current weighting.', 'clear');
            reviewRisk('useful');
          }}
          className="grid size-5 place-items-center border border-line text-faint transition-colors hover:border-ok-line hover:text-ok"
        >
          <ThumbsUp className="size-2.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Explanation was not useful"
          onClick={() => {
            notify('Feedback recorded', 'Flagged for retraining review with the case attached.', 'review');
            reviewRisk('not useful');
          }}
          className="grid size-5 place-items-center border border-line text-faint transition-colors hover:border-sev-line hover:text-sev"
        >
          <ThumbsDown className="size-2.5" aria-hidden="true" />
        </button>
        <span className="ml-auto text-meta text-faint">
          feedback is logged against the case and model version, never applied silently
        </span>
      </footer>
    </article>
  );
};

const actionMeta: Record<
  EscalationAction,
  { readonly icon: LucideIcon; readonly label: string; readonly className: string }
> = {
  report: { icon: FileWarning, label: 'report', className: 'border-l-sev bg-sev-bg/40 text-sev' },
  review: { icon: TriangleAlert, label: 'review', className: 'border-l-rev bg-rev-bg/40 text-rev' },
  monitor: { icon: Eye, label: 'monitor', className: 'border-l-ok bg-ok-bg/40 text-ok' },
};

/* the three escalation bands the policy allows, always shown together so the
   chosen one is visibly a decision between alternatives */
const ladder: ReadonlyArray<{
  readonly action: EscalationAction;
  readonly band: string;
  readonly reason: string;
}> = [
  {
    action: 'monitor',
    band: 'score 0–39',
    reason: 'Single weak signal or none. Keep under automated watch, no analyst time.',
  },
  {
    action: 'review',
    band: 'score 40–74',
    reason: 'One corroborating signal. Human triage inside five business days.',
  },
  {
    action: 'report',
    band: 'score 75–100',
    reason: 'Independent rule and model evidence concur. File a SAR inside the regulatory clock.',
  },
];

export const RecommendationCard = ({ explanation }: { readonly explanation: Explanation }) => {
  const { recommendation } = explanation;
  const { icon: ActionIcon, label, className } = actionMeta[recommendation.action];
  const { navigate, notify } = useWorkspaceActions();
  const { activeCaseId } = useWorkspaceState();

  return (
    <div className={`flex flex-wrap items-start gap-3 border-l-2 px-5 py-4 ${className}`}>
      <ActionIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-[18rem] flex-1">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="display text-card tracking-wide uppercase">{label}</span>
          <span className="text-dense text-ink">{recommendation.headline}</span>
        </p>
        <p className="max-w-[84ch] pt-1 text-label leading-relaxed text-muted">{recommendation.detail}</p>
        <p className="num pt-1 text-meta text-faint">{recommendation.sla}</p>

        {/* the full escalation ladder, with the chosen band called out */}
        <ol className="flex flex-wrap gap-1.5 pt-3" aria-label="Escalation ladder">
          {ladder.map((rung) => {
            const chosen = rung.action === recommendation.action;
            const RungIcon = actionMeta[rung.action].icon;

            return (
              <li
                key={rung.action}
                className={`flex min-w-[13rem] flex-1 items-start gap-2 rounded-[2px] border px-2.5 py-2 ${
                  chosen
                    ? `${actionMeta[rung.action].className} border-current/40`
                    : 'border-line bg-panel/60 text-faint'
                }`}
              >
                <RungIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-label font-semibold tracking-wide uppercase">{rung.action}</span>
                    <span className="num text-meta opacity-80">{rung.band}</span>
                    {chosen && <span className="text-meta font-medium">← selected</span>}
                  </span>
                  <span className="block max-w-[52ch] pt-0.5 text-meta leading-relaxed">
                    {chosen ? recommendation.detail : rung.reason}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant="quiet"
          onClick={() => {
            navigate('cases');
            notify('Case opened', `${activeCaseId} loaded with this finding attached.`, 'info');
          }}
        >
          open case
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            navigate('reports');
            notify('SAR draft ready', 'Narrative composed from the pinned evidence spine.', 'review');
          }}
        >
          draft SAR
        </Button>
      </div>
    </div>
  );
};
