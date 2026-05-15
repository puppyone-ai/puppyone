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
 *   │  │ Local CLI │ │ Hello AI  │                              │
 *   │  └───────────┘ └───────────┘                              │
 *   │   ↑ selected     unselected                                │
 *   │                                                            │
 *   │  Local CLI                          [Pause] [⋮]           │  ← AP NAME (page header)
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
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { PROJECT_CONTENT_RAIL_WIDTH } from '@/lib/layout';
import { T } from '../lib/tokens';
import {
  CONNECTOR_GROUP_LABELS,
  PROVIDER_LABELS,
  STATUS_COLORS,
  STATUS_LABEL,
} from '../lib/constants';
import { getConnectorGroup } from '../lib/format';
import { PauseIcon, PlayIcon, ProviderIcon, ScopeFolderGlyph } from './icons';
import { GhostButton, PermBadge, SectionLabel } from './ui-blocks';
import { ConnectorCard } from './ConnectorCard';
// We deliberately reuse the existing ScopeSettingsBlock from /data —
// it already implements every editable scope field (mode, exclude,
// access-key rotate/copy, name, identity, danger zone) plus the
// dirty-aware Save/Discard footer. Building a parallel widget here
// would duplicate ~600 lines and inevitably drift visually.
import { ScopeSettingsBlock } from '../../data/components/access-points/ScopeSettingsBlock';
import type { ConnectorEditPatch } from '../hooks/useAccessData';

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
  // Track the currently-selected AP card. Defaults to the first
  // connector under this scope; re-anchors whenever the scope (and
  // therefore the connectors list) changes underneath us.
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(
    () => connectors[0]?.id ?? null,
  );

  // Inline scope-settings toggle. The `Edit` button on the strip flips
  // this; we mount `ScopeSettingsBlock` right under the strip so the
  // user never leaves the access page. Auto-collapses when the user
  // navigates to a different scope so dirty edits don't ride along.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);

  useEffect(() => {
    setSettingsOpen(false);
    setSettingsDirty(false);
  }, [scope?.id]);

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

  useEffect(() => {
    if (connectors.length === 0) {
      setSelectedConnectorId(null);
      return;
    }
    const stillExists =
      selectedConnectorId != null &&
      connectors.some((c) => c.id === selectedConnectorId);
    if (!stillExists) setSelectedConnectorId(connectors[0].id);
  }, [connectors, selectedConnectorId]);

  const selectedConnector = useMemo(
    () =>
      connectors.find((c) => c.id === selectedConnectorId) ?? connectors[0],
    [connectors, selectedConnectorId],
  );

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
        {/* PAGE HEADER — `scope.name` at h1 scale, an aggregate
            status line beneath, and a bulk Pause-/Resume-all action
            on the right. Mirrors the per-connector card header so
            the user sees the same control pattern at the scope and
            connector levels. The strip below answers "where" and
            "what permissions"; this header answers "what is this
            page" and "how is it doing". */}
        <ScopePageHeader
          scope={scope}
          connectors={connectors}
          onPauseResume={onPauseResume}
          pendingConnectorIds={pendingConnectorIds}
        />

        {/* SCOPE attribute strip — folder glyph, path, mode, perm
            badges. Compact by design: it's a context bar, not a
            heading. The "Scope" eyebrow keeps it grouped as a sibling
            to "Settings" and "Connectors" below. */}
        <SectionLabel>Scope</SectionLabel>
        <ScopeStrip scope={scope} />

        {/* SETTINGS — sibling to Connectors. Header row is a single
            button so the chevron + label respond as one click target;
            dirty-edits get a small amber dot anchored after the
            heading. */}
        {scope ? (
          <SettingsSection
            open={settingsOpen}
            dirty={settingsDirty}
            onToggle={handleToggleSettings}
          >
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
        {connectors.length > 0 && selectedConnector ? (
          <>
            <SectionLabel>Connectors</SectionLabel>
            <AccessPointSwitcher
              connectors={connectors}
              selectedId={selectedConnector.id}
              onSelect={setSelectedConnectorId}
              onPauseResume={onPauseResume}
              pendingConnectorIds={pendingConnectorIds}
            />
            <ConnectorCard
              key={selectedConnector.id}
              connector={selectedConnector}
              scope={scope}
              onPauseResume={() => onPauseResume(selectedConnector.id)}
              onUpdate={(patch) => onUpdate(selectedConnector.id, patch)}
              onDelete={() => onDelete(selectedConnector.id)}
              pending={pendingConnectorIds.has(selectedConnector.id)}
            />
          </>
        ) : (
          <div
            style={{
              marginTop: 18,
              padding: '14px 16px',
              borderRadius: 8,
              border: `1px dashed ${T.cardBorder}`,
              background: T.cardBg,
              fontSize: 12,
              color: T.text3,
              fontFamily: T.fontSans,
              fontStyle: 'italic',
            }}
          >
            No connectors bound to this scope yet.
          </div>
        )}
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

// ─── ScopePageHeader ─────────────────────────────────────────────────
//
// h1 of the right pane. Displays the scope's *name* (first-class
// editable field independent of the filesystem path), a tiny meta
// line summarizing aggregate health across the scope's connectors,
// and a bulk-action button mirroring the per-connector Pause/Resume
// pattern but applied to the whole scope at once.
//
// The visual pattern mirrors `ConnectorCard`'s own header so the user
// can instantly tell that a scope is conceptually "the same kind of
// surface" as a connector — just one level up. Path information
// (where this scope lives on disk + its read/write mode + perm
// badges) lives in the compact strip below; we deliberately keep the
// title lean.
//
// Aggregate status:
//   - any errored             → 'Error'   (red dot)
//   - any syncing             → 'Syncing' (blue dot)
//   - all active              → 'Active'  (green dot)
//   - all paused              → 'Paused'  (amber dot)
//   - mixed (some on/off)     → 'Mixed'   (amber dot)
//   - empty                   → no meta line
//
// Bulk action picks the most natural intent given the current state:
//   - any active connectors   → "Pause all"  (pauses every active one)
//   - else any paused/pending → "Resume all" (resumes them)
//   - else                    → button hidden
// Errored connectors are intentionally not auto-retried by bulk —
// retry is a per-connector decision and lives on the connector card.

interface ScopeAggregateStatus {
  readonly key: 'empty' | 'active' | 'syncing' | 'paused' | 'mixed' | 'error';
  readonly label: string;
  readonly color: string;
}

function computeAggregate(connectors: readonly Connector[]): ScopeAggregateStatus {
  if (connectors.length === 0) {
    return { key: 'empty', label: 'No connectors', color: T.text4 };
  }
  if (connectors.some((c) => c.status === 'error')) {
    return { key: 'error', label: STATUS_LABEL.error, color: STATUS_COLORS.error };
  }
  if (connectors.some((c) => c.status === 'syncing')) {
    return { key: 'syncing', label: STATUS_LABEL.syncing, color: STATUS_COLORS.syncing };
  }
  if (connectors.every((c) => c.status === 'active')) {
    return { key: 'active', label: STATUS_LABEL.active, color: STATUS_COLORS.active };
  }
  if (connectors.every((c) => c.status === 'paused')) {
    return { key: 'paused', label: STATUS_LABEL.paused, color: STATUS_COLORS.paused };
  }
  return { key: 'mixed', label: 'Mixed', color: STATUS_COLORS.paused };
}

interface BulkAction {
  readonly action: 'pause-all' | 'resume-all';
  readonly label: string;
  readonly icon: 'pause' | 'play';
  readonly targets: readonly Connector[];
}

function getBulkAction(connectors: readonly Connector[]): BulkAction | null {
  const active = connectors.filter((c) => c.status === 'active' || c.status === 'syncing');
  if (active.length > 0) {
    return { action: 'pause-all', label: 'Pause all', icon: 'pause', targets: active };
  }
  const paused = connectors.filter((c) => c.status === 'paused');
  if (paused.length > 0) {
    return { action: 'resume-all', label: 'Resume all', icon: 'play', targets: paused };
  }
  return null;
}

function ScopePageHeader({
  scope,
  connectors,
  onPauseResume,
  pendingConnectorIds,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly onPauseResume: (connectorId: string) => Promise<void> | void;
  readonly pendingConnectorIds: ReadonlySet<string>;
}) {
  const titleText = scope?.name?.trim() || 'Untitled scope';
  const aggregate = computeAggregate(connectors);
  const bulkAction = getBulkAction(connectors);
  const anyPending = connectors.some((c) => pendingConnectorIds.has(c.id));

  const handleBulk = useCallback(() => {
    if (!bulkAction) return;
    bulkAction.targets.forEach((t) => {
      void onPauseResume(t.id);
    });
  }, [bulkAction, onPauseResume]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 18,
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            lineHeight: 1.25,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            color: T.text1,
            fontFamily: T.fontSans,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={titleText}
        >
          {titleText}
        </h1>
        {connectors.length > 0 && aggregate.key !== 'empty' ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              color: T.text3,
              fontFamily: T.fontSans,
              minWidth: 0,
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: aggregate.color,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: aggregate.color,
                  boxShadow: `0 0 6px color-mix(in srgb, ${aggregate.color} 55%, transparent)`,
                }}
              />
              {aggregate.label}
            </span>
            <span style={{ color: T.text4, flexShrink: 0 }}>·</span>
            <span style={{ color: T.text3, flexShrink: 0 }}>
              {connectors.length === 1 ? '1 connector' : `${connectors.length} connectors`}
            </span>
          </div>
        ) : null}
      </div>
      {bulkAction ? (
        <div style={{ flexShrink: 0, marginTop: 2 }}>
          <GhostButton
            onClick={handleBulk}
            disabled={anyPending}
            icon={bulkAction.icon === 'pause' ? <PauseIcon size={10} /> : <PlayIcon size={10} />}
          >
            {bulkAction.label}
          </GhostButton>
        </div>
      ) : null}
    </div>
  );
}

