'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  NeedsActionItem,
  NeedsActionKindDef,
  NeedsActionRenderContext,
} from '@/lib/needsActionRegistry';

/**
 * One collapsible group inside the Needs Action section.
 *
 * The group is hidden entirely when its item list is empty — empty
 * groups would clutter the sidebar and create a "permanent empty
 * heading" eyesore that contradicts the "queue drains" framing.
 *
 * The group caller decides whether to mount us: it filters out
 * snoozed items + zero-count groups before invoking us.
 */
export function NeedsActionGroup({
  def,
  items,
  selectedItemId,
  onSelect,
  onResolved,
  onSnoozed,
  projectId,
}: {
  def: NeedsActionKindDef;
  items: NeedsActionItem[];
  selectedItemId: string | null;
  onSelect: (item: NeedsActionItem) => void;
  onResolved: (kind: string, itemId: string, result: { reason: string; commit_id?: string }) => void;
  onSnoozed: (kind: string, itemId: string) => void;
  projectId: string;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--po-hover)]"
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={2} style={{ color: 'var(--po-text-subtle)' }} />
        ) : (
          <ChevronDown size={12} strokeWidth={2} style={{ color: 'var(--po-text-subtle)' }} />
        )}
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: def.accentVar,
            flexShrink: 0,
          }}
        />
        <span className="text-[12px] font-medium text-[var(--po-text)]">{def.label}</span>
        <span className="ml-auto text-[11px] font-medium text-[var(--po-text-subtle)]">
          {items.length}
        </span>
      </button>
      {!collapsed && (
        <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((item) => {
            const ctx: NeedsActionRenderContext = {
              projectId,
              isSelected: selectedItemId === item.id,
              onSelect: () => onSelect(item),
              onResolved: (result) => onResolved(item.kind, item.id, result),
              onSnoozed: () => onSnoozed(item.kind, item.id),
            };
            return (
              <React.Fragment key={item.id}>{def.renderRow(item, ctx)}</React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
