import React, { useEffect, useState, useRef } from 'react';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { useReactFlow } from '@xyflow/react';

function SaveButton() {
  // 使用新的 Context API
  const { showingItem, workspaces, getCurrentWorkspace, workspaceManagement } =
    useWorkspaces();
  const [saveState, setSaveState] = useState<'error' | 'success' | 'idle'>(
    'idle'
  );
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();
  const { getNodes, getEdges, getViewport } = useReactFlow();

  // 获取当前显示的工作区
  const currentWorkspace = getCurrentWorkspace();
  const currentWorkspaceId =
    showingItem?.type === 'workspace' ? showingItem.id : null;

  // 实现真正的保存逻辑
  const handleSave = async () => {
    try {
      if (currentWorkspaceId && currentWorkspace) {
        // 获取当前工作区的完整数据
        const nodes = getNodes().map((n: any) => {
          const { measured, ...rest } = n || {};
          return rest;
        });
        const edges = getEdges();
        const viewport = getViewport();

        const workspaceData = {
          blocks: nodes,
          edges: edges,
          viewport: viewport,
          version: '1.0.0',
        };

        // 使用 workspaceManagement 中的保存功能
        const timestamp = new Date().toISOString();
        const success = await workspaceManagement.saveWorkspaceContent(
          currentWorkspaceId,
          workspaceData,
          timestamp
        );

        if (success) {
          console.log('Successfully saved workspace:', currentWorkspaceId);
          setSaveState('success');
        } else {
          throw new Error('Failed to save workspace');
        }
      }
    } catch (error) {
      console.error('Error when saving:', error);
      setSaveState('error');
    }
  };

  const handleSaveButton = async () => {
    if (currentWorkspaceId) {
      await handleSave();
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (saveState === 'success' || saveState === 'error') {
        setSaveState('idle');
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [saveState]);

  const saveButtonText =
    saveState === 'idle' ? 'Save' : saveState === 'success' ? 'Saved' : 'Error';

  return (
    <button
      className={`inline-flex items-center gap-1.5 h-[36px] rounded-[8px] px-2 border border-[#2A2A2A] bg-transparent text-[#CDCDCD] transition-colors ${
        isOnGeneratingNewNode ? 'pointer-events-none' : 'pointer-events-auto'
      } hover:bg-[#444444]`}
      title='Save'
      aria-label='Save'
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        handleSaveButton();
      }}
    >
      {saveState === 'idle' ? (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='14'
          height='14'
          viewBox='0 0 14 14'
          fill='none'
        >
          <path
            fillRule='evenodd'
            clipRule='evenodd'
            d='M4 0C1.79086 0 0 1.79086 0 4V10C0 12.2091 1.79086 14 4 14H10C12.2091 14 14 12.2091 14 10V4C14 1.79086 12.2091 0 10 0H4ZM4 2C2.89543 2 2 2.89543 2 4C2 5.10457 2.89543 6 4 6H10C11.1046 6 12 5.10457 12 4C12 2.89543 11.1046 2 10 2H4Z'
            fill='#CDCDCD'
          />
        </svg>
      ) : saveState === 'success' ? (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='14'
          height='14'
          viewBox='0 0 14 14'
          fill='none'
        >
          <path
            fillRule='evenodd'
            clipRule='evenodd'
            d='M3 0C1.34315 0 0 1.34315 0 3V11C0 12.6569 1.34315 14 3 14H11C12.6569 14 14 12.6569 14 11V3C14 1.34315 12.6569 0 11 0H3ZM2.00916 7.15893L4.71223 10.616L5.43941 11.546L6.23715 10.6757L11.7372 4.67572L10.2628 3.32428L5.56059 8.45401L3.58471 5.92701L2.00916 7.15893Z'
            fill='#39bc66'
          />
        </svg>
      ) : (
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='14'
          height='14'
          viewBox='0 0 14 14'
          fill='none'
        >
          <path
            fillRule='evenodd'
            clipRule='evenodd'
            d='M3 0C1.34315 0 0 1.34315 0 3V11C0 12.6569 1.34315 14 3 14H11C12.6569 14 14 12.6569 14 11V3C14 1.34315 12.6569 0 11 0H3ZM4.46447 4.46447L7 7L9.53553 4.46447L10.5355 5.46447L8 8L10.5355 10.5355L9.53553 11.5355L7 9L4.46447 11.5355L3.46447 10.5355L6 8L3.46447 5.46447L4.46447 4.46447Z'
            fill='#f44336'
          />
        </svg>
      )}
      <span
        className={
          saveState === 'success'
            ? 'text-[12px] text-[#39bc66]'
            : saveState === 'error'
              ? 'text-[12px] text-[#f44336]'
              : 'text-[12px] text-[#CDCDCD]'
        }
      >
        {saveButtonText}
      </span>
    </button>
  );
}

export default SaveButton;
