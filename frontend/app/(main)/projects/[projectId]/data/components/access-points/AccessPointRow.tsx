'use client';

import { useMemo, useState } from 'react';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { AI_AGENT_ENABLED } from '@/lib/featureFlags';
import { Pill } from './Pill';
import { connectorAsEndpointShape, providerLabel } from './labels';
import { AccessPointProviderIcon } from './AccessPointProviderIcon';
import { AgentIcon, SyncIcon, TerminalIcon } from './connect-methods/icons';
import { METHOD_META, type MethodId } from './connect-methods/meta';
import {
  COLOR_ACCENT_BG_FAINT,
  COLOR_ACCENT_BORDER,
  COLOR_BORDER_HOVER,
  COLOR_FG,
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

/* ── Card material (round 11) ──────────────────────────────────────
 *
 * The Overview rows are top-level entities you click to drill into a
 * detail view, so they want more weight than the recessive
 * ConnectorCard / MethodCard surfaces in the detail view. These
 * tokens are *local* to AccessPointRow — the shared
 * `COLOR_BG_CARD` / `COLOR_BG_HOVER` tokens are deliberately kept at
 * their existing rgba .02 / .06 values so the detail view continues
 * to read as "form-like" while the overview reads as "tile-like".
 *
 * The recipe is the standard dark-mode raised-surface pattern used by
 * Vercel / GitHub Primer / Linear:
 *
 *   1. Solid background, ~4% brighter than the panel. rgba surfaces
 *      blend into `#0e0e0e` and read as "highlighted text"; a solid
 *      step reads as "raised material".
 *
 *   2. 1px inset highlight on the top edge — simulates light
 *      catching the top of a physical surface. This is the single
 *      detail that turns a flat rectangle into a "card".
 *
 *   3. Soft 2px outer shadow underneath — actual lift.
 *
 *   4. The cyan "current" state still wins (faint cyan tint + cyan
 *      border) because that's the page's primary affordance.
 */
const ROW_BG = '#181818';
const ROW_BG_HOVER = '#1f1f1f';
const ROW_BORDER = 'rgba(255,255,255,0.08)';
const ROW_BORDER_HOVER = 'rgba(255,255,255,0.14)';
const ROW_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.4)';
const ROW_SHADOW_HOVER =
  'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 4px rgba(0,0,0,0.5)';

