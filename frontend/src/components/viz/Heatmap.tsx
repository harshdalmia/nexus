import { useState } from 'react';
import type { HeatCell } from '@/data/queue';

/* Sequential ramp: recessed slate → amber → crimson. Intensity is printed on
   hover and the top band is outlined, so the reading never depends on colour
   alone. Cells are separated by the canvas rather than by borders, which is
   what keeps a matrix from looking like a table of boxes. */
const rampColor = (value: number): string => {
  if (value < 0.2) {
    return 'color-mix(in oklab, var(--s-raise) 88%, var(--f-info) 12%)';
  }

  if (value < 0.4) {
    return `color-mix(in oklab, var(--r-med-bg) ${String(55 + value * 60)}%, var(--s-raise))`;
  }

  if (value < 0.65) {
    return `color-mix(in oklab, var(--r-med) ${String(value * 58)}%, var(--r-med-bg))`;
  }

  return `color-mix(in oklab, var(--r-high) ${String(value * 74)}%, var(--r-high-bg))`;
};

interface HeatmapProps {
  readonly rows: readonly HeatCell[];
  readonly columns: readonly string[];
  readonly rowLabel: string;
  readonly onCellSelect?: (row: string, column: string) => void;
}

export const Heatmap = ({ rows, columns, rowLabel, onCellSelect }: HeatmapProps) => {
  const [hover, setHover] = useState<string | null>(null);
  const peak = Math.max(...rows.flatMap((row) => row.values));

  return (
    <div className="flex flex-col gap-1 px-4.5 py-3.5">
      <div className="flex items-center gap-[3px] pl-10">
        {columns.map((column) => (
          <span key={column} className="tick-label flex-1 text-center">
            {column}
          </span>
        ))}
      </div>

      {rows.map((row) => (
        <div key={row.row} className="flex items-center gap-[3px]">
          <span className="ident w-9 shrink-0 text-right text-meta text-dim">{row.row}</span>
          {row.values.map((value, index) => {
            const id = `${row.row}-${String(index)}`;
            const column = columns[index] ?? '';
            const isPeak = value === peak;

            return (
              <button
                key={id}
                type="button"
                onMouseEnter={() => setHover(id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(id)}
                onBlur={() => setHover(null)}
                onClick={() => onCellSelect?.(row.row, column)}
                aria-label={`${rowLabel} ${row.row}, ${column}, intensity ${(value * 100).toFixed(0)} percent`}
                className={`relative h-[19px] flex-1 rounded-[1px] transition-all duration-150 ${
                  hover === id ? 'z-1 scale-[1.08] ring-1 ring-info' : ''
                }`}
                style={{
                  background: rampColor(value),
                  boxShadow: isPeak ? 'inset 0 0 0 1px color-mix(in oklab, var(--r-high) 65%, transparent)' : undefined,
                }}
              >
                {hover === id && (
                  <span className="num absolute inset-0 grid place-items-center text-meta font-semibold text-ink">
                    {(value * 100).toFixed(0)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}

      <div className="mt-1.5 flex items-center gap-2 pl-10">
        <span className="tick-label">low</span>
        <span className="flex items-center gap-px">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((value) => (
            <span
              key={value}
              className="h-[7px] w-6 first:rounded-l-[1px] last:rounded-r-[1px]"
              style={{ background: rampColor(value) }}
            />
          ))}
        </span>
        <span className="tick-label">high</span>
        <span className="tick-label ml-auto">{rowLabel} × week · normalised exposure</span>
      </div>
    </div>
  );
};
