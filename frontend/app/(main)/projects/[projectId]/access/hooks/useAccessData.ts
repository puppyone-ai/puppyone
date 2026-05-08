'use client';

/**
 * useAccessData — single hook owning every piece of state the access
 * page reads from the network.
 *
 * Consolidates what used to be ~120 lines of inline logic at the top
 * of the original `AccessPointsPage`:
 *
 *   - Two SWR queries  (scopes, connectors) with revalidate config
 *   - Bucketing        (connectors → Map<scopeId, Connector[]>)
 *   - Filtering+sort   (only scopes with ≥1 connector, root-first)
 *   - Selection state  (selectedScopeId + auto-select-first effect)
 *   - Pause/resume     (pendingConnectorIds Set + handlePauseResume)
 *
 * Returning everything as a single object lets `page.tsx` destructure
 * the bits it needs without paying the cost of re-running SWR on the
 * same key. The `loading`/`noScopes` flags are derived here so the
 * page never re-implements the "data still loading?" check.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  deleteConnector,
  listConnectors,
  listScopes,
  pauseConnector,
  resumeConnector,
  updateConnector,
  type Connector,
  type RepoScope,
} from '@/lib/repoApi';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';

/**
 * Patch shape accepted by `handleUpdate`. Mirrors `repoApi.updateConnector`
 * but typed to the small set of fields the access-page UI is allowed to
 * touch — name, direction (third-party only), trigger, and provider config.
 * `oauth_connection_id` and `status` are deliberately omitted: status flips
 * go through the dedicated `handlePauseResume` path so we keep one source
 * of truth for pending-state UI and the dedicated /pause /resume endpoints
 * remain authoritative; OAuth swap is a flow we haven't designed yet.
 */
export type ConnectorEditPatch = Partial<{
  name: string;
  direction: 'inbound' | 'outbound' | 'bidirectional';
  trigger: { type: 'manual' | 'scheduled' | 'on_change'; config?: Record<string, unknown> };
  config: Record<string, unknown>;
}>;

export interface UseAccessDataResult {
  loading: boolean;
  noScopes: boolean;
  sortedScopes: RepoScope[];
  connectorsByScope: Map<string, Connector[]>;
  selectedScope: RepoScope | undefined;
  selectedConnectors: Connector[];
  representativeConnector: Connector | undefined;
  pendingConnectorIds: ReadonlySet<string>;
  setSelectedScopeId: (id: string) => void;
  handlePauseResume: (connectorId: string) => Promise<void>;
  /** PATCH a connector with the given partial; revalidates SWR on success. */
  handleUpdate: (connectorId: string, patch: ConnectorEditPatch) => Promise<void>;
  /** DELETE a connector. Server rejects built-ins (cli/agent/filesystem); UI should hide the action for those. */
  handleDelete: (connectorId: string) => Promise<void>;
  /** Refresh both scopes + connectors. Used as the `onMutated` callback for the
   *  inline scope settings block (saving / rotating / etc.). Returning the
   *  resolved value keeps the caller's awaitable contract. */
  refresh: () => Promise<unknown>;
  /** Clear the active scope selection — the next render picks a new
   *  first-scope automatically. Used after the user deletes the active
   *  scope from the inline settings block. */
  clearScopeSelection: () => void;
}

