import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Radar, Rewind, ScanSearch } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Collapse, CollapseToggle } from '@/components/primitives/Panel';
import { useCollapsed } from '@/hooks/useCollapsed';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tone } from '@/components/primitives/Severity';
import { VizRenderer } from '@/components/viz/VizRenderer';
import { useAgent } from '@/store/agentStore';
import { useWorkspaceActions } from '@/store/workspaceStore';
import {
  DownloadsBlock,
  EvidenceBlock,
  GraphBlock,
  SarBlock,
  SummaryBlock,
  TimelineBlock,
} from '@/workspaces/ask/DossierBlocks';
import {
  CapabilityStrip,
  DetectionBlock,
  ExecutionSummaryBlock,
  FeatureBlock,
  PlanningBlock,
  RiskBlock,
} from '@/workspaces/ask/AgentBlocks';
import { ExplanationCard, ExplanationSkeleton, RecommendationCard } from '@/workspaces/ask/ExplanationCard';
import type { DossierSection, Scenario } from '@/types/aml';

const spanClass: Record<DossierSection['span'], string> = {
  full: 'col-span-6',
  'two-thirds': 'col-span-6 xl:col-span-4',
  half: 'col-span-6 xl:col-span-3',
  third: 'col-span-6 md:col-span-3 xl:col-span-2',
};

/* Every dossier section folds. A finished investigation is a long document —
   summary, planning, features, detection, risk, charts, graph, timeline,
   evidence, explanation, SAR — and an analyst reading one part should be able
   to park the rest without losing it. The body stays mounted, so a folded
   chart keeps its selection and a folded table its page. */
const SectionShell = ({
  section,
  index,
  children,
  meta,
}: {
  readonly section: DossierSection;
  readonly index: number;
  readonly children: ReactNode;
  readonly meta?: string;
}) => {
  const { shut, toggle } = useCollapsed(`dossier.${section.id}`);

  return (
    <section
      data-collapsed={shut ? 'true' : undefined}
      className={`anim-fade-up sheen flex min-h-0 flex-col rounded-[3px] border border-line bg-panel ${spanClass[section.span]}`}
      style={{ animationDelay: `${String(Math.min(index, 8) * 45)}ms` }}
      aria-label={section.title}
    >
      <header className="panel-head">
        <CollapseToggle shut={shut} onToggle={toggle} label={section.title} />
        <h3 className="eyebrow truncate">
          <button type="button" onClick={toggle} className="truncate text-left" tabIndex={-1}>
            {section.title}
          </button>
        </h3>
        {shut ? (
          <span className="truncate text-2xs text-faint">folded · click to reopen</span>
        ) : (
          meta !== undefined && <span className="truncate text-2xs text-faint">{meta}</span>
        )}
        <span className="num ml-auto shrink-0 text-meta text-ghost">{section.unlockAfter}</span>
      </header>
      <Collapse shut={shut}>
        {/* the section's original body box, kept so the card lays out unchanged */}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </Collapse>
    </section>
  );
};

const SectionBody = ({ section, scenario }: { readonly section: DossierSection; readonly scenario: Scenario }) => {
  const { query, explanationReady } = useDossierContext();
  const { addScope, navigate, notify } = useWorkspaceActions();

  switch (section.kind) {
    case 'summary':
      return <SummaryBlock scenario={scenario} />;
    case 'execution-summary':
      return <ExecutionSummaryBlock scenario={scenario} />;
    case 'planning':
      return <PlanningBlock scenario={scenario} />;
    case 'features':
      return <FeatureBlock scenario={scenario} note={section.note} />;
    case 'detection':
      return <DetectionBlock scenario={scenario} />;
    case 'risk-classification':
      return <RiskBlock scenario={scenario} />;
    case 'chart':
      return section.chart === undefined ? null : (
        <VizRenderer
          spec={section.chart}
          onScope={(label) => {
            addScope({ id: 'sc-juris-sel', kind: 'jurisdiction', label });
            navigate('ledger');
            notify('Scope applied', `Ledger filtered to ${label}.`, 'info');
          }}
        />
      );
    case 'graph':
      return <GraphBlock note={section.note} />;
    case 'timeline':
      return <TimelineBlock />;
    case 'evidence':
      return <EvidenceBlock scenario={scenario} />;
    case 'explanation':
      return scenario.explanation === null ? null : explanationReady ? (
        <ExplanationCard explanation={scenario.explanation} query={query} />
      ) : (
        <ExplanationSkeleton />
      );
    case 'recommendation':
      return scenario.explanation === null ? null : <RecommendationCard explanation={scenario.explanation} />;
    case 'sar':
      return <SarBlock />;
    case 'downloads':
      return <DownloadsBlock />;
    default:
      return null;
  }
};

