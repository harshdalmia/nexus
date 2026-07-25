import { useEffect, useRef } from 'react';

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
};

export interface HotkeyHandlers {
  /** single keys, e.g. { '/': fn, escape: fn } — lower-cased key names */
  readonly keys?: Record<string, (event: KeyboardEvent) => void>;
  /** ⌘/ctrl combos, e.g. { k: fn } */
  readonly meta?: Record<string, (event: KeyboardEvent) => void>;
  /** two-key sequences like `g` then `c` */
  readonly sequences?: Record<string, (event: KeyboardEvent) => void>;
  /** allow keys while an input is focused (escape and meta combos always pass) */
  readonly allowInInput?: readonly string[];
}

const SEQUENCE_WINDOW_MS = 900;

export const useHotkeys = ({ keys, meta, sequences, allowInInput = [] }: HotkeyHandlers): void => {
  const pending = useRef<{ key: string; at: number } | null>(null);
  const handlers = useRef({ keys, meta, sequences, allowInInput });
  handlers.current = { keys, meta, sequences, allowInInput };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const current = handlers.current;
      const typing = isTypingTarget(event.target);

      if ((event.metaKey || event.ctrlKey) && current.meta?.[key] !== undefined) {
        event.preventDefault();
        current.meta[key](event);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (typing && key !== 'escape' && !current.allowInInput.includes(key)) {
        return;
      }

      const now = Date.now();
      const prior = pending.current;

      if (prior !== null && now - prior.at < SEQUENCE_WINDOW_MS) {
        const combo = `${prior.key} ${key}`;
        pending.current = null;

        if (current.sequences?.[combo] !== undefined) {
          event.preventDefault();
          current.sequences[combo](event);
          return;
        }
      }

      const startsSequence = Object.keys(current.sequences ?? {}).some((combo) =>
        combo.startsWith(`${key} `),
      );

      if (startsSequence) {
        pending.current = { key, at: now };
        return;
      }

      if (current.keys?.[key] !== undefined) {
        event.preventDefault();
        current.keys[key](event);
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
