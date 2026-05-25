'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { PulseGrid } from '@/components/loading';
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
  onSummaryChange?: (summary: NeedsActionSummary) => void;
}

/** SWR refresh fallback for kinds that don't set their own interval. */
const DEFAULT_REFRESH_MS = 30_000;

type KindSnapshot = {
  count: number;
  loading: boolean;
  error: boolean;
};

export type NeedsActionSummary = {
  count: number;
  loading: boolean;
  hasErrors: boolean;
};

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
  onSummaryChange,
}: NeedsActionSectionProps) {
  const kinds = useMemo(() => listKinds(), []);
  const [expanded, setExpanded] = useState(true);
  const [snapshots, setSnapshots] = useState<Record<string, KindSnapshot>>({});

  // Per-kind localStorage snooze tracking. We re-evaluate ``isSnoozed``
  // on every render — cheap (a few localStorage reads per page) and
  // ensures expired snoozes resurface without explicit re-fetch.
  const [snoozeTick, setSnoozeTick] = useState(0);

  const handleSnapshot = useCallback((kind: string, snapshot: KindSnapshot) => {
    setSnapshots((current) => {
      const previous = current[kind];
      if (
        previous
        && previous.count === snapshot.count
        && previous.loading === snapshot.loading
        && previous.error === snapshot.error
      ) {
        return current;
      }
      return { ...current, [kind]: snapshot };
    });
  }, []);

  const knownSnapshots = kinds
    .map((kind) => snapshots[kind.kind])
    .filter((snapshot): snapshot is KindSnapshot => Boolean(snapshot));
  const allKnown = knownSnapshots.length === kinds.length;
  const totalCount = knownSnapshots.reduce((sum, snapshot) => sum + snapshot.count, 0);
  const loading = !allKnown || knownSnapshots.some((snapshot) => snapshot.loading);
  const hasErrors = knownSnapshots.some((snapshot) => snapshot.error);

  useEffect(() => {
    onSummaryChange?.({
      count: totalCount,
      loading,
      hasErrors,
    });
  }, [hasErrors, loading, onSummaryChange, totalCount]);

  return (
    <section
      style={{
        background: 'var(--po-canvas)',
        display: 'flex',
        flex: '0 0 auto',
        flexDirection: 'column',
        minHeight: 0,
        borderBottom: '1px solid var(--po-divider)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        style={{
          width: '100%',
          height: 42,
          minHeight: 42,
          color: 'var(--po-text)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px 0 16px',
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: 'var(--po-text-subtle)',
            flexShrink: 0,
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
          }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--po-text)',
          }}
        >
          Needs action
        </span>
        {totalCount > 0 ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 20,
              padding: '0 6px',
              borderRadius: 999,
              color: 'var(--po-warning)',
              fontSize: 11,
              fontWeight: 500,
              whiteSpace: 'nowrap',
            }}
          >
            {totalCount} open
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div
          className="custom-scrollbar"
          style={{
            flex: '0 0 auto',
            minHeight: 0,
            overflowY: 'visible',
            padding: totalCount > 0 ? '4px 8px 10px' : '0 8px 14px 36px',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          {kinds.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              <KindRows
                kinds={kinds}
                projectId={projectId}
                selected={selected}
                onSelect={onSelect}
                onItemRemoved={onItemRemoved}
                snoozeTick={snoozeTick}
                onSnoozeTick={() => setSnoozeTick((n) => n + 1)}
                onSnapshot={handleSnapshot}
              />
              {loading && totalCount === 0 ? <LoadingState /> : null}
              {!loading && hasErrors && totalCount === 0 ? <EmptyState hasErrors /> : null}
              {!loading && !hasErrors && allKnown && totalCount === 0 ? <EmptyState /> : null}
            </>
          )}
        </div>
      ) : (
        <KindRows
          kinds={kinds}
          projectId={projectId}
          selected={selected}
          onSelect={onSelect}
          onItemRemoved={onItemRemoved}
          snoozeTick={snoozeTick}
          onSnoozeTick={() => setSnoozeTick((n) => n + 1)}
          onSnapshot={handleSnapshot}
          renderGroups={false}
        />
      )}
    </section>
  );
}

function LoadingState() {
  return (
    <div
      style={{
        minHeight: 44,
        padding: '0 4px 2px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <PulseGrid size="sm" ariaLabel="Loading pending reviews" />
    </div>
  );
}

function EmptyState({
  hasErrors = false,
}: {
  readonly hasErrors?: boolean;
}) {
  return (
    <div
      style={{
        minHeight: 44,
        padding: '0 4px 2px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        fontSize: 12,
        color: 'var(--po-text-subtle)',
        lineHeight: '18px',
        textAlign: 'left',
      }}
    >
      {hasErrors ? 'Some pending checks are unavailable.' : 'No pending reviews.'}
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
  onSnapshot,
  renderGroups = true,
}: {
  kinds: readonly ReturnType<typeof listKinds>[number][];
  projectId: string;
  selected: NeedsActionSelection | null;
  onSelect: NeedsActionSectionProps['onSelect'];
  onItemRemoved: NeedsActionSectionProps['onItemRemoved'];
  snoozeTick: number;
  onSnoozeTick: () => void;
  onSnapshot: (kind: string, snapshot: KindSnapshot) => void;
  renderGroups?: boolean;
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
        onSnapshot={onSnapshot}
        renderGroup={renderGroups}
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
  onSnapshot,
  renderGroup,
}: {
  def: ReturnType<typeof listKinds>[number];
  projectId: string;
  selected: NeedsActionSelection | null;
  onSelect: NeedsActionSectionProps['onSelect'];
  onItemRemoved: NeedsActionSectionProps['onItemRemoved'];
  snoozeTick: number;
  onSnoozeTick: () => void;
  onSnapshot: (kind: string, snapshot: KindSnapshot) => void;
  renderGroup: boolean;
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

  useEffect(() => {
    onSnapshot(def.kind, {
      count: visibleItems.length,
      loading: !data && !error,
      error: Boolean(error),
    });
  }, [data, def.kind, error, onSnapshot, visibleItems.length]);

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

  if (!renderGroup) {
    return null;
  }

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