// ─── ScopeStrip ──────────────────────────────────────────────────────
//
// One-line scope context bar. Replaces the old MOUNT POINT card +
// file-tree preview, which was burying the AP-centric content. The
// path is now an *attribute*, not the page's lead surface — the file
// tree lives in /data where it belongs (drilling files is what /data
// is for; this page is for managing access points).

// Scope context strip — compact "where am I rooted" attribute bar.
//
// Sits below the page-level title (which renders `scope.name` at h1
// scale). The strip's job is to surface the *path* — i.e. the
// filesystem location of this scope — plus its read/write mode and
// permission badges. Strictly an attribute row: small folder glyph,
// 12px mono path, no enlargement, no nested heading. Title duties
// are handled by `ScopePageTitle` upstream so the two concepts stay
// cleanly separated in the visual hierarchy.
function ScopeStrip({
  scope,
}: {
  readonly scope: RepoScope | undefined;
}) {
  const isReadWrite = scope?.mode === 'rw';
  const isWorkspaceWide = scope?.is_root || scope?.path === '' || scope?.path == null;
  const pathLabel = isWorkspaceWide ? '/' : `/${scope?.path ?? ''}`;
  const modeLabel = isReadWrite ? 'Read & write' : 'Read-only';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        marginBottom: 22,
        borderRadius: 8,
        background: T.cardBg,
        border: `1px solid ${T.cardBorder}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          flexShrink: 0,
          color: T.text3,
        }}
      >
        <ScopeFolderGlyph size={14} />
      </div>
      <span
        style={{
          fontSize: 12,
          color: T.text2,
          fontFamily: T.fontMono,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={pathLabel}
      >
        {pathLabel}
      </span>
      <span style={{ color: T.text4, flexShrink: 0, fontSize: 12 }}>·</span>
      <span
        style={{
          fontSize: 12,
          color: T.text3,
          fontFamily: T.fontSans,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {modeLabel}
      </span>
      <PermBadge label='read' active={!!scope} />
      <PermBadge label='write' active={!!isReadWrite} />
    </div>
  );
}

// ─── Settings section (sibling to ACCESS POINTS) ─────────────────────
//
// One collapsible section. Header is a real <button> so the chevron +
// caps label + dirty dot all share a single click target with proper
// keyboard semantics. Body is unmounted while collapsed so the inner
// <ScopeSettingsBlock> doesn't run effects or hold state in the
// background — saving renders and re-anchoring local form state when
// it's reopened.
function SettingsSection({
  open,
  dirty,
  onToggle,
  children,
}: {
  readonly open: boolean;
  readonly dirty: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div style={{ marginBottom: 22 }}>
      {/* Header row — same typography as <SectionLabel> ("Access points"
          below) so the two siblings read as the same tier. The chevron
          + dirty dot live to the left and right of the heading; the
          right-hand hint stays in the muted L4 (11px sentence case). */}
      <button
        type='button'
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-expanded={open}
        aria-controls='puppyone-access-scope-settings-body'
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: open ? 10 : 0,
          padding: '4px 4px 4px 2px',
          borderRadius: 4,
          background: hovered ? 'var(--po-control)' : 'transparent',
          transition: 'background 0.12s ease',
        }}
      >
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s ease',
            color: T.text3,
          }}
        >
          <ChevronGlyph size={11} />
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: T.text2,
            fontFamily: T.fontSans,
            letterSpacing: '-0.005em',
          }}
        >
          Settings
        </span>
        {dirty ? (
          <>
            <span
              aria-hidden
              title='Unsaved changes'
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--po-warning)',
                boxShadow: '0 0 5px color-mix(in srgb, var(--po-warning) 55%, transparent)',
                marginLeft: 2,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--po-warning)',
                fontFamily: T.fontSans,
              }}
            >
              Unsaved
            </span>
          </>
        ) : null}
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            color: T.text4,
            fontFamily: T.fontSans,
            textAlign: 'right',
            paddingRight: 4,
          }}
        >
          {open ? 'Click to collapse' : 'Permissions, exclude paths, access key…'}
        </span>
      </button>
      {open ? (
        <div
          id='puppyone-access-scope-settings-body'
          style={{
            padding: '14px 14px 12px',
            borderRadius: 10,
            background: 'var(--po-control)',
            border: `1px solid ${T.cardBorder}`,
            animation: `puppyone-access-settings-slide 180ms ${T.ease}`,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

const ChevronGlyph = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
    <polyline points='9 18 15 12 9 6' />
  </svg>
);

// ─── AccessPointSwitcher ─────────────────────────────────────────────
//
// Replaces the old "CLI 1 / Agent 1" underline tab strip. Tabs framed
// the page as "two sections of one config", which inverted reality:
// each AP is a distinct entity (different name, status, owner). The
// switcher renders one card per AP, each showing the AP's identity at
// a glance (provider type, name, status), and clicking swaps the
// detail view below. Selected card carries an accent fill + lift.

function AccessPointSwitcher({
  connectors,
  selectedId,
  onSelect,
  onPauseResume,
  pendingConnectorIds,
}: {
  readonly connectors: readonly Connector[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  readonly onPauseResume: (id: string) => Promise<void> | void;
  readonly pendingConnectorIds: ReadonlySet<string>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        paddingBottom: 4,
        marginBottom: 18,
        scrollbarWidth: 'thin',
      }}
    >
      {connectors.map((c) => (
        <AccessPointChip
          key={c.id}
          connector={c}
          selected={c.id === selectedId}
          onClick={() => onSelect(c.id)}
          onPauseResume={() => onPauseResume(c.id)}
          pending={pendingConnectorIds.has(c.id)}
        />
      ))}
    </div>
  );
}

// Connector chip — selectable card *and* live on/off control.
//
// Two interaction zones, deliberately separated by the toggle's hit
// target + stopPropagation:
//   - Click anywhere on the chip body  → swap detail view to this connector.
//   - Click the toggle on the right    → pause / resume this connector.
//
// Visually:
//   - Toggle thumb position encodes "enabled?"  (right = on, left = off).
//   - Toggle track color encodes status:
//       active/syncing → green tint
//       paused/pending → muted gray-amber
//       error          → red tint (and the toggle stays "on")
//
// "Paused" is the only state where the connector is actually frozen
// at the data plane (auth.py / chat service reject paused channels);
// every other status maps to "running, just maybe in a hiccup" which
// is why the toggle shows ON for them.
function AccessPointChip({
  connector,
  selected,
  onClick,
  onPauseResume,
  pending,
}: {
  readonly connector: Connector;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly onPauseResume: () => Promise<void> | void;
  readonly pending: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const name =
    connector.name ||
    PROVIDER_LABELS[connector.provider] ||
    connector.provider;
  const typeLabel =
    CONNECTOR_GROUP_LABELS[getConnectorGroup(connector.provider)];
  const isOn =
    connector.status === 'active' ||
    connector.status === 'syncing' ||
    connector.status === 'error';

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role='button'
      tabIndex={0}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        minWidth: 168,
        flexShrink: 0,
        boxSizing: 'border-box',
        borderRadius: 10,
        border: `1px solid ${selected ? 'var(--po-border-strong)' : T.cardBorder}`,
        background: selected
          ? 'var(--po-hover)'
          : hovered
            ? 'var(--po-control)'
            : T.cardBg,
        boxShadow: selected
          ? '0 0 0 1px var(--po-hover), 0 6px 18px var(--po-shadow)'
          : 'none',
        opacity: connector.status === 'paused' ? 0.7 : 1,
        transition:
          'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: 'var(--po-hover)',
            border: `1px solid ${T.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <ProviderIcon provider={connector.provider} size={14} />
        </div>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontWeight: 500,
            color: selected ? T.text3 : T.text4,
            fontFamily: T.fontSans,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={typeLabel}
        >
          {typeLabel}
        </span>
        <ConnectorToggle
          status={connector.status}
          on={isOn}
          pending={pending}
          onToggle={onPauseResume}
        />
      </div>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: selected ? T.text1 : T.text2,
          fontFamily: T.fontSans,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          width: '100%',
        }}
        title={name}
      >
        {name}
      </span>
    </div>
  );
}

// ─── ConnectorToggle ─────────────────────────────────────────────────
//
// Tiny iOS-style switch driving connector pause/resume directly from
// the chip. Click the toggle → flip pause/resume (event stops there
// so the parent chip doesn't also try to "select" itself); click any
// other part of the chip → select it.
//
function ConnectorToggle({
  status,
  on,
  pending,
  onToggle,
}: {
  readonly status: string;
  readonly on: boolean;
  readonly pending: boolean;
  readonly onToggle: () => Promise<void> | void;
}) {
  const ariaLabel = `${STATUS_LABEL[status] ?? status} — click to ${on ? 'pause' : 'resume'}`;

  return (
    <ToggleSwitch
      checked={on}
      pending={pending}
      ariaLabel={ariaLabel}
      title={ariaLabel}
      stopPropagation
      onCheckedChange={() => {
        void onToggle();
      }}
    />
  );
}
