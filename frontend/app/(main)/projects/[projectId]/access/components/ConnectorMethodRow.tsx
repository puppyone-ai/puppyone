'use client';

import { useState, type ReactNode } from 'react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { getAccessProviderMethodMeta, isCliProvider, normalizeConnectorProvider } from '@/lib/accessProviderRegistry';
import { T } from '../lib/tokens';
import { STATUS_COLORS, STATUS_LABEL } from '../lib/constants';
import { isGitBuiltinProvider } from '../lib/format';
import { ProviderIcon, RetryIcon } from './icons';
import { ConnectorDetailBody } from './ConnectorCard';
import type { ConnectorEditPatch } from '../hooks/useAccessData';
import { GearIcon, formatScopePath } from './ScopeHeader';
import { ConnectorMethodCopyButton, ConnectorMethodPrompt } from './ConnectorMethodPrompt';
import { getProviderIconSize, getProviderTileSize, getProviderTileStyle } from './connectorVisuals';

export function ConnectorListRow({
  scope,
  connector,
  selected,
  showPromptPreview = false,
  onSelect,
  onConnect,
  onPauseResume,
  pending,
  showScopeLabel = false,
  showSettings = false,
  settingsOpen = false,
  onSettings,
}: {
  readonly scope: RepoScope | undefined;
  readonly connector: Connector;
  readonly selected: boolean;
  readonly showPromptPreview?: boolean;
  readonly onSelect: () => void;
  readonly onConnect: () => void;
  readonly onPauseResume: () => Promise<void> | void;
  readonly pending: boolean;
  readonly showScopeLabel?: boolean;
  readonly showSettings?: boolean;
  readonly settingsOpen?: boolean;
  readonly onSettings?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = getConnectorMethodMeta(connector);
  const dimmed = connector.status === 'paused';
  const tile = getProviderTileStyle(connector.provider, selected);
  const tileSize = getProviderTileSize(connector.provider);
  const iconSize = getProviderIconSize(connector.provider);
  const provider = normalizeConnectorProvider(connector.provider);
  const showManualCommands = isGitBuiltinProvider(connector.provider);
  const canConfigure = isCliProvider(provider) || connector.status === 'error' || !!connector.error_message;
  const canOpen = canConfigure || showSettings;
  const scopeLabel = showScopeLabel && scope ? getScopeChipLabel(scope) : null;
  const scopeTitle = scope ? formatScopePath(scope) : undefined;
  const compactDescription = getCompactConnectorDescription(meta.description, connector.provider);
  const previewOpen = selected || showPromptPreview;

  return (
    <div
      onClick={canOpen ? onSelect : undefined}
      onKeyDown={(e) => {
        if (!canOpen) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-pressed={canOpen ? selected : undefined}
      style={{
        minHeight: previewOpen ? 116 : 76,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: previewOpen ? 'minmax(0, 1fr) max-content minmax(220px, 236px)' : 'minmax(0, 1fr) max-content',
        alignItems: previewOpen ? 'stretch' : 'center',
        gap: previewOpen ? 12 : 14,
        padding: previewOpen ? '10px 12px' : '12px 14px',
        boxSizing: 'border-box',
        cursor: canOpen ? 'pointer' : 'default',
        background: selected
          ? 'color-mix(in srgb, var(--po-control) 52%, var(--po-panel) 48%)'
          : canOpen && hovered
            ? 'color-mix(in srgb, var(--po-control) 34%, var(--po-panel) 66%)'
            : 'transparent',
        opacity: dimmed ? 0.76 : 1,
        transition: `background 0.15s ${T.ease}, opacity 0.15s ${T.ease}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: previewOpen ? 'flex-start' : 'center', gap: previewOpen ? 10 : 12, minWidth: 0 }}>
        <div
          style={{
            height: tileSize,
            width: tileSize,
            borderRadius: isGitBuiltinProvider(connector.provider) ? 7 : 6,
            background: tile.background,
            border: `1px solid ${tile.border}`,
            color: tile.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: tile.shadow,
            overflow: isGitBuiltinProvider(connector.provider) ? 'hidden' : undefined,
          }}
        >
          <ProviderIcon provider={connector.provider} size={iconSize} />
        </div>
        <div
          style={{
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: previewOpen ? 8 : 5,
          }}
        >
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                minWidth: 0,
                display: 'inline-flex',
                alignItems: 'center',
                fontSize: 14,
                lineHeight: '18px',
                fontWeight: 500,
                color: T.text1,
                fontFamily: T.fontSans,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={meta.title}
            >
              {meta.title}
            </span>
            {scopeLabel ? (
              <>
                <ConnectorScopeBadge label={scopeLabel} title={scopeTitle} />
                {scopeTitle === '/' ? (
                  <span
                    style={{
                      color: T.text3,
                      fontSize: 12,
                      lineHeight: '16px',
                      fontFamily: T.fontMono,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    /
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <div
            style={{
              fontSize: 12,
              color: T.text2,
              fontFamily: T.fontSans,
              lineHeight: '18px',
              fontWeight: 400,
              whiteSpace: previewOpen ? 'normal' : 'nowrap',
              overflow: previewOpen ? 'visible' : 'hidden',
              textOverflow: previewOpen ? undefined : 'ellipsis',
            }}
            title={meta.description}
          >
            {previewOpen ? meta.description : compactDescription}
          </div>
          {previewOpen ? (
            <ConnectorCardUtilities
              selected={selected}
              showManualCommands={showManualCommands}
              showConfigure={canConfigure}
              showSettings={showSettings}
              settingsOpen={settingsOpen}
              onManualCommands={onConnect}
              onConfigure={onSelect}
              onSettings={onSettings}
            />
          ) : null}
        </div>
      </div>
      {previewOpen ? (
        <>
          <ConnectorAccessControl
            status={connector.status}
            pending={pending}
            onPauseResume={onPauseResume}
          />
          <ConnectorMethodPrompt connector={connector} scope={scope} />
        </>
      ) : (
        <ConnectorCollapsedActions
          connector={connector}
          scope={scope}
          status={connector.status}
          pending={pending}
          showSettings={showSettings}
          settingsOpen={settingsOpen}
          onPauseResume={onPauseResume}
          onSettings={onSettings}
          onOpen={onSelect}
        />
      )}
    </div>
  );
}

function ConnectorScopeBadge({
  label,
  title,
}: {
  readonly label: string;
  readonly title?: string;
}) {
  return (
    <span
      title={title ?? label}
      style={{
        maxWidth: 190,
        height: 24,
        padding: '0 10px',
        borderRadius: 999,
        border: `1px solid ${T.cardBorder}`,
        background: 'color-mix(in srgb, var(--po-control) 68%, var(--po-panel) 32%)',
        color: T.text2,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 600,
        fontFamily: label.startsWith('/') ? T.fontMono : T.fontSans,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flexShrink: 1,
      }}
    >
      {label}
    </span>
  );
}

function ConnectorCollapsedActions({
  connector,
  scope,
  status,
  pending,
  showSettings,
  settingsOpen,
  onPauseResume,
  onSettings,
  onOpen,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly status: string;
  readonly pending: boolean;
  readonly showSettings: boolean;
  readonly settingsOpen: boolean;
  readonly onPauseResume: () => Promise<void> | void;
  readonly onSettings?: () => void;
  readonly onOpen: () => void;
}) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        minWidth: 0,
      }}
    >
      <ConnectorAccessControl
        status={status}
        pending={pending}
        onPauseResume={onPauseResume}
      />
      <ConnectorMethodCopyButton
        connector={connector}
        scope={scope}
        style={{
          height: 32,
          minWidth: 124,
          boxShadow: 'none',
        }}
      />
      {showSettings && onSettings ? (
        <CollapsedPillButton
          label='Settings'
          icon={<GearIcon size={11} />}
          active={settingsOpen}
          onClick={onSettings}
        />
      ) : null}
      <button
        type='button'
        aria-label='Expand connector'
        onClick={onOpen}
        style={{
          width: 24,
          height: 32,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          borderRadius: 6,
          background: 'transparent',
          color: T.text2,
          cursor: 'pointer',
          fontFamily: T.fontSans,
          fontSize: 18,
          lineHeight: 1,
        }}
      >
        ›
      </button>
    </div>
  );
}

function CollapsedPillButton({
  label,
  icon,
  active,
  onClick,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type='button'
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 32,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '0 12px',
        borderRadius: 999,
        border: `1px solid ${active || hovered ? 'var(--po-border-strong)' : T.cardBorder}`,
        background: active || hovered
          ? 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)'
          : 'color-mix(in srgb, var(--po-control) 54%, var(--po-panel) 46%)',
        color: active ? T.text1 : T.text2,
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 500,
        fontFamily: T.fontSans,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: `background 0.15s ${T.ease}, border-color 0.15s ${T.ease}, color 0.15s ${T.ease}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

export function getConnectorMethodMeta(connector: Connector): {
  readonly title: string;
  readonly description: string;
} {
  return getAccessProviderMethodMeta(connector.provider, connector.name);
}

function getCompactConnectorDescription(description: string, providerName: string): string {
  if (isGitBuiltinProvider(providerName)) return 'Native Git clone and push.';
  if (isCliProvider(normalizeConnectorProvider(providerName))) return 'FS CLI · two-way access.';
  return description;
}

function ConnectorCardUtilities({
  selected,
  showManualCommands,
  showConfigure,
  showSettings,
  settingsOpen,
  onManualCommands,
  onConfigure,
  onSettings,
}: {
  readonly selected: boolean;
  readonly showManualCommands: boolean;
  readonly showConfigure: boolean;
  readonly showSettings: boolean;
  readonly settingsOpen: boolean;
  readonly onManualCommands: () => void;
  readonly onConfigure: () => void;
  readonly onSettings?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 24,
        flexWrap: 'wrap',
      }}
    >
      {showManualCommands ? (
        <ConnectorUtilityButton
          label='Manual commands'
          icon={<ChevronRightGlyph size={10} />}
          onClick={onManualCommands}
        />
      ) : null}
      {showConfigure ? (
        <ConnectorUtilityButton
          label='Configure'
          icon={
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                transform: selected ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: `transform 0.15s ${T.ease}`,
              }}
            >
              <ChevronDownGlyph size={10} />
            </span>
          }
          active={selected}
          onClick={onConfigure}
        />
      ) : null}
      {showSettings && onSettings ? (
        <ConnectorUtilityButton
          label='Settings'
          icon={<GearIcon size={10} />}
          active={settingsOpen}
          onClick={onSettings}
        />
      ) : null}
    </div>
  );
}

function ConnectorUtilityButton({
  label,
  icon,
  active = false,
  onClick,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly active?: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type='button'
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: 24,
        border: 'none',
        borderRadius: 5,
        background: active || hovered ? 'color-mix(in srgb, var(--po-control) 68%, transparent)' : 'transparent',
        color: active ? T.text1 : T.text2,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '0 6px',
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 400,
        fontFamily: T.fontSans,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: `background 0.15s ${T.ease}, color 0.15s ${T.ease}`,
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function ConnectorAccessControl({
  status,
  pending,
  onPauseResume,
}: {
  readonly status: string;
  readonly pending: boolean;
  readonly onPauseResume: () => Promise<void> | void;
}) {
  if (status === 'error') {
    return (
      <RowActionButton
        label='Retry'
        icon={<RetryIcon size={10} />}
        disabled={pending}
        onClick={onPauseResume}
      />
    );
  }

  const isOn = status === 'active' || status === 'syncing';
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: T.text2,
          fontFamily: T.fontSans,
          fontWeight: 400,
          whiteSpace: 'nowrap',
        }}
      >
        {isOn ? 'On' : 'Paused'}
      </span>
      <ConnectorToggle
        status={status}
        on={isOn}
        pending={pending}
        onToggle={onPauseResume}
      />
    </div>
  );
}

function RowActionButton({
  icon,
  label,
  tone = 'neutral',
  disabled,
  onClick,
}: {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly tone?: 'neutral' | 'success';
  readonly disabled: boolean;
  readonly onClick: () => Promise<void> | void;
}) {
  const [hovered, setHovered] = useState(false);
  const successTone = tone === 'success';
  const border = successTone
    ? 'color-mix(in srgb, var(--po-success) 38%, transparent)'
    : hovered
      ? 'var(--po-border-strong)'
      : T.border;
  const background = successTone
    ? hovered
      ? 'color-mix(in srgb, var(--po-success) 20%, var(--po-panel) 80%)'
      : 'color-mix(in srgb, var(--po-success) 14%, var(--po-panel) 86%)'
    : hovered
      ? 'var(--po-hover)'
      : 'transparent';
  const color = successTone ? 'var(--po-success)' : T.text2;

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        justifySelf: 'end',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        height: successTone ? 30 : 28,
        padding: successTone ? '0 12px' : '0 10px',
        borderRadius: 6,
        border: `1px solid ${border}`,
        background,
        color,
        fontSize: 12,
        fontWeight: 500,
        fontFamily: T.fontSans,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background 0.15s ${T.ease}, border-color 0.15s ${T.ease}, color 0.15s ${T.ease}`,
      }}
    >
      {icon ?? null}
      {label}
    </button>
  );
}

export function ConnectorExpandedDetail({
  connector,
  scope,
  pending,
  onPauseResume,
  onUpdate,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly pending: boolean;
  readonly onPauseResume: () => Promise<void> | void;
  readonly onUpdate: (patch: ConnectorEditPatch) => Promise<void>;
}) {
  const provider = normalizeConnectorProvider(connector.provider);
  const showError = connector.status === 'error' || !!connector.error_message;
  const showConfig = isCliProvider(provider);
  if (!showError && !showConfig) return null;

  return (
    <div
      style={{
        borderTop: `1px solid ${T.cardBorder}`,
        background: 'color-mix(in srgb, var(--po-control) 76%, var(--po-panel) 24%)',
      }}
    >
      {showError ? (
        <ConnectorManagementStrip
          connector={connector}
          pending={pending}
          onPauseResume={onPauseResume}
        />
      ) : null}
      {showConfig ? (
        <ConnectorDetailBody
          connector={connector}
          scope={scope}
          onPauseResume={onPauseResume}
          onUpdate={onUpdate}
          pending={pending}
          variant='inline'
        />
      ) : null}
    </div>
  );
}

function ConnectorManagementStrip({
  connector,
  pending,
  onPauseResume,
}: {
  readonly connector: Connector;
  readonly pending: boolean;
  readonly onPauseResume: () => Promise<void> | void;
}) {
  const provider = normalizeConnectorProvider(connector.provider);
  const statusColor = STATUS_COLORS[connector.status] ?? T.text2;
  const statusLabel = STATUS_LABEL[connector.status] ?? connector.status;
  const description =
    connector.status === 'paused'
      ? 'New requests through this method are rejected.'
      : connector.status === 'error'
        ? connector.error_message || 'This method needs attention before it can be used.'
        : 'Requests through this method are accepted.';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) max-content',
        alignItems: 'center',
        gap: 14,
        padding: '12px 16px',
        borderBottom: isCliProvider(provider) || connector.error_message ? `1px solid ${T.cardBorder}` : 'none',
      }}
    >
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 0,
            fontFamily: T.fontSans,
            fontSize: 12,
            lineHeight: '16px',
          }}
        >
          <span style={{ color: T.text1, fontWeight: 500 }}>Connector status</span>
          <span aria-hidden style={{ color: T.text4 }}>·</span>
          <span style={{ color: statusColor, fontWeight: 400 }}>{statusLabel}</span>
        </div>
        <div
          style={{
            color: T.text2,
            fontFamily: T.fontSans,
            fontSize: 12,
            lineHeight: '16px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={description}
        >
          {description}
        </div>
      </div>
      {connector.status === 'error' ? (
        <RowActionButton
          label='Retry'
          icon={<RetryIcon size={10} />}
          disabled={pending}
          onClick={onPauseResume}
        />
      ) : (
        <ConnectorAccessControl
          status={connector.status}
          pending={pending}
          onPauseResume={onPauseResume}
        />
      )}
    </div>
  );
}

const ChevronDownGlyph = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
    <polyline points='6 9 12 15 18 9' />
  </svg>
);

const ChevronRightGlyph = ({ size = 10 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' strokeLinejoin='round' aria-hidden>
    <polyline points='9 6 15 12 9 18' />
  </svg>
);

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
      size='xs'
      stopPropagation
      onCheckedChange={() => {
        void onToggle();
      }}
    />
  );
}

function getScopeChipLabel(scope: RepoScope): string {
  const path = formatScopePath(scope);
  return path === '/' ? 'Root' : path;
}
