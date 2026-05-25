'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { DialogBody, DialogHeader, DialogRoot, DialogSurface } from '@/components/ui/Dialog';
import { CreateAccessModal } from '../../../access/components/CreateAccessModal';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { AllAccessPointsList } from './AllAccessPointsList';
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
        >
          <NewAccessPointHeaderButton onClick={onCreateAccess} />
        </DialogHeader>
        <DialogBody style={{ padding: '10px 20px 20px' }}>
          <AllAccessPointsList
            scopes={scopes}
            connectorsByScope={connectorsByScope}
            providerIcons={providerIcons}
            currentScopePath=""
            onSelectScope={onSelectScope}
          />
        </DialogBody>
      </DialogSurface>
    </DialogRoot>
  );
}

function NewAccessPointHeaderButton({
  onClick,
}: {
  readonly onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Create a new access point"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        minHeight: 30,
        padding: '0 12px',
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--po-accent) 42%, var(--po-border))',
        background: hovered
          ? 'color-mix(in srgb, var(--po-accent) 84%, var(--po-surface))'
          : 'color-mix(in srgb, var(--po-accent) 76%, var(--po-surface))',
        color: 'var(--po-accent-text)',
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 600,
        letterSpacing: 0,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        boxShadow: hovered
          ? '0 6px 16px color-mix(in srgb, var(--po-accent) 18%, transparent)'
          : '0 3px 10px color-mix(in srgb, var(--po-accent) 10%, transparent)',
        transition: 'background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <Plus size={14} strokeWidth={2.1} aria-hidden />
      <span>New access point</span>
    </button>
  );
}
