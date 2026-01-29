'use client';

import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import type { AccessPoint } from '@/lib/mcpApi';

interface WorkspaceContextValue {
  // Current workspace state
  tableData: unknown;
  tableId: string;
  projectId: string;
  tableNameById: Record<string, string>;
  accessPoints: AccessPoint[];
  
  // Refresh callbacks
  onDataUpdate: (() => Promise<void>) | null;
  
  // Setters (called by page components)
  setTableData: (data: unknown) => void;
  setTableId: (id: string) => void;
  setProjectId: (id: string) => void;
  setTableNameById: (map: Record<string, string>) => void;
  setAccessPoints: (points: AccessPoint[]) => void;
  setOnDataUpdate: (callback: (() => Promise<void>) | null) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [tableData, setTableData] = useState<unknown>(undefined);
  const [tableId, setTableId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [tableNameById, setTableNameById] = useState<Record<string, string>>({});
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [onDataUpdate, setOnDataUpdateState] = useState<(() => Promise<void>) | null>(null);

  const setOnDataUpdate = useCallback((callback: (() => Promise<void>) | null) => {
    setOnDataUpdateState(() => callback);
  }, []);

  return (
    <WorkspaceContext.Provider
      value={{
        tableData,
        tableId,
        projectId,
        tableNameById,
        accessPoints,
        onDataUpdate,
        setTableData,
        setTableId,
        setProjectId,
        setTableNameById,
        setAccessPoints,
        setOnDataUpdate,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

