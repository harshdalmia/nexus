import { useState } from 'react';
import { BrainCircuit, Pin, Send, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { Tone } from '@/components/primitives/Severity';
import { DonutConfidence } from '@/components/viz/Charts';
import { riskDeltas } from '@/data/caseFile';
import { signed } from '@/lib/format';
import { caseViews, useCases } from '@/store/caseStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

/* ------------------------------------------------------------------
   What the score is made of, for the case in view.

   On a live case the drivers are the risk engine's own weighted
   components and the claims it cited — no invented deltas, and no
   "recommended next steps": the pipeline publishes no task list, so
   that section is gone rather than fabricated.
   ------------------------------------------------------------------ */

const CONFIDENCE_BANDS: Record<string, number> = {
  strong: 0.9,
  high: 0.9,
  moderate: 0.7,
  medium: 0.7,
  weak: 0.45,
  low: 0.45,
};

export const AssistantPanel = () => {
  const { activeCaseId, inspectorCollapsed } = useWorkspaceState();
  const { pin, notify, requestQuery, toggleInspector } = useWorkspaceActions();
  const { cases } = useCases();
  const [followUp, setFollowUp] = useState('');

  const records = caseViews(cases);
  const record = records.find((item) => item.id === activeCaseId) ?? records[0];
  const session = record.session;

  if (inspectorCollapsed) {
    return (
      <button
        type="button"
        onClick={toggleInspector}
        className="hair-l flex w-8 shrink-0 flex-col items-center gap-2 bg-panel py-3 text-faint transition-colors hover:text-ink"
        aria-label="Show investigation assistant"
      >
        <BrainCircuit className="size-3.5" aria-hidden="true" />
        <span className="text-meta [writing-mode:vertical-rl]">assistant</span>
      </button>
    );
  }

  /* Live: weighted components straight from the risk engine. Demo: the bundled deltas. */
  const drivers = session
    ? session.components
        .filter((component) => component.value > 0)
        .map((component) => ({
          label: component.label,
          points: component.value,
          source: `weight ×${component.weight.toFixed(2)} · risk engine`,
        }))
    : riskDeltas.map((delta) => ({
        label: delta.label,
        points: delta.points,
        source: delta.source,
      }));

  const confidence = session
    ? CONFIDENCE_BANDS[session.confidence.toLowerCase()] ?? 0.6
    : 0.91;

  return (
    <Panel collapseId="cases.assistant" className="hair-l min-h-0 w-full shrink-0 border-0 xl:w-[24rem] 2xl:w-[28rem]">
      <PanelHead
        title="investigation assistant"
        meta={
          <span className="truncate text-label text-faint">
            {session ? `${record.id} · ${session.escalation}` : `${record.id} · demo case`}
          </span>
        }
        actions={
          <button
            type="button"
            onClick={toggleInspector}
            className="text-label text-faint hover:text-ink"
            aria-label="Collapse assistant"
          >
            hide
          </button>
        }
      />

      <div className="scroll min-h-0 flex-1">
        <section className="hair-b px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow pb-2">{session ? 'composite risk' : 'risk moved'}</p>
              <p className="flex items-baseline gap-2">
                <span
                  className={`metric text-hero leading-none ${
                    record.severity === 'severe'
                      ? 'text-sev'
                      : record.severity === 'review'
                        ? 'text-rev'
                        : 'text-ok'
                  }`}
                >
                  {record.score}
                </span>
                <span className="text-label text-faint">/ 100</span>
                {session !== null && (
                  <span className="num text-label text-muted">{session.confidence}</span>
                )}
              </p>
            </div>
            <DonutConfidence value={confidence} />
          </div>

          <ul className="flex flex-col pt-2">
            {drivers.map((driver) => (
              <li key={driver.label} className="group flex items-start gap-2 py-[3px]">
                {driver.points >= 0 ? (
                  <TrendingUp className="mt-0.5 size-3 shrink-0 text-sev" aria-hidden="true" />
                ) : (
                  <TrendingDown className="mt-0.5 size-3 shrink-0 text-ok" aria-hidden="true" />
                )}
                <span className="num w-7 shrink-0 text-label text-ink">
                  {signed(driver.points)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-label leading-snug text-muted">{driver.label}</span>
                  <span className="block text-meta text-faint">{driver.source}</span>
                </span>
                <button
                  type="button"
                  aria-label="Pin this driver to the evidence spine"
                  onClick={() => {
                    pin({
                      id: `sp-delta-${driver.label.slice(0, 14)}`,
                      kind: 'rule',
                      label: driver.label,
                      meta: `${signed(driver.points)} risk points · ${driver.source}`,
                      caseId: activeCaseId,
                    });
                    notify('Pinned to spine', 'Risk driver added to the case narrative.', 'clear');
                  }}
                  className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-info"
                >
                  <Pin className="size-2.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {session !== null && session.evidence.length > 0 && (
          <section className="hair-b px-6 py-5">
            <p className="eyebrow pb-2.5">cited evidence</p>
            <ul className="flex flex-col gap-1.5">
              {session.evidence.slice(0, 6).map((claim) => (
                <li key={claim} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 bg-info" />
                  <span className="text-label leading-relaxed text-muted">{claim}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="px-6 py-5">
          <div className="flex items-center gap-2 pb-1.5">
            <Tone kind="model">
              <BrainCircuit className="size-2.5" aria-hidden="true" />
              reasoning basis
            </Tone>
          </div>
          {/* whitespace-pre-line: the narrative is newline-structured on the wire. */}
          <p className="text-label leading-relaxed whitespace-pre-line text-muted">
            {session
              ? session.narrative ||
                `Conclusion rests on ${String(session.evidenceCount)} evidence records over ` +
                  `${session.transactionCount.toLocaleString('en-US')} transactions, answering ` +
                  `“${session.query}”.`
              : 'Conclusion rests on 4 fired rules, 147 transactions, 7 linked entities and a 0.88 model probability. Two counterparties were excluded by an analyst on 17 Jul and are held out of the aggregate.'}
          </p>
          {session !== null && (
            <p className="num pt-1.5 text-meta text-faint">
              {session.evidenceCount} evidence records · claim validation{' '}
              {session.validated ? 'passed' : 'flagged'} · from run {session.runId.slice(0, 8)}
            </p>
          )}
        </section>
      </div>

      <form
        className="hair-t flex items-center gap-1.5 bg-panel px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();

          if (followUp.trim().length === 0) {
            return;
          }

          requestQuery(followUp);
          setFollowUp('');
        }}
      >
        <input
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          placeholder={
            session ? `Ask about ${session.entity}` : 'Ask about this case — “who else pays in?”'
          }
          aria-label="Ask the assistant about this case"
          className="field flex-1 text-label"
        />
        <Button size="sm" variant="primary" type="submit" disabled={followUp.trim().length === 0}>
          <Send className="size-3" aria-hidden="true" />
        </Button>
      </form>
    </Panel>
  );
};
