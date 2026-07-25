import { useCallback, useEffect, useRef, useState } from 'react';

/* ------------------------------------------------------------------
   State that survives navigation and refresh, but dies with the tab.

   sessionStorage rather than localStorage on purpose: an analyst's
   working context (filters, the audit trail for this sitting) should
   not silently reappear days later on a shared workstation.

   Reads are guarded so the module is safe under server-side rendering
   and when a browser blocks storage entirely.
   ------------------------------------------------------------------ */

const NAMESPACE = 'nexus';

const key = (name: string): string => `${NAMESPACE}.${name}`;

const available = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.sessionStorage !== undefined;
  } catch {
    /* Safari in lockdown mode throws on access rather than returning undefined. */
    return false;
  }
};

export const readSession = <T>(name: string): T | null => {
  if (!available()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(key(name));

    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
};

export const writeSession = (name: string, value: unknown): void => {
  if (!available()) {
    return;
  }

  try {
    window.sessionStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* Quota or private-mode failures must never break an interaction. */
  }
};

export const clearSession = (name: string): void => {
  if (!available()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(key(name));
  } catch {
    /* ignored for the same reason as writes */
  }
};

/**
 * `useState`, persisted for the browser session.
 *
 * `migrate` lets a caller reject a stored value whose shape has changed since it
 * was written, so a stale key can never crash a render.
 */
export const useSessionState = <T>(
  name: string,
  /** a value, or a factory for callers whose default is expensive or side-effecting */
  initial: T | (() => T),
  migrate?: (stored: unknown) => T | null,
): readonly [T, (next: T | ((current: T) => T)) => void, () => void] => {
  const fallback = useCallback(
    (): T => (typeof initial === 'function' ? (initial as () => T)() : initial),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [value, setValue] = useState<T>(() => {
    const stored = readSession<unknown>(name);

    if (stored === null) {
      return fallback();
    }

    if (migrate !== undefined) {
      return migrate(stored) ?? fallback();
    }

    return stored as T;
  });

  /* The first write is skipped: it would only rewrite what was just read. */
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;

      return;
    }

    writeSession(name, value);
  }, [name, value]);

  const reset = useCallback(() => {
    clearSession(name);
    setValue(fallback());
  }, [name, fallback]);

  return [value, setValue, reset] as const;
};
