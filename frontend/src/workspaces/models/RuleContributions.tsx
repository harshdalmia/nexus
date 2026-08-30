import { Check, CircleSlash, ShieldCheck } from 'lucide-react';
import { Tone } from '@/components/primitives/Severity';
import { ruleContributions } from '@/data/models';
import type { HypothesisRuleDto } from '@/lib/api/types';
import { num, percent } from '@/lib/format';

/* ------------------------------------------------------------------
   The detection logic, read-only.

   Live, each row is a hypothesis from the engine's curated library: the
   evidence families it expects, in which direction, with what
   importance. `fired`/`won` are measured over the investigations this
   process has run. Precision needs labelled outcomes, which no request
   can produce, so it reads "—" rather than a number.
   ------------------------------------------------------------------ */

const precisionTone = (precision: number): string => {
  if (precision >= 0.85) {
    return 'text-ok';
  }

  if (precision >= 0.7) {
    return 'text-rev';
  }

  return 'text-sev';
};

interface Row {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly expression: string;
  readonly pattern: string;
  readonly enabled: boolean;
  readonly count: number;
  readonly countLabel: string;
  readonly share: number | null;
  readonly precision: number | null;
  readonly footnote: string | null;
  readonly suspicious: boolean;
}

const fromLive = (rule: HypothesisRuleDto): Row => ({
  key: `${rule.typology}-${rule.id}`,
  id: rule.id,
  name: rule.label,
  expression: rule.expression,
  pattern: `${rule.typology} · ${rule.kind}`,
  enabled: rule.enabled,
  count: rule.won,
  countLabel: rule.won === 1 ? 'win' : 'wins',
  share: rule.share_of_runs,
  precision: rule.precision,
  footnote:
    rule.fired > 0
      ? `scored in ${String(rule.fired)} run(s) · max fingerprint score ${rule.max_score.toFixed(1)}`
      : `not yet scored in this process · max fingerprint score ${rule.max_score.toFixed(1)}`,
  suspicious: rule.kind === 'suspicious',
});

const fromDemo = (rule: (typeof ruleContributions)[number]): Row => ({
  key: rule.id,
  id: rule.id,
  name: rule.name,
  expression: rule.expression,
  pattern: rule.pattern,
  enabled: rule.enabled,
  count: rule.firedCount,
  countLabel: 'alerts',
  share: rule.shareOfAlerts,
  precision: rule.precision,
  footnote: rule.regulatoryBasis ?? null,
  suspicious: true,
});

export const RuleContributions = ({
  rules,
  allowDemo,
}: {
  /** live catalogue; the bundled rules are used when the engine is unreachable */
  readonly rules?: readonly HypothesisRuleDto[];
  /** true only when there is no engine to fetch the catalogue from */
  readonly allowDemo: boolean;
}) => {
  const live = rules !== undefined && rules.length > 0;
  const rows: readonly Row[] = live
    ? rules.map(fromLive)
    : allowDemo
      ? ruleContributions.map(fromDemo)
      : [];
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  if (rows.length === 0) {
    return (
      <div className="scroll min-h-0 flex-1">
        <p className="px-5 py-6 text-label leading-relaxed text-faint">
          Loading the hypothesis library from the engine. The bundled rule set is shown
          only when there is no engine to read it from.
        </p>
      </div>
    );
  }

  return (
    <div className="scroll min-h-0 flex-1">
      {rows.map((row) => (
        <section key={row.key} className="hair-b px-5 py-2.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <code className="text-body font-semibold text-info">{row.id}</code>
            <span className="text-body-lg text-ink">{row.name}</span>
            <Tone kind={row.suspicious ? 'model' : 'neutral'}>{row.pattern}</Tone>
            {row.enabled ? (
              <span className="flex items-center gap-1 text-meta text-ok">
                <Check className="size-3" aria-hidden="true" />
                active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-meta text-faint">
                <CircleSlash className="size-3" aria-hidden="true" />
                inactive
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
              <span className="metric text-card text-ink">{num(row.count)}</span>
              <span className="text-label text-faint">{row.countLabel}</span>
            </span>
          </div>

          <p className="truncate pt-0.5 font-mono text-meta text-faint" title={row.expression}>
            {row.expression}
          </p>

          <div className="flex items-center gap-3 pt-1.5">
            <span className="relative h-[5px] flex-1 bg-raise">
              <span
                className="anim-grow-w absolute inset-y-0 left-0 bg-info"
                style={{ width: `${String((row.count / maxCount) * 100)}%` }}
              />
            </span>
            <span className="num w-[5rem] shrink-0 text-right text-label text-muted">
              {row.share === null ? '—' : `${percent(row.share, 1)} of ${live ? 'runs' : 'mix'}`}
            </span>
            <span
              className={`num w-[7rem] shrink-0 text-right text-label ${
                row.precision === null ? 'text-ghost' : precisionTone(row.precision)
              }`}
              title={row.precision === null ? 'requires labelled outcomes' : undefined}
            >
              {row.precision === null ? 'precision —' : `precision ${row.precision.toFixed(2)}`}
            </span>
            {row.footnote !== null && (
              <span
                className="flex shrink-0 items-center gap-1 text-meta text-faint"
                title={row.footnote}
              >
                <ShieldCheck className="size-3" aria-hidden="true" />
                {live ? 'measured' : 'cited'}
              </span>
            )}
          </div>
        </section>
      ))}

      <p className="px-5 py-2.5 text-label leading-snug text-faint">
        {live
          ? 'Fingerprints come from the engine’s own hypothesis library and are read-only here. Win counts are measured over investigations run in this process; precision needs labelled outcomes and is not published.'
          : 'Definitions and thresholds are governed by compliance and read-only here. Every score is reproducible from these expressions plus the model contributions alongside.'}
      </p>
    </div>
  );
};
