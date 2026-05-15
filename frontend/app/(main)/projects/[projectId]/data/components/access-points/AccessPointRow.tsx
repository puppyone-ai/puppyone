'use client';

import { useMemo, useState } from 'react';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import { connectorAsEndpointShape, providerLabel } from './labels';
import { AccessPointProviderIcon } from './AccessPointProviderIcon';
import { AgentIcon, SyncIcon, TerminalIcon } from './connect-methods/icons';
import { METHOD_META, type MethodId } from './connect-methods/meta';
import {
  COLOR_BORDER,
  COLOR_BORDER_HOVER,
  COLOR_FG,
  COLOR_FG_DIM,
  COLOR_FG_MUTED,
} from './tokens';
import type { ProviderIconLookup } from './types';

/** Cap on inline integration glyphs before the strip collapses the
 *  remainder into a `+N` chip. Five fits cleanly in a single row
 *  alongside the three built-ins on most panel widths because chips
 *  are now icon-only (no inline label). The detail view always
 *  shows the full list. */
const INTEGRATION_VISIBLE_CAP = 5;

/** Icon-chip size. Chips are now glyph-only, so they want a square
 *  shape (`borderRadius: 7`) instead of the pill shape used in the
 *  earlier label-bearing rounds. 24px gives enough padding for a
 *  14-15px icon and aligns vertically with the 13px name + 6px
 *  vertical padding of the row. */
const CHIP_SIZE = 24;

const ROW_BG =
  'color-mix(in srgb, var(--po-text) 6%, var(--po-panel) 94%)';
const ROW_BG_HOVER =
  'color-mix(in srgb, var(--po-text) 8%, var(--po-panel) 92%)';
const ROW_BG_CURRENT =
  'color-mix(in srgb, var(--po-text) 10%, var(--po-panel) 90%)';
const ROW_BORDER_CURRENT =
  'color-mix(in srgb, var(--po-text) 24%, var(--po-border) 76%)';

/**
 * AccessPointRow — one access-point row in the overview list.
 *
 * The path label lives above this element in the parent list. This
 * row only describes the access point attached to that scope.
 */
