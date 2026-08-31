import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CornerDownLeft, Loader2, Search, Sparkles } from 'lucide-react';
import { Kbd } from '@/components/primitives/Button';
import { scenarios } from '@/data/scenarios';
import { useAgent } from '@/store/agentStore';

export const QueryConsole = () => {
  const { run, isBusy, query, phase, elapsedMs, totalMs } = useAgent();
  const [value, setValue] = useState(query);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (query.length > 0) {
      setValue(query);
    }
  }, [query]);

  useEffect(() => {
    const focusOnSlash = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', focusOnSlash);

    return () => window.removeEventListener('keydown', focusOnSlash);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(value);
  };

  const progress = totalMs === 0 ? 0 : Math.min(1, elapsedMs / totalMs);

  return (
    <section className="hair-b relative bg-panel">
      {/* Wraps rather than overflowing: the submit button is the primary action of
          the whole workspace, so it must never be the thing pushed off-screen. */}
      <form
        onSubmit={submit}
        className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-4 py-5 sm:px-6 sm:py-6"
        autoComplete="off"
      >
        <label htmlFor="agent-query" className="sr-only">
          Natural language query
        </label>
        <span className="grid size-6 shrink-0 place-items-center text-faint">
          {isBusy ? (
            <Loader2 className="size-3.5 animate-spin text-info" aria-hidden="true" />
          ) : (
            <Search className="size-3.5" aria-hidden="true" />
          )}
        </span>
        <input
          id="agent-query"
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask in plain language — “find structuring patterns in the last 30 days”"
          className="w-full min-w-0 flex-1 basis-40 bg-transparent text-lede text-ink placeholder:text-faint focus:outline-none"
        />
        <span className="hidden items-center gap-1 text-meta text-faint lg:flex">
          <Kbd>/</Kbd> focus
        </span>
        <button
          type="submit"
          disabled={value.trim().length === 0 || isBusy}
          className="ctl ctl-primary ml-auto shrink-0 gap-1.5 px-2.5 text-xs2 font-semibold"
        >
          <Sparkles className="size-3" aria-hidden="true" />
          {isBusy ? 'investigating…' : 'investigate'}
          <CornerDownLeft className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </form>

      {phase === 'idle' && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 pb-5 sm:px-6">
          <span className="eyebrow shrink-0">try</span>
          {scenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => {
                setValue(scenario.query);
                run(scenario.query);
              }}
              /* `.ctl` is nowrap by default, which is right for a toolbar button and
                 wrong for a full sentence: one long suggestion would otherwise be
                 wider than a phone and drag the whole console with it. */
              className="ctl h-auto max-w-full min-h-8 px-3 py-1.5 text-left text-label whitespace-normal"
            >
              {scenario.query}
              <span className="num pl-1.5 text-meta text-faint">
                {scenario.steps.filter((step) => step.status !== 'skipped').length}/14
              </span>
            </button>
          ))}
        </div>
      )}

      {phase !== 'idle' && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] bg-raise">
          <span
            className={`block h-full transition-[width] duration-150 ${
              phase === 'complete' ? 'bg-ok' : 'bg-info'
            }`}
            style={{ width: `${String(progress * 100)}%` }}
          />
        </div>
      )}
    </section>
  );
};
