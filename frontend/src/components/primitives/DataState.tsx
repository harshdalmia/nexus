import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useDataSource } from '@/store/dataSourceStore';

/* ------------------------------------------------------------------
   Provenance, expressed the same way everywhere.

   Demo data was already labelled across the app, but with a different
   inline string per panel. These components exist so a panel cannot show
   bundled figures without saying so, and so the third state — engine
   reachable but not answering yet — reads as "waiting" rather than
   silently borrowing the demo set.
   ------------------------------------------------------------------ */

/** The demo marker. Tooltip carries the reason the fallback was taken. */
export const DemoBadge = ({ className = '' }: { readonly className?: string }) => {
  const { reason } = useDataSource();

  return (
    <span
      className={`badge badge-cap border-rule bg-raise text-faint ${className}`}
      title={reason ?? 'bundled demo data'}
    >
      demo data
    </span>
  );
};

/**
 * Panel meta line that states the source in one phrase.
 *
 * @param live what to say when the numbers came from the engine
 * @param demo what to say when they came from the bundled set
 */
export const SourceMeta = ({
  live,
  demo,
}: {
  readonly live: string;
  readonly demo: string;
}) => {
  const { isDemo, isPending, engineState, reason } = useDataSource();

  if (isPending) {
    return (
      <span className="truncate text-label text-faint">
        {engineState === 'warming' ? 'engine loading its dataset…' : 'connecting to engine…'}
      </span>
    );
  }

  return (
    <span className="truncate text-label text-faint" title={reason ?? undefined}>
      {isDemo ? `${demo} · demo data` : live}
    </span>
  );
};

/**
 * Stands in for a chart or table while the engine's state is unresolved.
 *
 * This is the piece that keeps the rule honest: the alternative is rendering
 * the demo set for the second or two before /health answers, which is exactly
 * the ambiguity the demo labelling is meant to remove.
 */
export const SourcePending = ({
  label = 'waiting for the engine',
  className = '',
}: {
  readonly label?: string;
  readonly className?: string;
}) => {
  const { engineState } = useDataSource();

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center ${className}`}
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-4 animate-spin text-faint" aria-hidden="true" />
      <p className="text-label text-faint">
        {engineState === 'warming' ? 'The engine is loading its dataset.' : label}
      </p>
      <p className="max-w-[44ch] text-meta leading-relaxed text-faint">
        {engineState === 'warming'
          ? 'Live figures appear as soon as ingest finishes.'
          : 'Nothing is shown yet because it is not yet known whether the engine can answer. Demo data appears only if it cannot.'}
      </p>
    </div>
  );
};

/**
 * Renders `children` once the source is settled, and a placeholder until then.
 * Convenience wrapper for panels whose whole body is source-dependent.
 */
export const SourceGate = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) => {
  const { isPending } = useDataSource();

  return isPending ? <SourcePending label={label} /> : <>{children}</>;
};
