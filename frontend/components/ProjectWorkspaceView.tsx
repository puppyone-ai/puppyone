'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTable } from '../lib/hooks/useData';
import {
  updateTableData,
  type TableInfo,
  type ProjectInfo,
} from '../lib/projectsApi';
import { EditorSkeleton } from './Skeleton';
import TreeLineDiscreteEditor from './editors/tree/TreeLineDiscreteEditor';
import TableDiscreteEditor from './editors/table/TableDiscreteEditor';

import MonacoJsonEditor from './editors/code/MonacoJsonEditor';
import type { EditorType } from './ProjectsHeader';
import type { ProjectTableJSON } from '../lib/projectData';
import { type McpToolPermissions } from '../lib/mcpApi';

// 简化版 ProjectWorkspaceView
export function ProjectWorkspaceView({
  projectId,
  activeTableId,
  onActiveTableChange,
  editorType = 'table',
  ...props // 忽略其他非核心 props
}: any) {
  // 1. 数据获取
  // 确保 activeTableId 是字符串
  const validTableId = activeTableId ? String(activeTableId) : undefined;
  const {
    tableData: rawTableData,
    isLoading,
    error,
  } = useTable(projectId, validTableId);

  // 2. 数据处理 - 直接使用原始数据，不做任何转换
  const tableData = useMemo(() => {
    if (!rawTableData?.data) return undefined;
    return rawTableData.data as ProjectTableJSON;
  }, [rawTableData]);

  // 3. 本地状态
  const [localData, setLocalData] = useState<any>(undefined);
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 当从后端获取到新数据，且本地没有未保存的更改时，同步数据
    if (tableData && !isSaving) {
      setLocalData(tableData);
    }
  }, [tableData]); // 移除 isSaving 依赖，防止保存状态变化导致的回滚

  // 4. 保存逻辑 (带防抖)
  const handleDataChange = (newData: any) => {
    setLocalData(newData);

    // 清除之前的定时器
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // 2秒防抖保存
    saveTimeoutRef.current = setTimeout(async () => {
      if (!projectId || !validTableId) return;

      setIsSaving(true);
      try {
        // 直接保存原始数据，不做任何转换
        await updateTableData(projectId, validTableId, newData);
        console.log('[AutoSave] Saved successfully');
      } catch (err) {
        console.error('[AutoSave] Failed:', err);
      } finally {
        setIsSaving(false);
      }
    }, 2000);
  };

  // 5. 渲染
  // 强制全屏容器
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 编辑器区域 */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 20,
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {isSaving ? (
            <span
              style={{
                background: 'rgba(0,0,0,0.6)',
                color: '#ddd',
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              Saving...
            </span>
          ) : null}
        </div>

        {isLoading && !tableData ? (
          <div style={{ position: 'absolute', inset: 0, padding: 20 }}>
            <EditorSkeleton />
          </div>
        ) : error ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <div
              style={{
                width: 'min(560px, 100%)',
                background: '#111111',
                border: '1px solid #2a2a2a',
                borderRadius: 12,
                padding: '22px 20px',
                boxShadow:
                  '0 24px 48px rgba(0,0,0,0.35), 0 12px 24px rgba(0,0,0,0.35)',
              }}
            >
              <div
                style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 999,
                    background: '#1a1a1a',
                    border: '1px solid #333',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none'>
                    <path
                      d='M12 9v4m0 4h.01M10.29 3.86l-8.2 14.2A2 2 0 0 0 3.82 21h16.36a2 2 0 0 0 1.73-2.94l-8.2-14.2a2 2 0 0 0-3.42 0Z'
                      stroke='#9ca3af'
                      strokeWidth='1.6'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    />
                  </svg>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: '#e5e7eb',
                      marginBottom: 6,
                      lineHeight: 1.2,
                    }}
                  >
                    This page isn’t working
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: '#9ca3af',
                      lineHeight: 1.5,
                      marginBottom: 10,
                    }}
                  >
                    The table data failed to load. Try again later, or check
                    your network connection.
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: '#6b7280',
                      background: '#0b0b0b',
                      border: '1px solid #202020',
                      borderRadius: 8,
                      padding: '10px 12px',
                      fontFamily:
                        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {String(error.message || error)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : localData || tableData ? (
          editorType === 'treeline-virtual' ? (
            <div style={{ position: 'absolute', inset: 0 }}>
              <TreeLineDiscreteEditor
                json={localData || tableData}
                onChange={handleDataChange}
                // 传递所有业务回调
                onPathChange={props.onTreePathChange}
                onAddAccessPoint={props.onAddAccessPoint}
                onAccessPointChange={props.onAccessPointChange}
                onAccessPointRemove={props.onAccessPointRemove}
                configuredAccessPoints={props.configuredAccessPoints}
                projectId={Number(projectId)}
                tableId={validTableId ? Number(validTableId) : undefined}
                onImportSuccess={props.onImportSuccess}
                onOpenDocument={props.onOpenDocument}
              />
            </div>
          ) : editorType === 'table' ? (
            <div style={{ position: 'absolute', inset: 0 }}>
              <TableDiscreteEditor
                json={localData || tableData}
                onChange={handleDataChange}
                onPathChange={props.onTreePathChange}
                onAddAccessPoint={props.onAddAccessPoint}
                onAccessPointChange={props.onAccessPointChange}
                onAccessPointRemove={props.onAccessPointRemove}
                configuredAccessPoints={props.configuredAccessPoints}
                projectId={Number(projectId)}
                tableId={validTableId ? Number(validTableId) : undefined}
                onImportSuccess={props.onImportSuccess}
                onOpenDocument={props.onOpenDocument}
              />
            </div>
          ) : (
            <div style={{ position: 'absolute', inset: 0 }}>
              <MonacoJsonEditor
                json={localData || tableData}
                onChange={handleDataChange}
              />
            </div>
          )
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
            }}
          >
            Select a table to view data
          </div>
        )}
      </div>
    </div>
  );
}
