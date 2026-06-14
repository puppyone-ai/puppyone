'use client';

import { useState } from 'react';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { T } from '../lib/tokens';
import type { ConnectorEditPatch } from '../hooks/useAccessData';
import { ConnectorConnectDialog } from './ConnectorConnectDialog';
import { ConnectorExpandedDetail, ConnectorListRow } from './ConnectorMethodRow';

// ─── ConnectorList ──────────────────────────────────────────────────
//
// Compact table-style list inspired by the newer Access direction:
// every connector is a row with identity, state, recency, and an
// immediate on/off control. The selected row expands in-place for the
// heavier setup/configuration material, so the page stays scannable
// until the user asks for detail.

export function ConnectorList({
  scope,
  connectors,
  selectedId,
  onSelect,
  onPauseResume,
  onUpdate,
  pendingConnectorIds,
}: {
  readonly scope: RepoScope | undefined;
  readonly connectors: readonly Connector[];
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onPauseResume: (id: string) => Promise<void> | void;
  readonly onUpdate: (id: string, patch: ConnectorEditPatch) => Promise<void>;
  readonly pendingConnectorIds: ReadonlySet<string>;
}) {
  const [connectDialogConnector, setConnectDialogConnector] = useState<Connector | null>(null);

  return (
    <>
      <div
        style={{
          marginBottom: 20,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {connectors.map((connector) => {
          const selected = connector.id === selectedId;
          const pending = pendingConnectorIds.has(connector.id);
          return (
            <div
              key={connector.id}
              style={{
                borderRadius: 8,
                border: `1px solid ${selected ? 'var(--po-border-strong)' : T.cardBorder}`,
                background: 'var(--po-panel)',
                overflow: 'hidden',
                boxShadow: selected ? '0 1px 2px color-mix(in srgb, var(--po-shadow) 18%, transparent)' : 'none',
                transition: `border-color 0.15s ${T.ease}, box-shadow 0.15s ${T.ease}`,
              }}
            >
              <ConnectorListRow
                scope={scope}
                connector={connector}
                selected={selected}
                showPromptPreview
                onSelect={() => onSelect(connector.id)}
                onConnect={() => setConnectDialogConnector(connector)}
                onPauseResume={() => onPauseResume(connector.id)}
                pending={pending}
              />
              {selected ? (
                <ConnectorExpandedDetail
                  connector={connector}
                  scope={scope}
                  pending={pending}
                  onPauseResume={() => onPauseResume(connector.id)}
                  onUpdate={(patch) => onUpdate(connector.id, patch)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {connectDialogConnector ? (
        <ConnectorConnectDialog
          connector={connectDialogConnector}
          scope={scope}
          onClose={() => setConnectDialogConnector(null)}
        />
      ) : null}
    </>
  );
}
