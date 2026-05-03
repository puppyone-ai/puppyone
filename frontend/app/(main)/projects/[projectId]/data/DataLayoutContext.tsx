'use client';

import { createContext, useContext } from 'react';
import type { Tool } from '@/lib/mcpApi';
import type { Connector, RepoScope } from '@/lib/repoApi';

export interface SyncStatusSync {
  id: string;
  path: string | null;
  provider: string;
  direction: string;
  status: string;
  name?: string;
  access_key?: string;
}

export interface SyncEndpointInfo {
  syncId: string;
  provider: string;
  direction: string;
  status: string;
  name?: string;
  accessKey?: string | null;
}

export interface DataLayoutContextValue {
  syncStatusData: { syncs: SyncStatusSync[] } | undefined;
  mutateSyncStatus: () => Promise<any>;
  projectTools: Tool[];
  syncEndpoints: Map<string, SyncEndpointInfo>;
  nodeEndpointMap: Map<string, SyncEndpointInfo[]>;

  /** Redesign (access-point-redesign-2026-05-02) — scopes + connectors. */
  scopes: RepoScope[];
  /** Index of connectors by scope_id. cli + agent are always present per scope (DB trigger). */
  connectorsByScope: Map<string, Connector[]>;
  mutateRepo: () => Promise<unknown>;
}

const DataLayoutContext = createContext<DataLayoutContextValue | null>(null);

export function useDataLayout() {
  const ctx = useContext(DataLayoutContext);
  if (!ctx) throw new Error('useDataLayout must be used within DataLayout');
  return ctx;
}

export { DataLayoutContext };
