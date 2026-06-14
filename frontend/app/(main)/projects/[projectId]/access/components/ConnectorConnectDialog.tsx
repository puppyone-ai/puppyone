'use client';

import { useMemo } from 'react';
import { DialogBody, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { buildGitSyncPrompt } from '@/lib/accessPointCliPrompt';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { T } from '../lib/tokens';
import { getApiBase, isGitBuiltinProvider } from '../lib/format';
import { ProviderIcon } from './icons';
import { CommandBlock, NoAccessKeyNotice } from './ui-blocks';
import { ConnectorAccessPanel } from './quick-connect';
import { formatScopePath } from './ScopeHeader';
import { getConnectorDisplayName, getProviderIconSize, getProviderTileSize, getProviderTileStyle } from './connectorVisuals';

export function ConnectorConnectDialog({
  connector,
  scope,
  onClose,
}: {
  readonly connector: Connector;
  readonly scope: RepoScope | undefined;
  readonly onClose: () => void;
}) {
  const name = getConnectorDisplayName(connector);
  const tile = getProviderTileStyle(connector.provider, false);
  const tileSize = getProviderTileSize(connector.provider);
  const iconSize = getProviderIconSize(connector.provider);
  const isGitRemote = isGitBuiltinProvider(connector.provider);

  return (
    <DialogRoot onClose={onClose}>
      <DialogSurface width={680} maxHeight='min(760px, calc(100vh - 32px))'>
        <DialogHeader
          title={isGitRemote ? 'Git commands' : `Connect ${name}`}
          description={
            isGitRemote
              ? `${scope ? formatScopePath(scope) : 'Scope'} · terminal setup`
              : undefined
          }
          onClose={onClose}
          style={{ padding: '14px 20px 4px' }}
          leading={
            <div
              style={{
                width: tileSize,
                height: tileSize,
                borderRadius: isGitBuiltinProvider(connector.provider) ? 7 : 6,
                background: tile.background,
                border: `1px solid ${tile.border}`,
                color: tile.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: isGitBuiltinProvider(connector.provider) ? 'hidden' : undefined,
              }}
            >
              <ProviderIcon provider={connector.provider} size={iconSize} />
            </div>
          }
        />
        <DialogBody style={{ padding: '4px 20px 20px' }}>
          {isGitRemote ? (
            <GitManualCommandsPanel scope={scope} />
          ) : (
            <ConnectorAccessPanel
              connector={connector}
              scope={scope}
            />
          )}
        </DialogBody>
      </DialogSurface>
    </DialogRoot>
  );
}

function GitManualCommandsPanel({
  scope,
}: {
  readonly scope: RepoScope | undefined;
}) {
  const steps = useMemo(() => {
    if (!scope) return [];
    const scopeName = scope.name || (scope.path === '' ? 'root' : scope.path || 'Root');
    const gitUrl = `${getApiBase()}/git/ap/${scope.access_key || '<access-key>'}.git`;
    const guide = buildGitSyncPrompt({
      gitUrl,
      scopeName,
      directoryName: scopeName,
    });
    return [
      { title: 'Clone into a folder', lines: guide.cloneLines },
      { title: 'Connect an existing folder', lines: guide.existingFolderLines },
      { title: 'Daily workflow', lines: guide.workflowLines },
    ];
  }, [scope]);

  if (!scope) {
    return (
      <div style={{ color: T.text3, fontSize: 12, lineHeight: '18px', fontFamily: T.fontSans }}>
        Select a scope before using Git commands.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {!scope.access_key ? <NoAccessKeyNotice /> : null}
      <div
        style={{
          color: T.text2,
          fontSize: 12,
          lineHeight: '18px',
          fontFamily: T.fontSans,
        }}
      >
        Run one of these command groups in Terminal. This remote is bound to {formatScopePath(scope)}.
      </div>
      <ManualCommandSteps steps={steps} />
    </div>
  );
}

function ManualCommandSteps({
  steps,
}: {
  readonly steps: ReadonlyArray<{ title: string; lines: readonly string[] }>;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {steps.map((step, index) => (
        <div key={step.title} style={{ display: 'flex', gap: 10 }}>
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              background: 'var(--po-border-subtle)',
              color: T.text2,
              fontSize: 10,
              fontWeight: 600,
              fontFamily: T.fontSans,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 1,
            }}
          >
            {index + 1}
          </span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span
              style={{
                color: T.text1,
                fontSize: 12,
                lineHeight: '18px',
                fontWeight: 600,
                fontFamily: T.fontSans,
              }}
            >
              {step.title}
            </span>
            <CommandBlock lines={step.lines} />
          </div>
        </div>
      ))}
    </div>
  );
}

