'use client';

import { CreateAccessModal } from '../../../access/components/CreateAccessModal';
import type { Connector, RepoScope } from '@/lib/repoApi';
import { DataAccessQuickModal } from './DataAccessQuickModal';

export function DataAccessModalHost({
  projectId,
  quickAccessScope,
  quickAccessConnectors,
  createAccessInitialPath,
  existingScopes,
  connectorsByScope,
  onCloseQuickAccess,
  onCreateAccess,
  onOpenFullSettings,
  onCloseCreateAccess,
  onCreated,
}: {
  projectId: string;
  quickAccessScope: RepoScope | null;
  quickAccessConnectors: Connector[];
  createAccessInitialPath: string | null;
  existingScopes: RepoScope[];
  connectorsByScope: Map<string, Connector[]>;
  onCloseQuickAccess: () => void;
  onCreateAccess: (folderPath: string | null | undefined) => void;
  onOpenFullSettings: (scopeId: string) => void;
  onCloseCreateAccess: () => void;
  onCreated: (scope: RepoScope) => void | Promise<void>;
}) {
  return (
    <>
      {quickAccessScope && (
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
