'use client';

import { useMemo, useState } from 'react';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import { connectorAsEndpointShape, providerLabel } from './labels';
import { AccessPointProviderIcon } from './AccessPointProviderIcon';
import { ProviderIcon } from '../../../access/components/icons';
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

/** Inline provider signal size. These sit on the second line beside
 *  the path, so they should read as small status marks rather than
 *  primary actions. */
const CHIP_SIZE = 18;

const ROW_BG =
  'color-mix(in srgb, var(--po-control) 46%, transparent)';
const ROW_BG_HOVER =
  'color-mix(in srgb, var(--po-control) 64%, transparent)';
const ROW_BG_CURRENT =
  'var(--po-selected)';
const ROW_BORDER_CURRENT =
  'color-mix(in srgb, var(--po-text) 24%, var(--po-border) 76%)';

/**
 * AccessPointRow — one access-point row in the overview list.
 *
 * The row is the element: status, display name, path, permission, and
 * provider logos all live inside one clickable access-point object.
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

  const pathDisplay = scope.is_root || scope.path === '' ? '/' : `/${scope.path}`;
  const displayName = scope.is_root || scope.path === ''
    ? 'Root'
    : scope.name || scope.path.split('/').filter(Boolean).pop() || scope.path;

  const background = isCurrent ? ROW_BG_CURRENT : hovered ? ROW_BG_HOVER : ROW_BG;
  const borderColor = isCurrent ? ROW_BORDER_CURRENT : hovered ? COLOR_BORDER_HOVER : COLOR_BORDER;
  const permissionLabel = scope.mode === 'rw' ? 'Read & Write' : 'Read-only';
  const active = connectors.some((c) => c.status === 'active' || c.status === 'syncing');

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${displayName} · ${pathDisplay}`}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 0,
        minHeight: 58,
        padding: '8px 10px',
        borderRadius: 8,
        border: `1px solid ${borderColor}`,
        background,
        color: COLOR_FG,
        fontFamily: 'var(--po-font-sans)',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
        boxShadow: 'none',
        appearance: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 16,
          height: 16,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: active ? 'var(--po-success)' : COLOR_FG_DIM,
            boxShadow: active ? '0 0 6px color-mix(in srgb, var(--po-success) 40%, transparent)' : 'none',
          }}
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: '1 1 auto',
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
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
              fontWeight: isCurrent ? 600 : 500,
              lineHeight: 1.2,
              color: COLOR_FG,
            }}
          >
            {displayName}
          </span>
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
            · {permissionLabel}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11.5,
              lineHeight: 1.25,
              color: isCurrent ? COLOR_FG_MUTED : COLOR_FG_DIM,
              fontFamily: 'var(--po-font-mono)',
            }}
          >
            {pathDisplay}
          </span>

          {/* Provider signals — built-ins first in fixed order, then
              active third-party integrations, then a `+N` overflow.
              They intentionally live on the path line so the row reads
              as one access-point element instead of a row plus actions. */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              flexShrink: 0,
            }}
          >
            {cliActive && (
              <ProviderSignal
                provider="cli"
                selected={isCurrent}
                title="Puppyone CLI · active"
              />
            )}
            {filesystemActive && (
              <ProviderSignal
                provider="filesystem"
                selected={isCurrent}
                title="Git Remote · active"
              />
            )}
            {/* AI Agent chip — gated on the AI_AGENT_ENABLED flag. The
                agent connector still exists per-scope (auto-INSERTed by
                the DB trigger) and `agentActive` still reads its status,
                but we don't surface a chip while the feature is hidden. */}
            {AI_AGENT_ENABLED && agentActive && (
              <ProviderSignal
                provider="agent"
                selected={isCurrent}
                title="AI Agent · active"
              />
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
                  padding: '0 4px',
                  fontSize: 9.5,
                  fontWeight: 600,
                  borderRadius: 5,
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
        </div>
      </div>
    </button>
  );
}

/**
 * ProviderSignal — tiny built-in connector logo for the overview row.
 * Mirrors the dedicated Access sidebar's second-line connector signal:
 * mono/custom provider glyph, 18px square, quiet neutral chrome.
 */
function ProviderSignal({
  provider,
  selected,
  title,
}: {
  readonly provider: string;
  readonly selected: boolean;
  readonly title: string;
}) {
  const isGit = provider === 'filesystem';

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
        borderRadius: 5,
        background: selected
          ? 'var(--po-hover)'
          : 'color-mix(in srgb, var(--po-hover) 55%, transparent)',
        border: `1px solid ${selected ? 'var(--po-border-strong)' : COLOR_BORDER}`,
        color: selected ? COLOR_FG_MUTED : COLOR_FG_DIM,
        flexShrink: 0,
        opacity: selected ? 1 : 0.9,
        boxShadow: 'none',
      }}
    >
      <ProviderIcon
        provider={provider}
        size={isGit ? 13 : 10}
        variant="mono"
      />
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
        borderRadius: 5,
        background: 'color-mix(in srgb, var(--po-control) 44%, transparent)',
        border: `1px solid ${COLOR_BORDER}`,
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
          width: 16,
          height: 16,
          transform: 'scale(0.75)',
        }}
      >
        <AccessPointProviderIcon ep={ep} providerIcons={providerIcons} />
      </span>
    </span>
  );
}
