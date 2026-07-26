import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import {
  Banknote,
  Building2,
  Landmark,
  Layers,
  MapPin,
  Receipt,
  Smartphone,
  Store,
  User,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FlowEntity } from '@/components/viz/graph/flowModel';
import type { EntityKind, Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Custom entity node. One card design, seven (plus three forward-
   looking) entity types, each with its own glyph and corner treatment
   so a type is recognisable at any zoom level without reading text.
   ------------------------------------------------------------------ */

type NodeKind = EntityKind | 'transaction' | 'bank' | 'merchant';

const glyph: Record<NodeKind, LucideIcon> = {
  person: User,
  company: Building2,
  account: Landmark,
  offshore: Banknote,
  device: Smartphone,
  branch: MapPin,
  wallet: Wallet,
  transaction: Receipt,
  bank: Landmark,
  merchant: Store,
};

const kindLabel: Record<NodeKind, string> = {
  person: 'customer',
  company: 'company',
  account: 'account',
  offshore: 'offshore',
  device: 'device',
  branch: 'branch',
  wallet: 'wallet',
  transaction: 'transaction',
  bank: 'bank',
  merchant: 'merchant',
};

const severityStyle: Record<Severity, { border: string; text: string; bar: string; tint: string }> = {
  severe: {
    border: 'border-sev-line',
    text: 'text-sev',
    bar: 'bg-sev',
    tint: 'color-mix(in oklab, var(--r-high) 8%, var(--s-panel))',
  },
  review: {
    border: 'border-rev-line',
    text: 'text-rev',
    bar: 'bg-rev',
    tint: 'color-mix(in oklab, var(--r-med) 7%, var(--s-panel))',
  },
  clear: {
    border: 'border-line',
    text: 'text-ok',
    bar: 'bg-ok',
    tint: 'var(--s-panel)',
  },
};

export interface EntityNodeData extends Record<string, unknown> {
  readonly entity: FlowEntity;
  readonly isSelected: boolean;
  readonly isNeighbour: boolean;
  readonly dimmed: boolean;
  readonly matched: boolean;
}

export type EntityFlowNode = Node<EntityNodeData, 'entity'>;

export const EntityNode = ({ data }: NodeProps<EntityFlowNode>) => {
  const { entity, isSelected, dimmed, matched } = data;
  const style = severityStyle[entity.severity];
  const Icon = glyph[entity.kind as NodeKind] ?? User;
  const bars = Math.max(1, Math.round(entity.centrality * 4));

  return (
    <div
      className={`group relative flex w-[232px] flex-col rounded-[3px] border transition-all duration-200 ${
        isSelected ? 'border-info' : style.border
      } ${dimmed ? 'opacity-25 saturate-50' : 'opacity-100'}`}
      style={{
        height: 84,
        background: style.tint,
        boxShadow: isSelected
          ? '0 0 0 1px var(--f-info), 0 10px 26px -14px rgb(0 0 0 / 0.85)'
          : 'var(--elev-2)',
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />

      {/* severity spine */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-[3px] rounded-l-[2px] ${style.bar}`} />

      {/* search match marker */}
      {matched && !dimmed && (
        <span
          aria-hidden="true"
          className="absolute -top-[5px] -right-[5px] size-2 rotate-45 border border-info bg-info-bg"
        />
      )}

      <div className="flex items-center gap-2 px-2.5 pt-1.5">
        <Icon className={`size-3 shrink-0 ${dimmed ? 'text-faint' : style.text}`} aria-hidden="true" />
        <span className="ident truncate text-label text-ink">{entity.label}</span>
        {entity.isCluster && <Layers className="size-2.5 shrink-0 text-info" aria-hidden="true" />}
        <span className="ml-auto shrink-0 text-meta tracking-[0.12em] text-faint uppercase">
          {kindLabel[entity.kind as NodeKind] ?? entity.kind}
        </span>
      </div>

      <p className="truncate px-2.5 pt-0.5 text-meta text-dim">{entity.role}</p>

      <div className="mt-auto flex items-center gap-1.5 px-2.5 pb-1.5">
        <span aria-hidden="true" className="flex items-end gap-[1.5px]">
          {[0, 1, 2, 3].map((step) => (
            <span
              key={step}
              className={`w-[2px] rounded-[1px] ${step < bars ? style.bar : 'bg-rule'}`}
              style={{ height: `${String(3 + step * 1.6)}px` }}
            />
          ))}
        </span>
        <span className="num text-meta text-faint">centrality {entity.centrality.toFixed(2)}</span>
        {entity.hop === 2 && (
          <span className="ml-auto text-meta tracking-wider text-ghost uppercase">hop 2</span>
        )}
      </div>
    </div>
  );
};
