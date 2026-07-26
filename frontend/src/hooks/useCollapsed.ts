import { useCallback, useEffect, useState } from 'react';

/* ------------------------------------------------------------------
   Collapse state for panels.

   A panel that can be shut keeps its children MOUNTED — the body is
   height-collapsed with a grid-rows transition, not unmounted. So a shut
   panel loses nothing: table page, sort, expanded row, scroll offset and
   any in-flight fetch all survive, and reopening is instant.

   State is keyed by id and held in sessionStorage, which is what "preserve
   while navigating within the page" means here: the app is a single document
   with workspace switching, so leaving a workspace and coming back restores
   what the analyst had folded away. It is deliberately session-scoped rather
   than durable — a fresh sitting starts open.
   ------------------------------------------------------------------ */

const STORE_KEY = 'sentinel.panels.collapsed';

/** One event, so two panels sharing an id stay in step and a late mount reads current state. */
const CHANGED = 'sentinel:panel-collapse';

const readShut = (): Record<string, boolean> => {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);

    if (raw === null) {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
};

const writeShut = (next: Record<string, boolean>): void => {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* private mode or a full quota: collapsing still works, it just won't persist */
  }
};

/** Read and toggle the collapsed state of one panel. */
export const useCollapsed = (
  id: string | undefined,
  defaultShut = false,
): { readonly shut: boolean; readonly toggle: () => void } => {
  const [shut, setShut] = useState(() => {
    if (id === undefined) {
      return false;
    }

    return readShut()[id] ?? defaultShut;
  });

  useEffect(() => {
    if (id === undefined) {
      return;
    }

    const sync = () => setShut(readShut()[id] ?? defaultShut);

    sync();
    window.addEventListener(CHANGED, sync);

    return () => window.removeEventListener(CHANGED, sync);
  }, [id, defaultShut]);

  const toggle = useCallback(() => {
    if (id === undefined) {
      return;
    }

    const current = readShut();

    writeShut({ ...current, [id]: !(current[id] ?? defaultShut) });
    window.dispatchEvent(new Event(CHANGED));
  }, [id, defaultShut]);

  return { shut, toggle };
};
