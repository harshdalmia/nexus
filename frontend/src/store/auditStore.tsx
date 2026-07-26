import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { readSession, useSessionState, writeSession } from '@/hooks/useSessionState';
import { useWorkspaceState } from '@/store/workspaceStore';
import type { WorkspaceId } from '@/types/aml';

/* ------------------------------------------------------------------
   Session audit trail.

   Every meaningful action an analyst takes is recorded here and held in
   sessionStorage, so the trail survives navigation between workspaces
   and a page refresh, and disappears when the browser session ends.
   Nothing is written to localStorage: this is a working record of one
   sitting, not a durable compliance log. The durable, server-side trail
   remains a backend gap.
   ------------------------------------------------------------------ */

const STORAGE_KEY = 'audit.session';
const MAX_EVENTS = 400;

export type AuditAction =
  | 'investigation.started'
  | 'investigation.completed'
  | 'investigation.failed'
  | 'report.generated'
  | 'risk.reviewed'
  | 'filter.changed'
  | 'case.opened'
  | 'case.closed'
  | 'export.generated'
  | 'evidence.viewed'
  | 'entity.selected'
  | 'timeline.expanded'
  | 'graph.interaction'
  | 'scope.changed'
  | 'session.started';

export type AuditStatus = 'ok' | 'pending' | 'blocked' | 'failed';

/** The label an analyst reads in the trail, per action. */
export const auditActionLabel: Record<AuditAction, string> = {
  'investigation.started': 'Investigation started',
  'investigation.completed': 'Investigation completed',
  'investigation.failed': 'Investigation failed',
  'report.generated': 'Report generated',
  'risk.reviewed': 'Risk reviewed',
  'filter.changed': 'Filter changed',
  'case.opened': 'Case opened',
  'case.closed': 'Case closed',
  'export.generated': 'Export generated',
  'evidence.viewed': 'Evidence viewed',
  'entity.selected': 'Entity selected',
  'timeline.expanded': 'Timeline expanded',
  'graph.interaction': 'Graph interaction',
  'scope.changed': 'Scope changed',
  'session.started': 'Session started',
};

/** Who is acting. There is no auth in the stack yet, so the analyst is fixed. */
export const sessionUser = {
  id: 'harsh.r',
  name: 'Harsh R.',
  role: 'AML analyst L2',
} as const;

export interface AuditEvent {
  readonly id: string;
  /** ISO timestamp, so ordering survives serialisation */
  readonly at: string;
  readonly action: AuditAction;
  readonly detail: string;
  /** run id or case id the action belongs to, when there is one */
  readonly investigation: string | null;
  readonly entity: string | null;
  readonly user: string;
  readonly role: string;
  readonly status: AuditStatus;
  readonly workspace: WorkspaceId | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface AuditRecordInput {
  readonly action: AuditAction;
  readonly detail: string;
  readonly investigation?: string | null;
  readonly entity?: string | null;
  readonly status?: AuditStatus;
  readonly workspace?: WorkspaceId | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

interface AuditContextValue {
  /** newest first */
  readonly events: readonly AuditEvent[];
  readonly record: (input: AuditRecordInput) => void;
  readonly clear: () => void;
}

const AuditContext = createContext<AuditContextValue | null>(null);

const isEvent = (value: unknown): value is AuditEvent => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<AuditEvent>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.at === 'string' &&
    typeof candidate.action === 'string' &&
    typeof candidate.detail === 'string'
  );
};

/** Reject a stored trail whose shape predates the current build. */
const migrate = (stored: unknown): readonly AuditEvent[] | null =>
  Array.isArray(stored) && stored.every(isEvent) ? (stored as AuditEvent[]) : null;

let counter = 0;

const nextId = (): string => {
  counter += 1;

  return `ae-${Date.now().toString(36)}-${String(counter)}`;
};