export function useAccessData(projectId: string): UseAccessDataResult {
  const { data: scopes, mutate: mutateScopes } = useSWR(
    projectId ? ['repo-scopes', projectId] : null,
    () => listScopes(projectId),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );
  const { data: connectors, mutate: mutateConnectors } = useSWR(
    projectId ? ['repo-connectors', projectId] : null,
    () => listConnectors(projectId),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 60000 },
  );

  const [selectedScopeId, setSelectedScopeId] = useState<string | null>(null);
  const [pendingConnectorIds, setPendingConnectorIds] = useState<ReadonlySet<string>>(() => new Set());

  // Bucket connectors by scope_id; inside each bucket sort built-ins
  // (cli, agent) first, then by created_at.
  //
  // When the AI Agent feature flag is off (see
  // `frontend/lib/featureFlags.ts`) we drop `agent` connectors at
  // this single chokepoint instead of asking every downstream
  // component (ScopeDetailPanel, ConnectorCard, ScopeSidebar, header
  // counts, etc.) to filter individually. The agent records still
  // exist server-side and the rest of the page (selection, pause,
  // delete) keeps the same shape — there are simply no agent rows
  // to surface while the feature is hidden.
  const connectorsByScope = useMemo(() => {
    const m = new Map<string, Connector[]>();
    (connectors ?? []).forEach((c) => {
      if (!AI_AGENT_ENABLED && c.provider === 'agent') return;
      if (!m.has(c.scope_id)) m.set(c.scope_id, []);
      m.get(c.scope_id)!.push(c);
    });
    for (const list of m.values()) {
      list.sort((a, b) => {
        const order = (c: Connector) => (c.provider === 'cli' ? 0 : c.provider === 'agent' ? 1 : 2);
        return order(a) - order(b) || a.created_at.localeCompare(b.created_at);
      });
    }
    return m;
  }, [connectors]);

  // Only render scopes that have at least one connector — empty
  // scopes belong in the data view's scope settings, not here.
  const sortedScopes = useMemo(() => {
    if (!scopes) return [];
    return [...scopes]
      .filter((s) => (connectorsByScope.get(s.id)?.length ?? 0) > 0)
      .sort((a, b) => {
        if (a.is_root && !b.is_root) return -1;
        if (!a.is_root && b.is_root) return 1;
        return a.created_at.localeCompare(b.created_at);
      });
  }, [scopes, connectorsByScope]);

  // Auto-select the first scope on first load / when the current
  // selection disappears.
  useEffect(() => {
    if (selectedScopeId && sortedScopes.some((s) => s.id === selectedScopeId)) return;
    const first = sortedScopes[0];
    if (first) setSelectedScopeId(first.id);
  }, [sortedScopes, selectedScopeId]);

  const selectedScope = useMemo(
    () => sortedScopes.find((s) => s.id === selectedScopeId) ?? sortedScopes[0],
    [sortedScopes, selectedScopeId],
  );
  const selectedConnectors = useMemo(
    () => (selectedScope ? connectorsByScope.get(selectedScope.id) ?? [] : []),
    [connectorsByScope, selectedScope],
  );
  const representativeConnector = selectedConnectors[0];

  // Tiny helper — every async action below follows the same
  // "mark pending → run → revalidate → unmark pending" rhythm. Inlining
  // this three times read worse than naming the rhythm once.
  const withPending = useCallback(
    async (connectorId: string, fn: () => Promise<void>) => {
      setPendingConnectorIds((prev) => {
        if (prev.has(connectorId)) return prev;
        const next = new Set(prev);
        next.add(connectorId);
        return next;
      });
      try {
        await fn();
      } finally {
        setPendingConnectorIds((prev) => {
          if (!prev.has(connectorId)) return prev;
          const next = new Set(prev);
          next.delete(connectorId);
          return next;
        });
      }
    },
    [],
  );

  const handlePauseResume = useCallback(async (connectorId: string) => {
    await withPending(connectorId, async () => {
      try {
        const target = (connectors ?? []).find((c) => c.id === connectorId);
        if (!target) return;
        const isActive = target.status === 'active' || target.status === 'syncing';
        if (isActive) {
          await pauseConnector(projectId, connectorId);
        } else {
          await resumeConnector(projectId, connectorId);
        }
        await mutateConnectors();
      } catch (err) {
        console.error('Failed to toggle connector status:', err);
      }
    });
  }, [connectors, projectId, mutateConnectors, withPending]);

  const handleUpdate = useCallback(
    async (connectorId: string, patch: ConnectorEditPatch) => {
      await withPending(connectorId, async () => {
        try {
          await updateConnector(projectId, connectorId, patch);
          await mutateConnectors();
        } catch (err) {
          console.error('Failed to update connector:', err);
          // Re-throw so the caller (inline edit input) can surface a
          // local error state and revert the optimistic display.
          throw err;
        }
      });
    },
    [projectId, mutateConnectors, withPending],
  );

  const handleDelete = useCallback(
    async (connectorId: string) => {
      await withPending(connectorId, async () => {
        try {
          await deleteConnector(projectId, connectorId);
          await mutateConnectors();
        } catch (err) {
          console.error('Failed to delete connector:', err);
          throw err;
        }
      });
    },
    [projectId, mutateConnectors, withPending],
  );

  const loading = scopes === undefined || connectors === undefined;
  const noScopes = !loading && sortedScopes.length === 0;

  // Joint refresh — scope edits (rename / mode / exclude) only touch
  // `repo-scopes`, but a delete cascades to connectors so we always
  // refresh both. Single function keeps the call-site contract small.
  const refresh = useCallback(async () => {
    await Promise.all([mutateScopes(), mutateConnectors()]);
  }, [mutateScopes, mutateConnectors]);

  // After the active scope is deleted from the inline settings block,
  // null the selection — the auto-select-first effect picks up an
  // adjacent scope on the next render so the user lands on something
  // meaningful instead of a dead detail pane.
  const clearScopeSelection = useCallback(() => {
    setSelectedScopeId(null);
  }, []);

  return {
    loading,
    noScopes,
    sortedScopes,
    connectorsByScope,
    selectedScope,
    selectedConnectors,
    representativeConnector,
    pendingConnectorIds,
    setSelectedScopeId,
    handlePauseResume,
    handleUpdate,
    handleDelete,
    refresh,
    clearScopeSelection,
  };
}