export function AccessPointRow({
  scope,
  connectors,
  providerIcons,
  isCurrent,
  onClick,
}: {
  readonly scope: RepoScope;
  /** Connectors bound to this scope. We split into the three
   *  built-ins (cli / filesystem / agent) and any third-party
   *  integrations. Empty array (frozen at the call site) when the
   *  DB trigger hasn't settled — row degrades to "no chips" without
   *  crashing. */
  readonly connectors: readonly Connector[];
  readonly providerIcons: ProviderIconLookup;
  /** True iff this scope's path equals the folder the user is
   *  currently viewing in the file tree. */
  readonly isCurrent: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  // Pluck the three built-ins by provider id. Post-2026-05-08 the
  // DB trigger guarantees one of each per scope, but we read them
  // defensively in case the trigger hasn't settled yet on a fresh
  // insert (or the user is looking at legacy data not yet
  // backfilled).
  const cliConnector = connectors.find((c) => c.provider === 'cli');
  const filesystemConnector = connectors.find((c) => c.provider === 'filesystem');
  const agentConnector = connectors.find((c) => c.provider === 'agent');

  // Active flags for the chip-render gate. We hide a built-in chip
  // when its connector is paused — the strip is a positive
  // statement of "what's on", not a state diagram of every method
  // that exists. (The detail view is where on/off lives.)
  const cliActive = cliConnector?.status === 'active';
  const filesystemActive = filesystemConnector?.status === 'active';
  const agentActive = agentConnector?.status === 'active';

  // Third-party integrations. Same hide-paused rule as the built-ins
  // — only `status !== 'paused'` integrations make it into the
  // strip. We keep `syncing` / `error` visible because the user
  // probably wants to see those at a glance (errors especially).
  const integrations = useMemo(
    () =>
      connectors.filter(
        (c) =>
          c.provider !== 'cli' &&
          c.provider !== 'agent' &&
          c.provider !== 'filesystem' &&
          c.status !== 'paused',
      ),
    [connectors],
  );
  const visibleIntegrations = integrations.slice(0, INTEGRATION_VISIBLE_CAP);
  const hiddenIntegrations = integrations.length - visibleIntegrations.length;

  // Title attribute holds the full path so users can hover to
  // recover it even though the path no longer renders inline.
  const pathDisplay = scope.is_root || scope.path === '' ? '/' : `/${scope.path}`;

  const background = isCurrent ? ROW_BG_CURRENT : hovered ? ROW_BG_HOVER : ROW_BG;
  const borderColor = isCurrent ? ROW_BORDER_CURRENT : hovered ? COLOR_BORDER_HOVER : COLOR_BORDER;
  const typeLabel = scope.is_root ? 'Root access point' : 'Access point';
  const permissionLabel = scope.mode === 'rw' ? 'Read & Write' : 'Read-only';

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${pathDisplay} · ${typeLabel}`}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minWidth: 0,
        minHeight: 52,
        padding: '9px 12px',
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background,
        color: COLOR_FG,
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        boxShadow: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 7,
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
        <span
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.25,
            color: COLOR_FG,
          }}
        >
          {typeLabel}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: 13,
            fontWeight: 500,
            color: COLOR_FG_DIM,
            lineHeight: 1.25,
            whiteSpace: 'nowrap',
          }}
        >
          · {permissionLabel}
        </span>
      </div>

      {/* Chip strip — built-ins first in fixed order, then any
          active third-party integrations, then a `+N` overflow chip. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
        }}
      >
        {cliActive && (
          <MethodChip method="terminal" title="Puppyone CLI · active" />
        )}
        {filesystemActive && (
          <MethodChip method="sync" title="Local Folder Sync · active" />
        )}
        {/* AI Agent chip — gated on the AI_AGENT_ENABLED flag. The
            agent connector still exists per-scope (auto-INSERTed by
            the DB trigger) and `agentActive` still reads its status,
            but we don't surface a chip while the feature is hidden. */}
        {AI_AGENT_ENABLED && agentActive && (
          <MethodChip method="agent" title="AI Agent · active" />
        )}
        {visibleIntegrations.map((c) => (
          <IntegrationChip
            key={c.id}
            connector={c}
            providerIcons={providerIcons}
          />
        ))}
        {hiddenIntegrations > 0 && (
          <span
            title={`+${hiddenIntegrations} more`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: CHIP_SIZE,
              height: CHIP_SIZE,
              padding: '0 6px',
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 6,
              color: COLOR_FG_MUTED,
              background: 'transparent',
              border: `1px dashed ${COLOR_BORDER_HOVER}`,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            +{hiddenIntegrations}
          </span>
        )}
      </div>
    </button>
  );
}

/**
 * MethodChip — icon-only chip for a built-in connect method.
 *
 * Picks colour from `METHOD_META` so per-method identity matches the
 * detail view's MethodCard exactly: blue=Terminal, green=Sync,
 * purple=Agent. The colour-coded background + border + glyph trio
 * carries the meaning that the previous round's inline label used
 * to carry; the tooltip handles disambiguation for users who
 * haven't internalised the colour-coding yet.
 */
function MethodChip({
  method,
  title,
}: {
  readonly method: MethodId;
  readonly title: string;
}) {
  const meta = METHOD_META[method];
  const icon =
    method === 'terminal' ? <TerminalIcon /> : method === 'sync' ? <SyncIcon /> : <AgentIcon />;

  return (
    <span
      title={title}
      aria-label={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: CHIP_SIZE,
        height: CHIP_SIZE,
        borderRadius: 6,
        background: meta.accentBg,
        border: `1px solid ${meta.accentBorder}`,
        color: meta.accent,
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
        }}
      >
        {icon}
      </span>
    </span>
  );
}

/**
 * IntegrationChip — icon-only chip for a third-party connector.
 *
 * Neutral surface (matches the chip-family visual language without
 * pulling brand colour into the row chrome itself) with the brand
 * glyph from `AccessPointProviderIcon` centered inside. Tooltip
 * carries the connector's display name.
 */
function IntegrationChip({
  connector,
  providerIcons,
}: {
  readonly connector: Connector;
  readonly providerIcons: ProviderIconLookup;
}) {
  const ep = useMemo(() => connectorAsEndpointShape(connector), [connector]);
  const label = connector.name || providerLabel(connector.provider);
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: CHIP_SIZE,
        height: CHIP_SIZE,
        borderRadius: 6,
        background: 'var(--po-hover)',
        border: `1px solid ${COLOR_BORDER_HOVER}`,
        color: COLOR_FG,
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
        }}
      >
        <AccessPointProviderIcon ep={ep} providerIcons={providerIcons} />
      </span>
    </span>
  );
}
