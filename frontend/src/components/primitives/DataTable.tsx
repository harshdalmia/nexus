import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Kbd } from '@/components/primitives/Button';

export interface Column<T> {
  readonly id: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly align?: 'left' | 'right';
  readonly width?: string;
  readonly sortValue?: (row: T) => number | string;
  /** pinned columns stay put while the table scrolls horizontally */
  readonly pinned?: boolean;
}

interface DataTableProps<T> {
  readonly rows: readonly T[];
  readonly columns: ReadonlyArray<Column<T>>;
  readonly rowKey: (row: T) => string;
  readonly ariaLabel: string;
  readonly onActivate?: (row: T) => void;
  readonly renderPeek?: (row: T) => ReactNode;
  readonly rowSeverity?: (row: T) => 'severe' | 'review' | 'clear';
  readonly selectable?: boolean;
  readonly bulkActions?: (selected: readonly T[], clear: () => void) => ReactNode;
  readonly minWidth?: string;
  readonly emptyState?: ReactNode;
  readonly footNote?: ReactNode;
  readonly onActiveChange?: (row: T | null) => void;
}

type SortDirection = 'asc' | 'desc';

/* One table implementation for the whole product: sticky header, roving
   keyboard focus (j/k or arrows), space to peek inline, enter to open,
   x to select. Peek is an expanding row rather than a modal so the
   surrounding rows stay available as context. */
