'use client';

import { useState } from 'react';
import type { Connector, RepoScope } from '@/lib/repoApi';
import {
  getAccessProviderDefinition,
  SIDEBAR_SIGNAL_PROVIDER_IDS,
  isGitRemoteProvider,
  normalizeConnectorProvider,
} from '@/lib/accessProviderRegistry';
import { SIDEBAR_ROW_TYPOGRAPHY } from '@/lib/uiTypography';
import { T } from '../lib/tokens';
import { ProviderIcon } from './icons';

export function ScopeSidebar({
  scopes,
  connectorsByScope,
  selectedScopeId,
  onSelect,
}: {
  readonly scopes: readonly RepoScope[];
  readonly connectorsByScope: ReadonlyMap<string, readonly Connector[]>;
  readonly selectedScopeId: string | undefined;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        flex: 1,
        minWidth: 0,
        borderRight: '1px solid var(--po-border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--po-canvas)',
      }}
    >
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          paddingTop: 6,
        }}
      >
        <div style={{ padding: '0 0 6px 0', position: 'relative', boxSizing: 'border-box' }}>
          {scopes.map((scope) => (
            <ScopeSidebarRow
              key={scope.id}
              scope={scope}
              connectors={connectorsByScope.get(scope.id) ?? []}
              isSelected={scope.id === selectedScopeId}
              onClick={() => onSelect(scope.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ScopeSidebarRow({
  scope,
  connectors,
  isSelected,
  onClick,
}: {
  readonly scope: RepoScope;
  readonly connectors: readonly Connector[];
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isWorkspaceWide = scope.path === '' || scope.is_root;
  const displayName = isWorkspaceWide
    ? (scope.name || 'Workspace root')
    : (scope.name || scope.path.split('/').filter(Boolean).pop() || scope.path);
  const subPath = isWorkspaceWide ? '/' : `/${scope.path}`;
  const active = connectors.some(isConnectorActive);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        margin: '3px 6px',
        minHeight: 50,
        boxSizing: 'border-box',
        borderRadius: 6,
        background: isSelected ? 'var(--po-selected)' : hovered ? 'var(--po-hover)' : 'transparent',
        color: isSelected ? T.text1 : hovered ? T.text1 : T.text2,
        ...SIDEBAR_ROW_TYPOGRAPHY,
        userSelect: 'none',
        transition: 'background 0.1s, color 0.1s',
        cursor: 'pointer',
        position: 'relative',
      }}
      title={`${displayName} · ${subPath}`}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 4,
          height: '100%',
          boxSizing: 'border-box',
          padding: '6px 8px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            width: '100%',
            minWidth: 0,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              flexShrink: 0,
              background: active ? 'var(--po-success)' : T.text4,
              boxShadow: active ? '0 0 6px color-mix(in srgb, var(--po-success) 40%, transparent)' : 'none',
            }}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: T.fontSans,
              fontWeight: isSelected ? 600 : 500,
            }}
          >
            {displayName}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            minWidth: 0,
            paddingLeft: 14,
          }}
        >
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 10,
              color: isSelected ? T.text2 : T.text3,
              fontFamily: T.fontMono,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {subPath}
          </span>
          <SidebarSignals connectors={connectors} isSelected={isSelected} />
        </div>
      </div>
    </div>
  );
}

function SidebarSignals({
  connectors,
  isSelected,
}: {
  readonly connectors: readonly Connector[];
  readonly isSelected: boolean;
}) {
  const activeBuiltIns = SIDEBAR_SIGNAL_PROVIDER_IDS
    .map((provider) => connectors.find((connector) =>
      normalizeConnectorProvider(connector.provider) === provider && isConnectorActive(connector),
    ))
    .filter((connector): connector is Connector => Boolean(connector));
  if (activeBuiltIns.length === 0) return null;

  return (
    <span
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
      }}
    >
      {activeBuiltIns.map((connector) => (
        <SidebarProviderChip
          key={connector.id}
          provider={connector.provider}
          selected={isSelected}
        />
      ))}
    </span>
  );
}

function isConnectorActive(connector: Connector): boolean {
  return connector.status === 'active' || connector.status === 'syncing';
}

function SidebarProviderChip({
  provider,
  selected,
}: {
  readonly provider: string;
  readonly selected: boolean;
}) {
  const normalizedProvider = normalizeConnectorProvider(provider);
  const isGit = isGitRemoteProvider(normalizedProvider);
  const definition = getAccessProviderDefinition(normalizedProvider);
  const title = `${definition.cardTitle || definition.label} active`;

  return (
    <span
      title={title}
      style={{
        width: 18,
        height: 18,
        borderRadius: 5,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        background: selected ? 'var(--po-hover)' : 'color-mix(in srgb, var(--po-hover) 55%, transparent)',
        border: `1px solid ${selected ? 'var(--po-border-strong)' : T.border}`,
        color: selected ? T.text2 : T.text3,
        opacity: selected ? 1 : 0.9,
        boxShadow: 'none',
      }}
    >
      <ProviderIcon provider={provider} size={isGit ? 13 : 10} variant='mono' />
    </span>
  );
}