/* tiny context so blocks can read run state without prop-drilling */
const useDossierContext = () => {
  const { query, stepStates, scenario } = useAgent();
  const explainIndex = scenario?.steps.findIndex((step) => step.tool === 'explainability') ?? -1;

  return {
    query,
    explanationReady: explainIndex >= 0 && stepStates[explainIndex] === 'done',
  };
};

const PendingSection = ({ section }: { readonly section: DossierSection }) => (
  <section
    className={`flex min-h-[9rem] flex-col rounded-[3px] border border-dashed border-line/70 bg-sunken/60 ${spanClass[section.span]}`}
    aria-hidden="true"
  >
    <header className="flex h-[var(--panel-head-h)] items-center gap-2.5 border-b border-line/60 px-[var(--panel-x)]">
      <span className="eyebrow text-ghost">{section.title}</span>
      <span className="num ml-auto text-meta text-ghost">awaiting {section.unlockAfter}</span>
    </header>
    <div className="flex flex-1 flex-col justify-center gap-2.5 px-6 py-5">
      <Skeleton width="72%" />
      <Skeleton width="46%" />
      <Skeleton width="58%" />
    </div>
  </section>
);

export const Dossier = () => {
  const { scenario, unlocked, phase, expandStage, isBusy, stageExpanded } = useAgent();
  const { requestQuery, navigate } = useWorkspaceActions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);

  /* Full canvas hides this column rather than unmounting it, but a hidden box
     has no scroll offset to keep, so the position is banked on the way out and
     put back on the way in. */
  useEffect(() => {
    const element = scrollRef.current;

    if (element === null) {
      return;
    }

    if (stageExpanded) {
      offset.current = element.scrollTop;
    } else if (offset.current > 0) {
      element.scrollTop = offset.current;
    }
  }, [stageExpanded]);

  if (scenario === null) {
    return (
      <div className="scroll flex min-h-0 flex-1 flex-col">
        <EmptyState
          icon={<Radar className="size-4" aria-hidden="true" />}
          title="Start an investigation"
          body="Ask a question and the agent plans its own route through fourteen tools. The dossier assembles itself section by section as each tool resolves — you never wait on a blank screen."
          actions={[
            {
              label: 'Find structuring patterns in the last 30 days',
              primary: true,
              onClick: () => requestQuery('Find structuring patterns in the last 30 days'),
            },
            { label: 'Open the triage queue', onClick: () => navigate('watchtower') },
          ]}
          hint="a counting question runs 7 of 14 tools in 9s · an open-ended one runs 13 in 40s"
        />
        <CapabilityStrip onAsk={requestQuery} />
      </div>
    );
  }

  const visible = scenario.sections.filter((section) => unlocked.includes(section.id));
  const pending = scenario.sections.filter((section) => !unlocked.includes(section.id));

  return (
    <div ref={scrollRef} className="scroll min-h-0 flex-1">
      <div className="hair-b flex flex-wrap items-center gap-4 bg-panel px-7 py-5">
        <ScanSearch className="size-4.5 shrink-0 text-model" aria-hidden="true" />
        <h2 className="display truncate text-section text-ink">Investigation dossier</h2>
        <Tone kind="model">{scenario.action}</Tone>
        <span className="num text-meta text-faint">
          {visible.length} of {scenario.sections.length} sections
          {isBusy && ' · assembling'}
        </span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={expandStage}>
          <Rewind className="size-3" aria-hidden="true" />
          {phase === 'complete' ? 'review execution' : 'back to execution'}
        </Button>
      </div>

      <div className="sec-grid grid grid-cols-6 p-6">
        {visible.map((section, index) => (
          <SectionShell
            key={section.id}
            section={section}
            index={index}
            meta={section.chart?.title === section.title ? undefined : section.chart?.title}
          >
            <SectionBody section={section} scenario={scenario} />
          </SectionShell>
        ))}
        {pending.map((section) => (
          <PendingSection key={section.id} section={section} />
        ))}
      </div>

      {scenario.explanation === null && unlocked.length > 0 && (
        <div className="hair-t mx-6 mb-6 flex items-start gap-4 border border-line bg-panel px-6 py-5">
          <Tone kind="neutral">by design</Tone>
          <p className="max-w-[92ch] text-label leading-relaxed text-muted">
            {scenario.noExplanationReason}
          </p>
        </div>
      )}
    </div>
  );
};
