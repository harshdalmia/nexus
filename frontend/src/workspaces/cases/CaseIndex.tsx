import { Panel, PanelHead } from '@/components/primitives/Panel';
import { ScoreValue, SeverityTag } from '@/components/primitives/Severity';
import { caseViews, useCases } from '@/store/caseStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

const stageDot: Record<string, string> = {
  triage: 'bg-faint',
  investigating: 'bg-info',
  'sar-draft': 'bg-rev',
  filed: 'bg-ok',
};

export const CaseIndex = () => {
  const { activeCaseId } = useWorkspaceState();
  const { openCase, selectEntity } = useWorkspaceActions();
  const { cases } = useCases();
  const records = caseViews(cases);
  const live = cases.length > 0;

  return (
    <Panel collapseId="cases.index" className="hair-r min-h-0 w-full shrink-0 border-0 lg:w-[16.5rem] 2xl:w-[19rem]">
      <PanelHead
        title="cases"
        meta={
          <span className="truncate text-label text-faint">
            {live
              ? `${String(records.length)} from this session`
              : `${String(records.length)} demo · run a query to open a real case`}
          </span>
        }
      />
      <ul className="scroll min-h-0 flex-1">
        {records.map((record) => {
          const isActive = record.id === activeCaseId;

          return (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => {
                  openCase(record.id);
                  selectEntity(record.entity);
                }}
                aria-current={isActive ? 'true' : undefined}
                className={`relative flex w-full flex-col gap-1 px-6 py-4.5 text-left transition-colors duration-100 ${
                  isActive ? 'bg-sel' : 'hover:bg-raise'
                } hair-b`}
              >
                {isActive && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-info" />}
                <span className="flex items-center gap-2">
                  <span className="ident text-body-lg font-medium text-ink">{record.id}</span>
                  <SeverityTag severity={record.severity} />
                  <ScoreValue score={record.score} className="ml-auto" />
                </span>
                <span className="truncate text-label text-muted" title={record.name}>
                  {record.name}
                </span>
                <span className="flex items-center gap-1.5 text-meta text-faint">
                  <span className={`size-1.5 rounded-full ${stageDot[record.stage]}`} aria-hidden="true" />
                  {record.stage}
                  {/* Opened-at is real; there is no SLA clock in the engine to count down. */}
                  <span className="num ml-auto">{record.opened}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
};
