'use client';

import { DialogBody, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { CreateAccessModal } from '../../../access/components/CreateAccessModal';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { AllAccessPointsList } from './AllAccessPointsList';
import { CreateAccessPointCTACard } from './CreateAccessPointCTACard';
import { DataAccessQuickModal } from './DataAccessQuickModal';
import type { ProviderIconLookup } from './types';

export function DataAccessModalHost({
  projectId,
  accessOverviewOpen,
  quickAccessScope,
  quickAccessConnectors,
  createAccessInitialPath,
  existingScopes,
  connectorsByScope,
  providerIcons,
  onCloseAccessOverview,
  onOpenExistingAccess,
  onCloseQuickAccess,
  onCreateAccess,
  onOpenFullSettings,
  onCloseCreateAccess,
  onCreated,
}: {
  projectId: string;
  accessOverviewOpen: boolean;
  quickAccessScope: RepoScope | null;
  quickAccessConnectors: Connector[];
  createAccessInitialPath: string | null;
  existingScopes: RepoScope[];
  connectorsByScope: Map<string, Connector[]>;
  providerIcons: ProviderIconLookup;
  onCloseAccessOverview: () => void;
  onOpenExistingAccess: (scope: RepoScope) => void;
  onCloseQuickAccess: () => void;
  onCreateAccess: (folderPath: string | null | undefined) => void;
  onOpenFullSettings: (scopeId: string) => void;
  onCloseCreateAccess: () => void;
  onCreated: (scope: RepoScope) => void | Promise<void>;
}) {
  return (
    <>
      {accessOverviewOpen && !quickAccessScope && createAccessInitialPath === null && (
        <DataAccessOverviewModal
          scopes={existingScopes}
          connectorsByScope={connectorsByScope}
          providerIcons={providerIcons}
          onClose={onCloseAccessOverview}
          onSelectScope={(scopeId) => {
            const scope = existingScopes.find((item) => item.id === scopeId);
            if (scope) onOpenExistingAccess(scope);
          }}
          onCreateAccess={() => onCreateAccess(null)}
        />
      )}

      {quickAccessScope && createAccessInitialPath === null && (
        <DataAccessQuickModal
          scope={quickAccessScope}
          connectors={quickAccessConnectors}
          onClose={onCloseQuickAccess}
          onCreateAccess={onCreateAccess}
          onOpenFullSettings={onOpenFullSettings}
        />
      )}

      {createAccessInitialPath !== null && (
        <CreateAccessModal
          projectId={projectId}
          existingScopes={existingScopes}
          connectorsByScope={connectorsByScope}
          initialPath={createAccessInitialPath}
          onClose={onCloseCreateAccess}
          onCreated={onCreated}
        />
      )}
    </>
  );
}

function DataAccessOverviewModal({
  scopes,
  connectorsByScope,
  providerIcons,
  onClose,
  onSelectScope,
  onCreateAccess,
}: {
  readonly scopes: RepoScope[];
  readonly connectorsByScope: Map<string, Connector[]>;
  readonly providerIcons: ProviderIconLookup;
  readonly onClose: () => void;
  readonly onSelectScope: (scopeId: string) => void;
  readonly onCreateAccess: () => void;
}) {
  return (
    <DialogRoot open onClose={onClose} backdrop="strong" dismissOnBackdrop>
      <DialogSurface width={560} ariaLabel="Access">
        <DialogHeader
          title={
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span>Access</span>
              <span style={{ color: 'var(--po-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                {scopes.length}
              </span>
            </span>
          }
          description="Manage existing access points or create a new folder boundary."
          onClose={onClose}
        />
        <DialogBody style={{ padding: '10px 20px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <AllAccessPointsList
              scopes={scopes}
              connectorsByScope={connectorsByScope}
              providerIcons={providerIcons}
              currentScopePath={null}
              onSelectScope={onSelectScope}
            />
            <CreateAccessPointCTACard onCreate={onCreateAccess} />
          </div>
        </DialogBody>
      </DialogSurface>
    </DialogRoot>
  );
}