export const AuditProvider = ({ children }: { readonly children: ReactNode }) => {
  const [events, setEvents] = useSessionState<readonly AuditEvent[]>(
    STORAGE_KEY,
    () => {
      /* First load of a session opens the trail with its own entry, so an empty
         table always means "nothing done yet" rather than "not recording". */
      const existing = readSession<unknown>(STORAGE_KEY);

      if (migrate(existing) !== null) {
        return migrate(existing) as readonly AuditEvent[];
      }

      const opened: AuditEvent = {
        id: nextId(),
        at: new Date().toISOString(),
        action: 'session.started',
        detail: 'Analyst session opened in the browser',
        investigation: null,
        entity: null,
        user: sessionUser.name,
        role: sessionUser.role,
        status: 'ok',
        workspace: null,
        metadata: { persistence: 'sessionStorage' },
      };

      writeSession(STORAGE_KEY, [opened]);

      return [opened];
    },
    migrate,
  );

  const record = useCallback(
    (input: AuditRecordInput) => {
      const event: AuditEvent = {
        id: nextId(),
        at: new Date().toISOString(),
        action: input.action,
        detail: input.detail,
        investigation: input.investigation ?? null,
        entity: input.entity ?? null,
        user: sessionUser.name,
        role: sessionUser.role,
        status: input.status ?? 'ok',
        workspace: input.workspace ?? null,
        metadata: input.metadata ?? {},
      };

      /* Newest first, capped so a long sitting cannot exhaust session storage. */
      setEvents((current) => [event, ...current].slice(0, MAX_EVENTS));
    },
    [setEvents],
  );

  const clear = useCallback(() => {
    setEvents([]);
  }, [setEvents]);

  const value = useMemo<AuditContextValue>(
    () => ({ events, record, clear }),
    [events, record, clear],
  );

  return (
    <AuditContext.Provider value={value}>
      <WorkspaceAuditBridge record={record} />
      {children}
    </AuditContext.Provider>
  );
};

/* ------------------------------------------------------------------
   One observer instead of a `record` call in every handler.

   Case selection, entity selection, scope edits and evidence pinning all
   flow through workspace state, so watching that state captures them from
   every entry point — a table row, the command palette, a keyboard
   shortcut — and cannot drift out of sync with a handler someone forgets
   to instrument. Actions whose meaning is not visible in state (reviewing
   a risk, generating an export) record themselves at the call site.
   ------------------------------------------------------------------ */
const WorkspaceAuditBridge = ({
  record,
}: {
  readonly record: (input: AuditRecordInput) => void;
}) => {
  const { workspace, activeCaseId, selectedEntityId, scope, spine } = useWorkspaceState();

  /* Seeded with the values already on screen, so the first render records nothing. */
  const seen = useRef({
    caseId: activeCaseId,
    entityId: selectedEntityId,
    scope: scope.map((chip) => chip.label).join(' · '),
    spineSize: spine.length,
  });

  useEffect(() => {
    if (seen.current.caseId === activeCaseId) {
      return;
    }

    seen.current.caseId = activeCaseId;
    record({
      action: 'case.opened',
      detail: `Case ${activeCaseId} opened`,
      investigation: activeCaseId,
      workspace,
      metadata: { case: activeCaseId },
    });
  }, [activeCaseId, workspace, record]);

  useEffect(() => {
    if (seen.current.entityId === selectedEntityId) {
      return;
    }

    seen.current.entityId = selectedEntityId;
    record({
      action: 'entity.selected',
      detail: `Entity ${selectedEntityId} selected`,
      entity: selectedEntityId,
      workspace,
      metadata: { entity: selectedEntityId },
    });
  }, [selectedEntityId, workspace, record]);

  useEffect(() => {
    const label = scope.map((chip) => chip.label).join(' · ');

    if (seen.current.scope === label) {
      return;
    }

    seen.current.scope = label;
    record({
      action: 'scope.changed',
      detail: `Scope set to ${label || 'no scope'}`,
      workspace,
      metadata: { chips: String(scope.length), scope: label },
    });
  }, [scope, workspace, record]);

  useEffect(() => {
    if (seen.current.spineSize === spine.length) {
      return;
    }

    const grew = spine.length > seen.current.spineSize;
    seen.current.spineSize = spine.length;

    const latest = spine[spine.length - 1];
    record({
      action: 'evidence.viewed',
      detail: grew
        ? `Evidence pinned · ${latest?.label ?? 'item'}`
        : 'Evidence item removed from the spine',
      investigation: latest?.caseId ?? activeCaseId,
      workspace,
      metadata: { spine_size: String(spine.length), kind: latest?.kind ?? 'unknown' },
    });
  }, [spine, activeCaseId, workspace, record]);

  return null;
};

export const useAudit = (): AuditContextValue => {
  const value = useContext(AuditContext);

  if (value === null) {
    throw new Error('useAudit must be used inside AuditProvider');
  }

  return value;
};
