'use client';

import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { listKinds, type NeedsActionItem, type ResolvedResult } from '@/lib/needsActionRegistry';
import { isSnoozed } from '@/lib/needsActionSnooze';
import { NeedsActionGroup } from './NeedsActionGroup';

// Side-effect import: populates the kind registry. Pulled in here so
// the Section is the single place that bootstraps the registry — any
// caller that mounts <NeedsActionSection/> gets the v1 kinds. New
// plugin kinds are added by extending the barrel at
// ``components/items/index.ts``.
import './items';

/** Selection carried by the page so the right pane can switch between
 *  a commit and a needs-action item. The history page owns this; we
 *  only fire ``onSelect`` to update it and read ``selectedItemId`` to
 *  highlight the active row. */
export interface NeedsActionSelection {
  kind: string;
  itemId: string;
}

export interface NeedsActionSectionProps {
  projectId: string;
  selected: NeedsActionSelection | null;
  onSelect: (selection: NeedsActionSelection, item: NeedsActionItem) => void;
  /** Called when an item is removed (resolved / rejected / dismissed
   *  / snoozed). The page uses this to refresh history (a resolved
   *  conflict produces a new commit) and to clear the selection. */
  onItemRemoved: (selection: NeedsActionSelection, result: ResolvedResult) => void;
}

/** SWR refresh fallback for kinds that don't set their own interval. */
const DEFAULT_REFRESH_MS = 30_000;

/**
 * Needs Action section — sits above the History filters in the
 * Changes sidebar. Renders one ``<NeedsActionGroup>`` per registered
 * kind that has at least one live item.
 *
 * Per PUP-5 §6 D2: when zero items across all kinds, render the
 * "No pending actions" one-liner so the section heading is a stable
 * landmark.
 *
 * Per kind: fetch failures are absorbed locally so a single broken
 * plugin doesn't take down the section. We surface a small "couldn't
 * load X" hint instead.
 */
export function NeedsActionSection({
  projectId,
  selected,
  onSelect,
  onItemRemoved,
}: NeedsActionSectionProps) {
  const kinds = useMemo(() => listKinds(), []);

  // Per-kind localStorage snooze tracking. We re-evaluate ``isSnoozed``
  // on every render — cheap (a few localStorage reads per page) and
  // ensures expired snoozes resurface without explicit re-fetch.
  const [snoozeTick, setSnoozeTick] = useState(0);

  return (
    <div
      style={{
        borderLeft: '2px solid color-mix(in srgb, var(--po-warning) 50%, transparent)',
        background: 'color-mix(in srgb, var(--po-warning) 4%, transparent)',
        padding: '8px 8px 8px 10px',
        margin: '8px 8px 12px 8px',
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--po-text-subtle)',
          padding: '0 2px 6px',
        }}
      >
        Needs action
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {kinds.length === 0 ? (
          <EmptyState />
        ) : (
          <KindRows
            kinds={kinds}
            projectId={projectId}
            selected={selected}
            onSelect={onSelect}
            onItemRemoved={onItemRemoved}
            snoozeTick={snoozeTick}
            onSnoozeTick={() => setSnoozeTick((n) => n + 1)}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        padding: '6px 4px 4px',
        fontSize: 12,
        color: 'var(--po-text-subtle)',
        fontStyle: 'italic',
      }}
    >
      No pending actions
    </div>
  );
}

/** Inner component that iterates kinds. Split out so each kind owns
 *  its own SWR subscription (independent refresh + error isolation). */
