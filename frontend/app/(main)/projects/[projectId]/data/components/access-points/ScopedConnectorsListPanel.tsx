'use client';

/**
 * ScopedConnectorsListPanel — per-scope connector list (redesign-2026-05-08).
 *
 * Replaces the project-wide AccessPointsListPanel. Once a scope is
 * selected, the body stacks two primary sections vertically + an
 * optional Settings sub-panel:
 *
 *   ① ConnectMethodsBlock        — Terminal CLI, Git Remote, AI Agent
 *                                  (the three default ways to access this
 *                                  folder — DB-trigger-backed cli + agent
 *                                  connectors fan out into three UI cards)
 *   ② Integrations               — third-party providers (notion / gmail
 *                                  / github / url / ...) with a + Add CTA
 *
 * The header is intentionally one line. Path lives in a quiet body
 * metadata block above ①, with the permission mode as a small status
 * next to the path and Settings as the action on the right. Clicking
 * Settings mounts the ScopeSettingsBlock above ① (Permissions →
 * Excludes → Access key → Name → Identity → Danger zone).
 *
 * Dirty edits in Settings get reported up via onDirtyChange; the
 * panel's [⚙ Settings] toggle and [×] close button confirm before
 * silently discarding them. A muted "•" badge appears on the
 * Settings toggle while dirty.
 *
 * No parent-child inheritance: a folder shows ONLY connectors of its
 * exact-match scope (per Q1 decision 2026-05-03). Folders that aren't
 * scopes show CreateAccessPointCTACard + AllAccessPointsList instead.
 *
 * Sub-components live in sibling files (see ./AccessPointRow,
 * ./ScopeSettingsBlock, etc.) — this file is the orchestrator that
 * decides which of those to mount based on the current scope state.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { PanelShell } from '../PanelShell';
import { FolderIcon } from '../explorer';
import { ConnectorCard } from './ConnectorCard';
import { ScopeSettingsBlock } from './ScopeSettingsBlock';
import { AllAccessPointsList } from './AllAccessPointsList';
import { CreateAccessPointCTACard } from './CreateAccessPointCTACard';
import { ConnectMethodsBlock } from './ConnectMethods';
import { getApiBase } from './labels';
import {
  COLOR_BG_DASHED,
  COLOR_BORDER_HOVER,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
  COLOR_SUCCESS,
  PANEL_BG,
} from './tokens';
import type { ProviderIconLookup } from './types';

interface Props {
  readonly scope: RepoScope | null;
  /** All scopes in the project — drives the AllScopesList (non-scope state)
   *  and the AllScopesList is the only navigation surface for scope CRUD. */
  readonly scopes: readonly RepoScope[];
  /** Canonical path of the folder the user has navigated into. Used by
   *  MakeScopeCTA to pre-fill `path` when creating a scope, and by the
   *  AllScopesList to disable the "Open" button on the current row. */
  readonly currentScopePath: string;
  /** Project id needed for the create/update/delete scope API calls. */
  readonly projectId: string;
  /** Connectors for the *current* scope (filtered up at the page
   *  level). Drives the detail-view ConnectMethodsBlock + Integrations. */
  readonly connectors: readonly Connector[];
  /** Project-wide connectors keyed by scope_id — used in the Overview
   *  state so each AccessPointRow can render its own connect / integration
   *  chip rows without per-row API requests. */
  readonly connectorsByScope: ReadonlyMap<string, Connector[]>;
  readonly providerIcons: ProviderIconLookup;
  readonly onClose: () => void;
  readonly onAddRequested: () => void;
  /**
   * Click handler for a third-party connector card. Cli + agent built-ins
   * are NOT routed through this — they're handled inline by
   * ConnectMethodsBlock. Page-level wiring opens the sync_config detail
   * panel for the clicked connector.
   */
  readonly onConnectorClick: (c: Connector) => void;
  /**
   * Hover feedback up into the explorer sidebar: while a row is hovered we
   * pass the scope's path so the matching folder gets the access-point
   * highlight; on leave / unmount we send null. Mirrors the legacy
   * AccessPointsListPanel's onEndpointHover wiring (lost in the redesign).
   */
  readonly onScopeHover?: (path: string | null) => void;
  /** Refresh scopes / connectors / repo identity after a CRUD mutation.
   *  Wired to useDataLayout().mutateRepo at page level. Typed as
   *  `Promise<unknown>` to match the SWR mutate() return value. */
  readonly onScopeMutated: () => Promise<unknown>;
  readonly onOpenAgentChat: (agentId: string, scopePath: string) => void;
  /** Drill into a specific scope's detail view from the Overview list,
   *  WITHOUT touching the file explorer. The panel maintains its own
   *  navigation state via selectedScopeId in usePanelStore. The reverse
   *  direction (panel → file tree) is intentionally not wired: clicking
   *  a row should not yank the user out of their current document. */
  readonly onSelectScope: (scopeId: string) => void;
  /** Pop the drill-down state and return to the Overview. Only present
   *  when the user is currently *in* a drill-down (selectedScopeId set);
   *  the natural folder-driven detail view has no back. */
  readonly onBack?: () => void;
  /** Navigate from Overview → Pp.2b Create page. Wired at page level
   *  to set `view='create'` with the current folder as `nodeId`, so
   *  the create form lands pre-filled and the user is one click from
   *  promoting a folder. */
  readonly onCreateRequested: () => void;
  readonly hideHeader?: boolean;
}