/**
 * AccessPointRow — one access-point card in the Overview list
 * (round 11 layout, 2026-05-08).
 *
 * Layout (single row, raised material):
 *
 *   /gtm/2026-4-7                                              ← path eyebrow (in parent)
 *   ┌══════════════════════════════════════════════════════┐
 *   │ gtm/2026-4-7 [Read & Write]            [💻] [↺] [✦]   │   ← raised tile (solid bg
 *   └══════════════════════════════════════════════════════┘     + inset top highlight
 *                                                                + soft drop shadow)
 *      └── name + RW glued together on the left.
 *      └─────────────────── chips pushed to the right edge
 *                           via `marginLeft: auto`.
 *
 * What changed in round 11 (this round):
 *
 *   - Card material upgraded from a near-invisible rgba .045 surface
 *     to a layered raised tile: solid `#181818` background (+1px
 *     inset top highlight + soft 2px outer drop shadow). The user's
 *     ask was "give it weight, make it feel like a pod"; the
 *     standard dark-mode raised-card recipe (Vercel / GitHub Primer
 *     / Linear) does exactly that. The shared `COLOR_BG_CARD` token
 *     is *not* changed — ConnectorCard / MethodCard inside the
 *     detail view stay recessive on purpose, because they're nested
 *     within an already-raised PanelShell.
 *
 *   - Padding bumped 8/12 → 11/14 and radius 8 → 10 to match the
 *     heavier weight. Cramped padding on a heavy card reads as
 *     "fat strip"; tile padding reads as "object".
 *
 *   - Hover state lifts the tile further (brighter bg, brighter
 *     inset highlight, deeper drop shadow). The cyan "current"
 *     state drops the shadows entirely — the accent border + tinted
 *     surface already do the lifting and shadows would muddy the
 *     cyan.
 *
 * What changed in earlier rounds (carried forward):
 *
 *   - RW pill sits *immediately* to the right of the name,
 *     glued by a normal flex gap. The chip strip is pushed to the
 *     row's right edge with `marginLeft: auto` so name+RW float at
 *     the natural width of the name, not at the right-end of a
 *     flex-grown name container.
 *
 *     Before: `[gtm                      RW] [💻][↺][✦]`
 *             (RW visually anchored to the right of an expanded
 *             name container, miles away from the literal "gtm"
 *             text — broke the "<scope> is <permission>" reading)
 *
 *     After:  `[gtm RW]                      [💻][↺][✦]`
 *             (RW reads as a property of the name; chips are
 *             clearly the "via" half of the sentence)
 *
 *   - Chips are glyph-only: 24×24px rounded squares carrying just
 *     the method or brand icon, no label text. The label was
 *     redundant once a user had learned the colour-coding (blue=
 *     terminal, green=sync, purple=agent) and ate horizontal budget
 *     better spent on the name. Tooltip on hover still spells out
 *     the method.
 *
 *   - `INTEGRATION_VISIBLE_CAP` raised from 3 to 5 because each chip
 *     is now a third of its previous width.
 *
 *   - Paused-method-hides rule is preserved — only `status ===
 *     'active'` chips render.
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
   *  currently viewing in the file tree. Drives the single cyan
   *  accent in the row chrome. */
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

  // Material picks the layered "raised" recipe described above.
  // `isCurrent` overrides hover (cyan accent always wins as the
  // primary affordance), `hovered` is the lifted variant of the same
  // raised surface, otherwise the resting state.
  const background = isCurrent
    ? COLOR_ACCENT_BG_FAINT
    : hovered
      ? ROW_BG_HOVER
      : ROW_BG;
  const borderColor = isCurrent
    ? COLOR_ACCENT_BORDER
    : hovered
      ? ROW_BORDER_HOVER
      : ROW_BORDER;
  // Drop the inset/outer shadows on the cyan "current" state — the
  // accent border + tinted surface already do the lifting and the
  // shadows would muddy the cyan colour.
  const boxShadow = isCurrent
    ? 'none'
    : hovered
      ? ROW_SHADOW_HOVER
      : ROW_SHADOW;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={`${scope.name} · ${pathDisplay}`}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        padding: '11px 14px',
        borderRadius: 10,
        border: `1px solid ${borderColor}`,
        background,
        boxShadow,
        color: COLOR_FG,
        cursor: 'pointer',
        transition:
          'border-color 0.15s, background 0.15s, box-shadow 0.15s',
      }}
    >
      {/* Name: takes intrinsic width, can shrink to truncate. We
          deliberately DON'T `flex-grow` — keeping name's container
          at its natural size means the RW pill below sits flush
          against the literal name text, not at the right end of an
          expanded container. */}
      <span
        style={{
          flex: '0 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.3,
          color: COLOR_FG,
        }}
      >
        {scope.name}
      </span>

      {/* RW pill — sits immediately after the name with the
          row-level 8px gap. Reads as a property of the name. */}
      <Pill variant={scope.mode === 'rw' ? 'rw' : 'r'}>
        {scope.mode === 'rw' ? 'Read & Write' : 'Read-only'}
      </Pill>

      {/* Chip strip — built-ins first in fixed order, then any
          active third-party integrations, then a `+N` overflow chip.
          `marginLeft: auto` consumes all free space to the LEFT of
          the strip, pinning it to the row's right edge. When the
          row is space-constrained the auto margin collapses to 0
          and the name's `flex: 0 1 auto` lets it truncate. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          flexShrink: 0,
          marginLeft: 'auto',
        }}
      >
        {cliActive && (
          <MethodChip method="terminal" title="Terminal CLI · active" />
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
              borderRadius: 7,
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
        borderRadius: 7,
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
        borderRadius: 7,
        background: 'rgba(255,255,255,0.05)',
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
