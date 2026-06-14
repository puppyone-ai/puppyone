'use client';

/**
 * ScopeDetailPanel — right rail of the access page.
 *
 * The user's mental model:
 *
 *   1. The left sidebar lists *mount points* (paths). Pick one.
 *   2. Each mount point has multiple *Access Points* bound to it
 *      (a CLI access point, an Agent access point, an MCP one, …).
 *      Each AP has its own database-stored name, status, and prompt.
 *   3. CLI / Agent / MCP / Sandbox / Third-party are *not* "tabs of a
 *      configuration page" — they're fundamentally distinct entities.
 *      So the switcher renders one card *per access point*, not one
 *      tab per type bucket. Picking a card swaps the detail view to
 *      that AP's name + attributes + prompt + configuration.
 *
 * Layout:
 *
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  📁 Workspace root  /  [r] [w]                  [Edit]    │  ← compact scope strip
 *   │                                                            │
 *   │  ACCESS POINTS                                             │
 *   │  ┌───────────┐ ┌───────────┐                              │
 *   │  │ [icon]    │ │ [icon]    │                              │
 *   │  │ CLI    ●  │ │ AGENT  ●  │                              │
 *   │  │ Puppyone… │ │ Hello AI  │                              │
 *   │  └───────────┘ └───────────┘                              │
 *   │   ↑ selected     unselected                                │
 *   │                                                            │
 *   │  Puppyone CLI                       [Pause] [⋮]           │  ← AP NAME (page header)
 *   │  CLI agent · Two-way · ● Active · Never                   │
 *   │  ─────────────────────────────────────                    │
 *   │  PROMPT FOR AI AGENT                                       │
 *   │  [prompt block with centered Copy CTA]                    │
 *   │  CONFIGURATION                                             │
 *   │  [config table]                                            │
 *   │  RECENT ACTIVITY                                           │
 *   │  [activity placeholder]                                    │
 *   └───────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { getProjectAuditLogs } from '@/lib/contentTreeApi';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { T } from '../lib/tokens';
import { SectionLabel } from './ui-blocks';
import { SandboxConnectCard } from './SandboxConnectCard';
import { ScopeSettingsBlock } from '../../data/components/access-points/ScopeSettingsBlock';
import type { ConnectorEditPatch } from '../hooks/useAccessData';
import { AccessActivitySection, filterAccessActivityLogs } from './AccessActivity';
import { ConnectorList } from './ConnectorMethodList';
import { ScopePageHeader, SettingsSection } from './ScopeHeader';

const SHOW_ACCESS_ACTIVITY = false;

// ─── Detail pane root ────────────────────────────────────────────────

export function ScopeDetailPanel({
  scope,
  connectors,
  projectId,
  onPauseResume,
  onUpdate,
  onDelete,
  pendingConnectorIds,
  onScopeMutated,
  onScopeDeleted,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly projectId: string;
  readonly onPauseResume: (id: string) => void;
  readonly onUpdate: (id: string, patch: ConnectorEditPatch) => Promise<void>;
  readonly onDelete: (id: string) => Promise<void>;
  readonly pendingConnectorIds: ReadonlySet<string>;
  /** Refresh both `repo-scopes` and `repo-connectors` SWR caches after
   *  a save / rotate / delete inside the inline settings block. */
  readonly onScopeMutated: () => Promise<unknown>;
  /** Notify the parent that the active scope was deleted, so it can
   *  clear its `selectedScopeId` and let the auto-select-first effect
   *  pick up an adjacent scope on the next render. */
  readonly onScopeDeleted: () => void;
}) {
  // Track the currently-expanded access point. Defaults to collapsed
  // so first-time users see the compact access point list before drilling
  // into setup/configuration details.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);

  // Inline scope-settings toggle. The `Edit` button on the strip flips
  // this; we mount `ScopeSettingsBlock` right under the strip so the
  // user never leaves the access page. Auto-collapses when the user
  // navigates to a different scope so dirty edits don't ride along.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    setSettingsOpen(false);
    setSettingsDirty(false);
    setSelectedConnectorId(null);
  }, [scope?.id]);

  const handleSelectConnector = useCallback((connectorId: string) => {
    setSelectedConnectorId((current) => {
      if (current === connectorId) {
        return null;
      }
      return connectorId;
    });
  }, []);

  const handleToggleSettings = useCallback(() => {
    if (settingsOpen && settingsDirty) {
      const ok = globalThis.confirm(
        'Discard unsaved scope edits?',
      );
      if (!ok) return;
      setSettingsDirty(false);
    }
    setSettingsOpen((v) => !v);
  }, [settingsOpen, settingsDirty]);

  const handleScopeDeleted = useCallback(() => {
    setSettingsOpen(false);
    setSettingsDirty(false);
    onScopeDeleted();
  }, [onScopeDeleted]);

  const visibleConnectors = connectors;

  useEffect(() => {
    if (visibleConnectors.length === 0) {
      setSelectedConnectorId(null);
      return;
    }
    if (selectedConnectorId == null) return;
    const stillExists = visibleConnectors.some((c) => c.id === selectedConnectorId);
    if (!stillExists) setSelectedConnectorId(null);
  }, [selectedConnectorId, visibleConnectors]);

  const selectedConnector = useMemo(
    () =>
      visibleConnectors.find((c) => c.id === selectedConnectorId) ?? null,
    [selectedConnectorId, visibleConnectors],
  );
  const {
    data: auditData,
    error: auditError,
  } = useSWR(
    SHOW_ACCESS_ACTIVITY && projectId ? ['access-project-audit-logs', projectId] : null,
    () => getProjectAuditLogs(projectId, 150),
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 15000 },
  );
  const accessActivity = useMemo(
    () => filterAccessActivityLogs(auditData?.logs ?? [], scope).slice(0, 7),
    [auditData?.logs, scope],
  );
  const activityLoading = !auditError && auditData === undefined;

  return (
    <div
      key={scope?.id ?? 'no-scope'}
      style={{
        flex: 1,
        minWidth: 0,
        overflow: 'auto',
        background: T.bg,
        animation: `puppyone-access-fade-in 200ms ${T.ease}`,
      }}
    >
      <div
        style={{
          maxWidth: PROJECT_CONTENT_RAIL_WIDTH,
          margin: '0 auto',
          padding: '20px 24px 40px',
        }}
      >
        {/* PAGE HEADER — `scope.name` at h1 scale with aggregate status
            beneath. The right side stays intentionally light: settings
            live here, while pause/resume belongs to each access point. */}
        <ScopePageHeader
          scope={scope}
          connectors={visibleConnectors}
          settingsOpen={settingsOpen}
          settingsDirty={settingsDirty}
          onToggleSettings={handleToggleSettings}
        />

        {/* SETTINGS — opened from the header gear. The collapsed
            placeholder row is intentionally gone so the boundary row
            can stay visually adjacent to the title. */}
        {scope ? (
          <SettingsSection open={settingsOpen}>
            <ScopeSettingsBlock
              scope={scope}
              projectId={projectId}
              onMutated={onScopeMutated}
              onScopeDeleted={handleScopeDeleted}
              onDirtyChange={setSettingsDirty}
            />
          </SettingsSection>
        ) : null}

        {/* CONNECTORS — the page used to call this section "Access
            points" but the underlying entity in the data model (and in
            every API path / SQL table) is `connector`. Naming the UI
            section the same name eliminates the translation step. */}
        {visibleConnectors.length > 0 ? (
          <>
            <SectionLabel
              right={
                <span
                  style={{
                    fontSize: 12,
                    color: T.text2,
                    fontFamily: T.fontSans,
                    fontWeight: 400,
                  }}
                >
                  {visibleConnectors.length === 1 ? '1 way in' : `${visibleConnectors.length} ways in`}
                </span>
              }
            >
              Connectors
            </SectionLabel>
            <ConnectorList
              scope={scope}
              connectors={visibleConnectors}
              selectedId={selectedConnector?.id ?? null}
              onSelect={handleSelectConnector}
              onPauseResume={onPauseResume}
              onUpdate={onUpdate}
              pendingConnectorIds={pendingConnectorIds}
            />
            {SHOW_ACCESS_ACTIVITY ? (
              <AccessActivitySection
                rows={accessActivity}
                loading={activityLoading}
                errored={!!auditError}
              />
            ) : null}
          </>
        ) : (
          <div
            style={{
              marginTop: 18,
              padding: '14px 16px',
              borderRadius: 8,
              border: `1px dashed ${T.cardBorder}`,
              background: T.cardBg,
              fontSize: 14,
              color: T.text2,
              fontFamily: T.fontSans,
              fontStyle: 'italic',
            }}
          >
            No connectors bound to this scope yet.
          </div>
        )}

        {/* Remote Dev (SSH) — scope-level sandbox-as-access-point surface.
            Not a connector row; keyed by the scope itself. */}
        {scope ? <SandboxConnectCard scope={scope} projectId={projectId} /> : null}
      </div>

      <style>{`
        @keyframes puppyone-access-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes puppyone-access-settings-slide {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
