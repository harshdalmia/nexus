import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileSignature,
  GitBranch,
  Landmark,
  Receipt,
  Scale,
  StickyNote,
  Workflow,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { EmptyState } from '@/components/primitives/EmptyState';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import type { SpineKind } from '@/types/aml';

const kindIcon: Record<SpineKind, LucideIcon> = {
  transaction: Receipt,
  entity: Landmark,
  rule: Scale,
  graph: GitBranch,
  note: StickyNote,
  trace: Workflow,
  chart: Workflow,
};

/* The evidence spine is the bridge between investigating and reporting:
   pin things while you work, and the SAR narrative is assembled from the
   ordered result. Order matters, so reordering is first-class and
   keyboard-accessible, not drag-only. */
export const EvidenceSpine = () => {
  const { spine, activeCaseId } = useWorkspaceState();
  const { unpin, reorderSpine, pin, notify, navigate } = useWorkspaceActions();
  const [note, setNote] = useState('');
  const items = spine.filter((item) => item.caseId === activeCaseId);

  return (
    <Panel className="hair-r min-h-0 w-full border-0 xl:w-[24rem]">
      <PanelHead
        title="evidence spine"
        meta={`${String(items.length)} items · order drives the SAR narrative`}
        actions={
          <Button size="xs" variant="primary" onClick={() => navigate('reports')} disabled={items.length === 0}>
            <FileSignature className="size-3" aria-hidden="true" />
            compose
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-4" aria-hidden="true" />}
          title="Nothing pinned yet"
          body="Pin transactions, entities, rule hits or graph findings while you investigate. The report composer assembles the narrative from what lands here, in this order."
          actions={[{ label: 'Open the ledger', onClick: () => navigate('ledger') }]}
        />
      ) : (
        <ol className="scroll min-h-0 flex-1">
          {items.map((item, index) => {
            const Icon = kindIcon[item.kind];

            return (
              <li key={item.id} className="hair-b group flex items-start gap-2 px-4 py-3">
                <span className="num mt-px w-4 shrink-0 text-meta text-faint">{index + 1}</span>
                <Icon className="mt-0.5 size-3 shrink-0 text-info" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-label leading-snug text-ink">{item.label}</span>
                  <span className="block truncate text-meta text-faint">{item.meta}</span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => reorderSpine(item.id, -1)}
                    aria-label={`Move ${item.label} earlier`}
                    className="grid size-4 place-items-center text-faint hover:text-ink"
                  >
                    <ChevronLeft className="size-2.5 rotate-90" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => reorderSpine(item.id, 1)}
                    aria-label={`Move ${item.label} later`}
                    className="grid size-4 place-items-center text-faint hover:text-ink"
                  >
                    <ChevronRight className="size-2.5 rotate-90" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => unpin(item.id)}
                    aria-label={`Remove ${item.label}`}
                    className="grid size-4 place-items-center text-faint hover:text-sev"
                  >
                    <X className="size-2.5" aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <form
        className="hair-t flex items-center gap-1.5 px-3 py-3"
        onSubmit={(event) => {
          event.preventDefault();

          if (note.trim().length === 0) {
            return;
          }

          pin({
            id: `sp-note-${String(Date.now())}`,
            kind: 'note',
            label: note.trim(),
            meta: 'analyst note · Harsh R. · just now',
            caseId: activeCaseId,
          });
          notify('Note pinned', 'Analyst notes are typographically distinct from AI narrative.', 'clear');
          setNote('');
        }}
      >
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add an analyst note to the spine…"
          aria-label="Analyst note"
          className="field flex-1 text-label"
        />
        <Button size="sm" type="submit" disabled={note.trim().length === 0}>
          pin note
        </Button>
      </form>
    </Panel>
  );
};