export function ScopedConnectorsListPanel({
  scope,
  scopes,
  currentScopePath,
  projectId,
  connectors,
  connectorsByScope,
  providerIcons,
  onClose,
  onAddRequested,
  onConnectorClick,
  onScopeHover,
  onScopeMutated,
  onOpenAgentChat,
  onSelectScope,
  onBack,
  onCreateRequested,
  hideHeader = false,
}: Props) {
  const cliConnector = useMemo(
    () => connectors.find((c) => c.provider === 'cli'),
    [connectors],
  );
  // Filesystem became a per-scope built-in in the 2026-05-08
  // migration — picked out here so the Git Remote MethodCard's
  // pause/resume toggle has a connector to bind to.
  const filesystemConnector = useMemo(
    () => connectors.find((c) => c.provider === 'filesystem'),
    [connectors],
  );
  const agentConnector = useMemo(
    () => connectors.find((c) => c.provider === 'agent'),
    [connectors],
  );
  // Integrations = third-party connectors. The three built-ins
  // (cli / agent / filesystem) are surfaced via the CONNECT block
  // above (Terminal CLI / AI Agent / Git Remote cards), so they
  // must be excluded from this row to avoid double-rendering.
  // `filesystem` was promoted to a built-in by the 2026-05-08
  // migration; missing it from this filter caused the Git Remote
  // built-in to leak into the Integrations section as a phantom card.
  const integrations = useMemo(
    () =>
      connectors.filter(
        (c) =>
          c.provider !== 'cli' &&
          c.provider !== 'agent' &&
          c.provider !== 'filesystem',
      ),
    [connectors],
  );
  const apiBase = useMemo(() => getApiBase(), []);

  // Lift the Settings expand/collapse state up here so the header
  // affordance and dirty handling stay stable. Always collapse when
  // the user navigates to a different scope — otherwise a stale
  // Settings context would carry over.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Reported up by ScopeSettingsBlock — used to gate the panel chrome
  // ([⚙ Settings] toggle / [×] close) so we don't silently drop
  // unsaved edits. Stable callback below pushes this into local state.
  const [settingsDirty, setSettingsDirty] = useState(false);
  const handleSettingsDirtyChange = useCallback((dirty: boolean) => {
    setSettingsDirty(dirty);
  }, []);
  // Keep a ref alongside the state so close handlers see the latest
  // dirty value without depending on it (avoids stale closures in
  // event handlers wired up through PanelShell).
  const settingsDirtyRef = useRef(false);
  useEffect(() => {
    settingsDirtyRef.current = settingsDirty;
  }, [settingsDirty]);

  useEffect(() => {
    setSettingsOpen(false);
    setSettingsDirty(false);
  }, [scope?.id]);

  // Confirm before discarding unsaved Settings edits when the user
  // collapses the Settings panel or closes the side panel entirely.
  // Confirm() is plain native — good enough for this destructive-but-
  // recoverable case (the user can re-open Settings and re-edit if
  // they cancel the discard). Returns true if the caller may proceed.
  const confirmDiscardIfDirty = useCallback((): boolean => {
    if (!settingsDirtyRef.current) return true;
    return globalThis.window?.confirm?.(
      'Discard unsaved Settings changes?',
    ) ?? true;
  }, []);

  const handleToggleSettings = useCallback(() => {
    if (settingsOpen) {
      if (!confirmDiscardIfDirty()) return;
      setSettingsOpen(false);
      setSettingsDirty(false);
    } else {
      setSettingsOpen(true);
    }
  }, [settingsOpen, confirmDiscardIfDirty]);

  const handleClose = useCallback(() => {
    if (!confirmDiscardIfDirty()) return;
    onClose();
  }, [confirmDiscardIfDirty, onClose]);

  const handleBack = useCallback(() => {
    if (!onBack) return;
    if (!confirmDiscardIfDirty()) return;
    onBack();
  }, [onBack, confirmDiscardIfDirty]);

  const handleScopeDeleted = useCallback(() => {
    // Scope is gone — settings dirtiness is moot. Force the ref off so
    // the close handler doesn't double-confirm on the way out.
    settingsDirtyRef.current = false;
    setSettingsDirty(false);
    onClose();
  }, [onClose]);

  // Clear any lingering hover highlight when the panel unmounts or the
  // hovered scope changes (defensive: onMouseLeave handles the common case,
  // but a fast scope-switch can skip leave events).
  useEffect(() => {
    return () => onScopeHover?.(null);
  }, [scope?.id, onScopeHover]);

  const handleHoverEnter = useCallback(() => {
    if (scope) onScopeHover?.(scope.path);
  }, [scope, onScopeHover]);
  const handleHoverLeave = useCallback(() => {
    onScopeHover?.(null);
  }, [onScopeHover]);

  // Header content.
  //
  // Overview state: title reads "Access  N" with the count rendered
  // inline at the same font-size as the label, just muted — so the
  // user reads "I have 5 access points" the moment the panel opens
  // without having to scan a subtitle. (2026-05-08 UX feedback: the
  // count should not live on the second line as a faint metadata
  // line; it belongs in the headline.) Subtitle stays empty in this
  // state — the panel header alone is enough headline.
  //
  // Scope-selected state: header is only the scope's name. Path,
  // permission mode, and Settings live in the body metadata block.
  const headerTitle: ReactNode = scope ? (
    scope.name
  ) : (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span>Access</span>
      <span
        style={{
          fontSize: 13,
          fontWeight: 400,
          color: COLOR_FG_DIM,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {scopes.length}
      </span>
    </span>
  );
  const headerSubtitle = undefined;

  // [Settings] is the action for the current path metadata. It stays
  // next to the mode label instead of living in the global header.
  const settingsButton = scope ? (
    <button
      type="button"
      onClick={handleToggleSettings}
      aria-pressed={settingsOpen}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 32,
        padding: '0 12px',
        fontSize: 13,
        fontWeight: 500,
        color: settingsOpen ? COLOR_FG : COLOR_FG_MUTED,
        background: settingsOpen
          ? 'rgba(255,255,255,0.10)'
          : 'rgba(255,255,255,0.055)',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        transition: 'background 150ms ease, color 150ms ease',
      }}
    >
      <SettingsGearIcon />
      Settings
      {settingsOpen && settingsDirty && (
        <span
          aria-label="Unsaved changes"
          title="Unsaved changes"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 999,
            background: COLOR_SUCCESS,
          }}
        />
      )}
    </button>
  ) : undefined;

  return (
    <PanelShell
      title={headerTitle}
      subtitle={headerSubtitle}
      onClose={handleClose}
      onBack={onBack ? handleBack : undefined}
      hideHeader={hideHeader}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: PANEL_BG,
        }}
      >
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '14px 12px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          {scope ? (
            <>
              {settingsButton && (
                <ScopeSummaryBar scope={scope} settingsButton={settingsButton} />
              )}

              {settingsOpen && (
                <ScopeSettingsBlock
                  scope={scope}
                  projectId={projectId}
                  onMutated={onScopeMutated}
                  onScopeDeleted={handleScopeDeleted}
                  onDirtyChange={handleSettingsDirtyChange}
                />
              )}

              {/* The three default ways to access this scope. cli + agent
                  rows in `connectors` back the scope key and in-app chat
                  agent surfaces. Terminal CLI and Git Remote share the
                  scope access key; AI Agent opens the chat runtime. */}
              <ConnectMethodsBlock
                scope={scope}
                cliConnector={cliConnector}
                filesystemConnector={filesystemConnector}
                agentConnector={agentConnector}
                projectId={projectId}
                apiBase={apiBase}
                onScopeMutated={onScopeMutated}
                onOpenAgentChat={onOpenAgentChat}
              />

              {/* Integrations: third-party providers (notion / gmail /
                  github / url / ...). The + Add CTA sits inline with the
                  section header so it lives next to the content it adds,
                  not orphaned in the panel header. */}
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '0 2px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: COLOR_FG_DIM,
                    }}
                  >
                    Integrations
                  </div>
                  <button
                    type="button"
                    onClick={onAddRequested}
                    style={{
                      height: 32,
                      padding: '6px 10px',
                      fontSize: 13,
                      fontWeight: 500,
                      color: COLOR_FG,
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${COLOR_BORDER_HOVER}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    + Add
                  </button>
                </div>
                {integrations.length === 0 ? (
                  <div
                    style={{
                      fontSize: 13,
                      color: COLOR_FG_DIM,
                      padding: '14px',
                      textAlign: 'center',
                      borderRadius: 8,
                      border: `1px dashed ${COLOR_BORDER_HOVER}`,
                      background: COLOR_BG_DASHED,
                    }}
                  >
                    No integrations yet. Click <strong style={{ color: COLOR_FG_MUTED }}>+ Add</strong> to pull in Notion, Gmail, GitHub, and more.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {integrations.map((c) => (
                      <ConnectorCard
                        key={c.id}
                        connector={c}
                        providerIcons={providerIcons}
                        onClick={() => onConnectorClick(c)}
                        onHoverEnter={handleHoverEnter}
                        onHoverLeave={handleHoverLeave}
                      />
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : (
            // Pp.1 Overview body:
            //   1. AllAccessPointsList — every scope in the project,
            //      click a row to drill into Pp.2a Detail.
            //   2. CreateAccessPointCTACard — sits beneath the list,
            //      navigates to Pp.2b Create on click. The actual
            //      create form lives there as a dedicated sub-page
            //      (back button → Overview), per the 2026-05-08
            //      3-page hierarchy. No inline form here so the
            //      Overview stays scannable.
            <>
              <AllAccessPointsList
                scopes={scopes}
                connectorsByScope={connectorsByScope}
                providerIcons={providerIcons}
                currentScopePath={currentScopePath}
                onSelectScope={onSelectScope}
              />
              <CreateAccessPointCTACard onCreate={onCreateRequested} />
            </>
          )}
        </div>
      </div>
    </PanelShell>
  );
}

function ScopeSummaryBar({
  scope,
  settingsButton,
}: {
  scope: RepoScope;
  settingsButton: ReactNode;
}) {
  const modeLabel = scope.mode === 'rw' ? 'Read & Write' : 'Read-only';
  const pathSegments = scope.path === ''
    ? []
    : scope.path.split('/').filter(Boolean);
  const pathTitle = scope.path === '' ? '/' : `/${scope.path}`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        alignItems: 'start',
        columnGap: 20,
        padding: '4px 8px 0',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          minWidth: 0,
        }}
      >
        <ScopeMetaLabel>Path</ScopeMetaLabel>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
          }}
        >
          <ScopePathTrail segments={pathSegments} title={pathTitle} />
          <span
            style={{
              flexShrink: 0,
              fontSize: 12,
              fontWeight: 500,
              color: COLOR_FG_DIM,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            {modeLabel}
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          alignSelf: 'end',
          flexShrink: 0,
        }}
      >
        {settingsButton}
      </div>
    </div>
  );
}

function ScopeMetaLabel({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 500,
        color: COLOR_FG_DIM,
        lineHeight: 1.25,
      }}
    >
      {children}
    </div>
  );
}

function ScopePathTrail({
  segments,
  title,
}: {
  segments: readonly string[];
  title: string;
}) {
  const items = segments.length > 0 ? segments : ['Root'];

  return (
    <div
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      {items.map((segment, index) => (
        <Fragment key={`${segment}-${index}`}>
          {index > 0 && (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                color: COLOR_FG_DIM,
                fontSize: 13,
                lineHeight: 1,
              }}
            >
              /
            </span>
          )}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              minWidth: 0,
              flexShrink: index === items.length - 1 ? 1 : 0,
              color: index === items.length - 1 ? COLOR_FG : COLOR_FG_MUTED,
              fontSize: 13,
              fontWeight: index === items.length - 1 ? 600 : 500,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                width: 15,
                height: 15,
                flexShrink: 0,
              }}
            >
              <FolderIcon />
            </span>
            <span
              style={{
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {segment}
            </span>
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Lucide `settings-2` glyph: 4 sliders. Cleaner at 13×13 than the
 *  stock cog (which has too much detail to read at small sizes). */
function SettingsGearIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 7h-9" />
      <path d="M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}
