interface SkeletonProps {
  readonly className?: string;
  readonly width?: string;
}

export const Skeleton = ({ className = 'h-2.5', width = '100%' }: SkeletonProps) => (
  <span aria-hidden="true" className={`skeleton block ${className}`} style={{ width }} />
);

const defaultWidths = ['100%', '96%', '88%', '64%'] as const;

export const SkeletonLines = ({
  lines = 3,
  label = 'Generating',
}: {
  readonly lines?: number;
  readonly label?: string;
}) => (
  <div className="flex flex-col gap-2" role="status" aria-label={label}>
    {Array.from({ length: lines }, (_, index) => (
      <Skeleton key={index} width={defaultWidths[index % defaultWidths.length]} />
    ))}
  </div>
);
