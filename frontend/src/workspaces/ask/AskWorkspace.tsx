import { useEffect } from 'react';
import { Dossier } from '@/workspaces/ask/Dossier';
import { ExecutionStage } from '@/workspaces/ask/ExecutionStage';
import { PlanRail } from '@/workspaces/ask/PlanRail';
import { QueryConsole } from '@/workspaces/ask/QueryConsole';
import { useAgent } from '@/store/agentStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

/* Two arrangements, one workspace.

   While a run is in flight the execution stage owns the screen — the
   orchestration is the story, not a loading state. When it finishes the
   stage folds into the permanent plan rail on the left and the dossier
   takes the space. Either way the plan stays visible: no result is ever
   shown without the reasoning that produced it. */
export const AskWorkspace = () => {
  const { pendingQuery } = useWorkspaceState();
  const { requestQuery } = useWorkspaceActions();
  const { run, stageExpanded, scenario } = useAgent();

  useEffect(() => {
    if (pendingQuery !== null) {
      run(pendingQuery);
      requestQuery(null);
    }
  }, [pendingQuery, run, requestQuery]);

  const staged = stageExpanded && scenario !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <QueryConsole />

      {staged ? (
        <ExecutionStage />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <PlanRail />
          <div className="flex min-h-0 flex-1 flex-col">
            <Dossier />
          </div>
        </div>
      )}
    </div>
  );
};
