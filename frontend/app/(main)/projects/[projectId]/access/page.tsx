'use client';

/**
 * Access Points page — pixel-faithful migration of the puppyone-web
 * showcase's AccessView.
 *
 * Surface contract:
 *   - Master-detail layout: 280px sidebar (filter tabs + AP list) +
 *     a right detail pane (Identity, Scope, Quick Connect, Activity).
 *   - Single unified AP list — cli + agent + third-party integrations
 *     all live in the same sidebar, grouped by category. The earlier
 *     surface excluded built-ins (cli/agent) on the theory that the
 *     /data right panel was the canonical surface for them; review
 *     concluded that asymmetry was confusing — every actor that has a
 *     *connection* belongs here.
 *   - Pause / Resume wired to the dedicated backend endpoints
 *     (`/connectors/:id/pause` and `/resume`), revalidating the SWR
 *     cache afterwards so the status pill flips immediately.
 *   - The "Quick Connect" prompt is provider-aware: for cli/agent we
 *     reuse the `mut clone` prompt template (canonical, functional);
 *     for third-party connectors the panel surfaces a connection
 *     summary and links the user to the data view's right panel,
 *     which owns the actual auth/trigger config.
 *   - Recent activity is rendered as an empty state for now — the
 *     audit-log endpoint isn't AP-scoped yet. Wiring it up is on the
 *     follow-up backend pass (deliberately out of scope here per the
 *     "front-end first, back-end after" directive).
 *
 * This file is the route entry only. Tokens, constants, helpers,
 * icons, ui blocks, the Quick-Connect bodies, the connector card,
 * the sidebar, the detail panel, and the loading/empty states all
 * live alongside in `lib/`, `hooks/`, and `components/` — mirroring
 * the same `data/` and `home/` route layouts so a reader moving
 * between them sees one consistent shape.
 */

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { T } from './lib/tokens';
import { useAccessData } from './hooks/useAccessData';
import { AccessHeader, LoadingState, NoConnectorsState } from './components/page-shell';
import { ScopeSidebar } from './components/ScopeSidebar';
import { ScopeDetailPanel } from './components/ScopeDetailPanel';
import { ResizableSidebarColumn } from '@/components/sidebar/ResizableSidebarColumn';

/**
 * The page is *scope-keyed*: the sidebar lists each mount point (path)
 * as a single row — that's the user's organizational axis, the thing
 * they reason about ("who can see /docs?"). Provider-type categories
 * (CLI / Agent / MCP / …) are presented inside the right pane only,
 * grouping the connectors bound to the selected mount.
 *
 * Pause/resume is per-connector (a Set tracks in-flight pauses) so a
 * slow request on one card doesn't freeze the rest.
 */
export default function AccessPointsPage({
  params,
}: {
  readonly params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const router = useRouter();

  const {
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
  } = useAccessData(projectId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--po-canvas)' }}>
      <AccessHeader count={loading ? 0 : sortedScopes.length} />

      {loading ? (
        <LoadingState />
      ) : noScopes ? (
        <NoConnectorsState onCreateScope={() => router.push(`/projects/${projectId}/data`)} />
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          {/* Left sidebar — flat list, one row per mount point.
              Starts at the compact minimum; users with long mount-point
              paths or names can widen the rail and keep that preference. */}
          <ResizableSidebarColumn
            storageKey='scope-sidebar:access'
            defaultWidth={220}
            minWidth={220}
            maxWidth={480}
          >
            <ScopeSidebar
              scopes={sortedScopes}
              connectorsByScope={connectorsByScope}
              selectedScopeId={selectedScope?.id}
              onSelect={setSelectedScopeId}
            />
          </ResizableSidebarColumn>

          {/* Right detail pane — per-scope, with one card per access
              point bound to the selected mount. The AP switcher inside
              ScopeDetailPanel picks which card is visible at any time. */}
          {selectedScope && representativeConnector ? (
            <ScopeDetailPanel
              scope={selectedScope}
              connectors={selectedConnectors}
              projectId={projectId}
              onPauseResume={handlePauseResume}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              pendingConnectorIds={pendingConnectorIds}
              onScopeMutated={refresh}
              onScopeDeleted={clearScopeSelection}
            />
          ) : (
            <div style={{ flex: 1, background: T.bg }} />
          )}
        </div>
      )}
    </div>
  );
}
