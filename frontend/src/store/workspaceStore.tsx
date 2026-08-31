import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import type { Dispatch, ReactNode } from 'react';
import { spineSeed } from '@/data/caseFile';
import { readSession, writeSession } from '@/hooks/useSessionState';
import type { ScopeChip, Severity, SpineItem, Toast, WorkspaceId } from '@/types/aml';

type Density = 'compact' | 'relaxed';
type Theme = 'dark' | 'light';

interface WorkspaceState {
  readonly workspace: WorkspaceId;
  readonly scope: readonly ScopeChip[];
  readonly activeCaseId: string;
  readonly selectedEntityId: string;
  readonly spine: readonly SpineItem[];
  readonly density: Density;
  readonly theme: Theme;
  readonly railCollapsed: boolean;
  /**
   * The nav drawer on narrow viewports, where the rail is off-canvas rather
   * than in flow. Separate from `railCollapsed`, which is the desktop
   * wide/narrow preference — the two must not overwrite each other when the
   * window crosses the breakpoint.
   */
  readonly navOpen: boolean;
  readonly inspectorCollapsed: boolean;
  readonly paletteOpen: boolean;
  readonly shortcutsOpen: boolean;
  readonly toasts: readonly Toast[];
  readonly pendingQuery: string | null;
}

type Action =
  | { type: 'navigate'; workspace: WorkspaceId }
  | { type: 'scope/add'; chip: ScopeChip }
  | { type: 'scope/remove'; id: string }
  | { type: 'scope/reset' }
  | { type: 'case/open'; caseId: string }
  | { type: 'entity/select'; entityId: string }
  | { type: 'spine/pin'; item: SpineItem }
  | { type: 'spine/unpin'; id: string }
  | { type: 'spine/reorder'; id: string; direction: -1 | 1 }
  | { type: 'ui/density' }
  | { type: 'ui/theme' }
  | { type: 'ui/rail' }
  | { type: 'ui/nav'; open: boolean }
  | { type: 'ui/inspector' }
  | { type: 'ui/palette'; open: boolean }
  | { type: 'ui/shortcuts'; open: boolean }
  | { type: 'toast/push'; toast: Toast }
  | { type: 'toast/dismiss'; id: number }
  | { type: 'query/request'; query: string | null };

const initialState: WorkspaceState = {
  workspace: 'watchtower',
  scope: [
    { id: 'sc-time', kind: 'time', label: 'last 30 days', locked: true },
    { id: 'sc-juris', kind: 'jurisdiction', label: 'all jurisdictions' },
  ],
  activeCaseId: 'C-114',
  selectedEntityId: '4521',
  spine: spineSeed,
  density: 'compact',
  theme: 'dark',
  railCollapsed: false,
  navOpen: false,
  inspectorCollapsed: false,
  paletteOpen: false,
  shortcutsOpen: false,
  toasts: [],
  pendingQuery: null,
};

const reducer = (state: WorkspaceState, action: Action): WorkspaceState => {
  switch (action.type) {
    /* Navigating always dismisses the drawer: on a narrow screen it covers the
       thing the analyst just asked to see. */
    case 'navigate':
      return { ...state, workspace: action.workspace, paletteOpen: false, navOpen: false };
    case 'scope/add': {
      const withoutKind = state.scope.filter(
        (chip) => chip.kind !== action.chip.kind || chip.locked === true,
      );

      return { ...state, scope: [...withoutKind, action.chip] };
    }
    case 'scope/remove':
      return { ...state, scope: state.scope.filter((chip) => chip.id !== action.id) };
    case 'scope/reset':
      return { ...state, scope: initialState.scope };
    case 'case/open':
      return {
        ...state,
        activeCaseId: action.caseId,
        workspace: 'cases',
        paletteOpen: false,
        navOpen: false,
      };
    case 'entity/select':
      return { ...state, selectedEntityId: action.entityId };
    case 'spine/pin':
      return state.spine.some((item) => item.label === action.item.label)
        ? state
        : { ...state, spine: [...state.spine, action.item] };
    case 'spine/unpin':
      return { ...state, spine: state.spine.filter((item) => item.id !== action.id) };
    case 'spine/reorder': {
      const index = state.spine.findIndex((item) => item.id === action.id);
      const target = index + action.direction;

      if (index < 0 || target < 0 || target >= state.spine.length) {
        return state;
      }

      const next = [...state.spine];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);

      return { ...state, spine: next };
    }
    case 'ui/density':
      return { ...state, density: state.density === 'compact' ? 'relaxed' : 'compact' };
    case 'ui/theme':
      return { ...state, theme: state.theme === 'dark' ? 'light' : 'dark' };
    case 'ui/rail':
      return { ...state, railCollapsed: !state.railCollapsed };
    case 'ui/nav':
      return { ...state, navOpen: action.open };
    case 'ui/inspector':
      return { ...state, inspectorCollapsed: !state.inspectorCollapsed };
    case 'ui/palette':
      return { ...state, paletteOpen: action.open };
    case 'ui/shortcuts':
      return { ...state, shortcutsOpen: action.open };
    case 'toast/push':
      return { ...state, toasts: [...state.toasts, action.toast].slice(-3) };
    case 'toast/dismiss':
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case 'query/request':
      return {
        ...state,
        pendingQuery: action.query,
        workspace: action.query === null ? state.workspace : 'ask',
        paletteOpen: false,
        navOpen: false,
      };
    default:
      return state;
  }
};