function KindRows({
  kinds,
  projectId,
  selected,
  onSelect,
  onItemRemoved,
  snoozeTick,
  onSnoozeTick,
}: {
  kinds: readonly ReturnType<typeof listKinds>[number][];
  projectId: string;
  selected: NeedsActionSelection | null;
  onSelect: NeedsActionSectionProps['onSelect'];
  onItemRemoved: NeedsActionSectionProps['onItemRemoved'];
  snoozeTick: number;
  onSnoozeTick: () => void;
}) {
  // Pre-flight: collect live items + per-kind errors via independent
  // SWR subscriptions. We render the grid AFTER this pass so we can
  // also compute the cross-kind empty state.
  const groups = kinds.map((def) => {
    return (
      <KindGroupContainer
        key={def.kind}
        def={def}
        projectId={projectId}
        selected={selected}
        onSelect={onSelect}
        onItemRemoved={onItemRemoved}
        snoozeTick={snoozeTick}
        onSnoozeTick={onSnoozeTick}
      />
    );
  });

  return <>{groups}</>;
}

function KindGroupContainer({
  def,
  projectId,
  selected,
  onSelect,
  onItemRemoved,
  snoozeTick,
  onSnoozeTick,
}: {
  def: ReturnType<typeof listKinds>[number];
  projectId: string;
  selected: NeedsActionSelection | null;
  onSelect: NeedsActionSectionProps['onSelect'];
  onItemRemoved: NeedsActionSectionProps['onItemRemoved'];
  snoozeTick: number;
  onSnoozeTick: () => void;
}) {
  const refreshInterval = def.refreshIntervalMs ?? DEFAULT_REFRESH_MS;
  const { data, error, mutate } = useSWR<NeedsActionItem[]>(
    [`needs-action:${def.kind}`, projectId],
    () => def.fetchItems(projectId) as Promise<NeedsActionItem[]>,
    {
      refreshInterval,
      // Pause polling when the document is hidden — saves background
      // chatter when the user has switched tabs.
      refreshWhenHidden: false,
      keepPreviousData: true,
    },
  );

  // Filter snoozed items. ``snoozeTick`` is a render-dep so the user
  // sees the row vanish immediately after they click snooze. Without
  // it the filter would only re-run on SWR refresh.
  const visibleItems = useMemo(() => {
    if (!data) return [] as NeedsActionItem[];
    return data.filter(
      (it) => !isSnoozed({ projectId, kind: def.kind, id: it.id }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, projectId, def.kind, snoozeTick]);

  const handleSelect = useCallback(
    (item: NeedsActionItem) => {
      onSelect({ kind: def.kind, itemId: item.id }, item);
    },
    [def.kind, onSelect],
  );

  const handleResolved = useCallback(
    (kind: string, itemId: string, result: { reason: string; commit_id?: string }) => {
      // Refresh our own list (the resolved row drops out) AND notify
      // the page so it can refresh history + clear selection.
      void mutate();
      onItemRemoved(
        { kind, itemId },
        {
          reason: (result.reason as ResolvedResult['reason']) ?? 'resolved',
          commit_id: result.commit_id,
        },
      );
    },
    [mutate, onItemRemoved],
  );

  const handleSnoozed = useCallback(
    (kind: string, itemId: string) => {
      onSnoozeTick();
      onItemRemoved({ kind, itemId }, { reason: 'dismissed' });
    },
    [onSnoozeTick, onItemRemoved],
  );

  if (error) {
    return (
      <div
        style={{
          padding: '4px 6px',
          fontSize: 11,
          color: 'var(--po-text-subtle)',
          fontStyle: 'italic',
        }}
      >
        ({def.label} unavailable)
      </div>
    );
  }

  if (visibleItems.length === 0) return null;

  const selectedItemIdForThisKind =
    selected && selected.kind === def.kind ? selected.itemId : null;

  return (
    <NeedsActionGroup
      def={def}
      items={visibleItems}
      selectedItemId={selectedItemIdForThisKind}
      onSelect={handleSelect}
      onResolved={handleResolved}
      onSnoozed={handleSnoozed}
      projectId={projectId}
    />
  );
}

/** Re-export so the page can build right-pane detail without a
 *  second registry lookup. ``getKind(kind).renderDetail(item, ctx)``
 *  remains the canonical path, but exposing the type from one place
 *  keeps the consumer surface tight. */
export { listKinds, getKind, type NeedsActionItem } from '@/lib/needsActionRegistry';
