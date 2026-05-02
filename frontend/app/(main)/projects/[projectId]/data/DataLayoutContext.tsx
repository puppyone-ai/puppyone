'use client';

import { createContext, useContext } from 'react';
import type { Tool } from '@/lib/mcpApi';

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
}

const DataLayoutContext = createContext<DataLayoutContextValue | null>(null);

export function useDataLayout() {
  const ctx = useContext(DataLayoutContext);
  if (!ctx) throw new Error('useDataLayout must be used within DataLayout');
  return ctx;
}

export { DataLayoutContext };