const StateContext = createContext<WorkspaceState | null>(null);
const DispatchContext = createContext<Dispatch<Action> | null>(null);

const SPINE_KEY = 'spine.session';

const isSpineItem = (value: unknown): value is SpineItem => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<SpineItem>;

  return typeof candidate.id === 'string' && typeof candidate.label === 'string';
};

/** Restore the pinned spine for this browser session, ignoring anything malformed. */
const hydrate = (state: WorkspaceState): WorkspaceState => {
  const stored = readSession<unknown>(SPINE_KEY);

  if (!Array.isArray(stored) || !stored.every(isSpineItem)) {
    return state;
  }

  return { ...state, spine: stored as SpineItem[] };
};

export const WorkspaceProvider = ({ children }: { readonly children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState, hydrate);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-dark', 'theme-light');
    root.classList.add(`theme-${state.theme}`);
    root.dataset.density = state.density;
  }, [state.theme, state.density]);

  /* Pinning is the analyst's own work, so it outlives a navigation and a refresh —
     but not the browser session, which is why this is sessionStorage. */
  useEffect(() => {
    writeSession(SPINE_KEY, state.spine);
  }, [state.spine]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
};

export const useWorkspaceState = (): WorkspaceState => {
  const state = useContext(StateContext);

  if (state === null) {
    throw new Error('useWorkspaceState must be used inside WorkspaceProvider');
  }

  return state;
};

const useDispatchContext = (): Dispatch<Action> => {
  const dispatch = useContext(DispatchContext);

  if (dispatch === null) {
    throw new Error('useWorkspaceActions must be used inside WorkspaceProvider');
  }

  return dispatch;
};

let toastId = 0;

export const useWorkspaceActions = () => {
  const dispatch = useDispatchContext();
  const toastTimers = useRef<number[]>([]);

  useEffect(
    () => () => {
      toastTimers.current.forEach((timer) => window.clearTimeout(timer));
    },
    [],
  );

  const notify = useCallback(
    (title: string, detail: string, severity: Severity | 'info' = 'info') => {
      toastId += 1;
      const id = toastId;
      dispatch({ type: 'toast/push', toast: { id, title, detail, severity } });
      const timer = window.setTimeout(() => dispatch({ type: 'toast/dismiss', id }), 4200);
      toastTimers.current.push(timer);
    },
    [dispatch],
  );

  return useMemo(
    () => ({
      navigate: (workspace: WorkspaceId) => dispatch({ type: 'navigate', workspace }),
      addScope: (chip: ScopeChip) => dispatch({ type: 'scope/add', chip }),
      removeScope: (id: string) => dispatch({ type: 'scope/remove', id }),
      resetScope: () => dispatch({ type: 'scope/reset' }),
      openCase: (caseId: string) => dispatch({ type: 'case/open', caseId }),
      selectEntity: (entityId: string) => dispatch({ type: 'entity/select', entityId }),
      pin: (item: SpineItem) => dispatch({ type: 'spine/pin', item }),
      unpin: (id: string) => dispatch({ type: 'spine/unpin', id }),
      reorderSpine: (id: string, direction: -1 | 1) =>
        dispatch({ type: 'spine/reorder', id, direction }),
      toggleDensity: () => dispatch({ type: 'ui/density' }),
      toggleTheme: () => dispatch({ type: 'ui/theme' }),
      toggleRail: () => dispatch({ type: 'ui/rail' }),
      setNav: (open: boolean) => dispatch({ type: 'ui/nav', open }),
      toggleInspector: () => dispatch({ type: 'ui/inspector' }),
      setPalette: (open: boolean) => dispatch({ type: 'ui/palette', open }),
      setShortcuts: (open: boolean) => dispatch({ type: 'ui/shortcuts', open }),
      dismissToast: (id: number) => dispatch({ type: 'toast/dismiss', id }),
      requestQuery: (query: string | null) => dispatch({ type: 'query/request', query }),
      notify,
    }),
    [dispatch, notify],
  );
};