export const DataTable = <T,>({
  rows,
  columns,
  rowKey,
  ariaLabel,
  onActivate,
  renderPeek,
  rowSeverity,
  selectable = false,
  bulkActions,
  minWidth = '44rem',
  emptyState,
  footNote,
  onActiveChange,
}: DataTableProps<T>) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [peekKey, setPeekKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [sort, setSort] = useState<{ id: string; direction: SortDirection } | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const sortedRows = useMemo(() => {
    if (sort === null) {
      return rows;
    }

    const column = columns.find((item) => item.id === sort.id);

    if (column?.sortValue === undefined) {
      return rows;
    }

    const { sortValue } = column;

    return [...rows].sort((a, b) => {
      const left = sortValue(a);
      const right = sortValue(b);
      const order = typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right));

      return sort.direction === 'asc' ? order : -order;
    });
  }, [rows, columns, sort]);

  useEffect(() => {
    if (activeIndex > sortedRows.length - 1) {
      setActiveIndex(Math.max(0, sortedRows.length - 1));
    }
  }, [activeIndex, sortedRows.length]);

  useEffect(() => {
    onActiveChange?.(sortedRows[activeIndex] ?? null);
  }, [activeIndex, sortedRows, onActiveChange]);

  const focusRow = useCallback((index: number) => {
    const node = bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row="true"]')[index];
    node?.scrollIntoView({ block: 'nearest' });
  }, []);

  const toggleSelect = useCallback(
    (key: string) => {
      setSelected((current) =>
        current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
      );
    },
    [],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase();
    const last = sortedRows.length - 1;

    if (key === 'j' || key === 'arrowdown') {
      event.preventDefault();
      const next = Math.min(last, activeIndex + 1);
      setActiveIndex(next);
      focusRow(next);
      return;
    }

    if (key === 'k' || key === 'arrowup') {
      event.preventDefault();
      const next = Math.max(0, activeIndex - 1);
      setActiveIndex(next);
      focusRow(next);
      return;
    }

    const row = sortedRows[activeIndex];

    if (row === undefined) {
      return;
    }

    if (key === ' ' && renderPeek !== undefined) {
      event.preventDefault();
      const currentKey = rowKey(row);
      setPeekKey((value) => (value === currentKey ? null : currentKey));
      return;
    }

    if (key === 'enter' && onActivate !== undefined) {
      event.preventDefault();
      onActivate(row);
      return;
    }

    if (key === 'x' && selectable) {
      event.preventDefault();
      toggleSelect(rowKey(row));
      return;
    }

    if (key === 'escape') {
      setPeekKey(null);
    }
  };

  const toggleSort = (column: Column<T>) => {
    if (column.sortValue === undefined) {
      return;
    }

    setSort((current) => {
      if (current === null || current.id !== column.id) {
        return { id: column.id, direction: 'desc' };
      }

      return current.direction === 'desc'
        ? { id: column.id, direction: 'asc' }
        : null;
    });
  };

  const selectedRows = sortedRows.filter((row) => selected.includes(rowKey(row)));

  if (sortedRows.length === 0 && emptyState !== undefined) {
    return <>{emptyState}</>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="scroll min-h-0 flex-1 outline-none"
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use j and k to move, space to preview, enter to open.`}
        onKeyDown={handleKeyDown}
      >
        <table className="w-full border-separate border-spacing-0 text-body" style={{ minWidth }}>
          <caption className="sr-only">{ariaLabel}</caption>
          <thead className="thead sticky top-0 z-2">
            <tr>
              {selectable && (
                <th scope="col" className="dcell w-10 py-2.5 text-left">
                  <span className="sr-only">Select</span>
                </th>
              )}
              {columns.map((column) => {
                const isSorted = sort?.id === column.id;
                const sortable = column.sortValue !== undefined;

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ width: column.width }}
                    className={`dcell py-2.5 whitespace-nowrap ${
                      column.align === 'right' ? 'text-right' : 'text-left'
                    } ${column.pinned === true ? 'sticky left-0 z-1 bg-sunken' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column)}
                      disabled={!sortable}
                      className={`eyebrow inline-flex items-center gap-1 ${
                        sortable ? 'hover:text-ink' : 'cursor-default'
                      } ${isSorted ? 'text-info' : ''}`}
                    >
                      {column.header}
                      {isSorted &&
                        (sort.direction === 'asc' ? (
                          <ChevronUp className="size-2.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-2.5" aria-hidden="true" />
                        ))}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {sortedRows.map((row, index) => {
              const key = rowKey(row);
              const isActive = index === activeIndex;
              const isPeeking = peekKey === key;
              const severity = rowSeverity?.(row);

              return (
                <Fragment key={key}>
                  <tr
                    data-row="true"
                    data-active={isActive}
                    aria-selected={selected.includes(key)}
                    className="drow cursor-default"
                    onClick={() => {
                      setActiveIndex(index);
                      if (renderPeek !== undefined) {
                        setPeekKey((value) => (value === key ? null : key));
                      }
                    }}
                    onDoubleClick={() => onActivate?.(row)}
                  >
                    {selectable && (
                      <td className="dcell align-middle">
                        <input
                          type="checkbox"
                          checked={selected.includes(key)}
                          onChange={() => toggleSelect(key)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Select ${key}`}
                          className="size-4 rounded-[1px] accent-[var(--f-info)]"
                        />
                      </td>
                    )}
                    {columns.map((column, columnIndex) => (
                      <td
                        key={column.id}
                        className={`dcell truncate align-middle ${
                          column.align === 'right' ? 'text-right' : 'text-left'
                        } ${column.pinned === true ? 'sticky left-0 bg-panel' : ''} ${
                          columnIndex === 0 ? 'text-ink' : 'text-dim'
                        }`}
                      >
                        {columnIndex === 0 && severity !== undefined ? (
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={`h-3.5 w-[2.5px] shrink-0 rounded-[1px] ${
                                severity === 'severe' ? 'bg-sev' : severity === 'review' ? 'bg-rev' : 'bg-ok'
                              }`}
                            />
                            {column.render(row)}
                          </span>
                        ) : (
                          column.render(row)
                        )}
                      </td>
                    ))}
                  </tr>
                  {isPeeking && renderPeek !== undefined && (
                    <tr className="anim-fade">
                      <td
                        colSpan={columns.length + (selectable ? 1 : 0)}
                        className="dcell border-b border-line bg-raise py-4"
                      >
                        {renderPeek(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {(footNote !== undefined || selected.length > 0) && (
        <div className="flex shrink-0 items-center gap-4 border-t border-line bg-panel px-4 py-3 text-meta text-faint">
          {selected.length > 0 ? (
            <>
              <span className="num text-info">{selected.length} selected</span>
              {bulkActions?.(selectedRows, () => setSelected([]))}
            </>
          ) : (
            <>
              {footNote}
              <span className="ml-auto flex items-center gap-1.5">
                <Kbd>j</Kbd>
                <Kbd>k</Kbd>
                move
                <Kbd>space</Kbd>
                peek
                <Kbd>↵</Kbd>
                open
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};
