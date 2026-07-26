import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

const tone = {
  severe: { className: 'border-sev-line bg-sev-bg text-sev', Icon: TriangleAlert },
  review: { className: 'border-rev-line bg-rev-bg text-rev', Icon: TriangleAlert },
  clear: { className: 'border-ok-line bg-ok-bg text-ok', Icon: Check },
  info: { className: 'border-info-line bg-info-bg text-info', Icon: Info },
} as const;

export const ToastStack = () => {
  const { toasts } = useWorkspaceState();
  const { dismissToast } = useWorkspaceActions();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed right-3 bottom-9 z-40 flex w-[22rem] flex-col gap-1.5"
      role="status"
      aria-live="polite"
    >
      {toasts.map(({ id, title, detail, severity }) => {
        const { className, Icon } = tone[severity];

        return (
          <div
            key={id}
            className={`anim-fade-up overlay-shadow pointer-events-auto flex items-start gap-3 border bg-panel px-5 py-4 ${className}`}
          >
            <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs2 font-semibold">{title}</p>
              <p className="text-2xs leading-relaxed text-muted">{detail}</p>
            </div>
            <button
              type="button"
              onClick={() => dismissToast(id)}
              aria-label="Dismiss notification"
              className="shrink-0 text-faint transition-colors hover:text-ink"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
