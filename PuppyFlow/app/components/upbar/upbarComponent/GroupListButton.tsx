'use client';

import React, { Fragment, useMemo, useCallback } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';
import useGetSourceTarget from '../../hooks/useGetSourceTarget';
import { runGroupNode } from '../../workflow/edgesNode/edgeNodesNew/hook/runGroupNodeExecutor';

export default function GroupListButton() {
  const { isOnGeneratingNewNode, activateNode, clearAll } = useNodesPerFlowContext();
  const { getCurrentWorkspaceContent } = useWorkspaces();
  const { getNode, getNodes, setNodes } = useReactFlow();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useGetSourceTarget();
  const { streamResult, streamResultForMultipleNodes, reportError, resetLoadingUI } = useJsonConstructUtils();

  const content = getCurrentWorkspaceContent?.() ?? null;

  // 计算当前工作区内的所有 Group 节点
  const groups = useMemo(() => {
    const blocks = content?.blocks ?? [];
    return blocks
      .filter(n => n?.type === 'group')
      .map(n => ({ id: String(n.id), name: String(n?.data?.label ?? n.id) }));
  }, [content]);

  const groupCounts = useMemo(() => {
    const blocks = content?.blocks ?? [];
    const counts: Record<string, number> = {};
    const countableTypes = new Set(['text', 'file', 'weblink', 'structured']);
    blocks.forEach((node: any) => {
      if (!countableTypes.has(node?.type)) return;
      const groupIds = node?.data?.groupIds;
      if (Array.isArray(groupIds)) {
        groupIds.forEach((gid: string) => {
          counts[gid] = (counts[gid] ?? 0) + 1;
        });
      }
    });
    return counts;
  }, [content]);

  const handleRunGroup = useCallback(async (groupId: string) => {
    try {
      await runGroupNode({
        groupNodeId: groupId,
        context: {
          getNode,
          getNodes,
          setNodes,
          getSourceNodeIdWithLabel,
          getTargetNodeIdWithLabel,
          clearAll,
          streamResult,
          streamResultForMultipleNodes,
          reportError,
          resetLoadingUI,
          isLocalDeployment: false,
        },
      });
    } catch (error) {
      console.error('Failed to run group:', error);
    }
  }, [
    getNode,
    getNodes,
    setNodes,
    getSourceNodeIdWithLabel,
    getTargetNodeIdWithLabel,
    clearAll,
    streamResult,
    streamResultForMultipleNodes,
    reportError,
    resetLoadingUI,
  ]);

  const renderListPanel = () => {
    return (
      <div className='w-[380px] rounded-[12px] bg-[#1E1E1E] border border-[#343434] shadow-2xl'>
        <div className='p-[12px]'>
          <div className='text-[#808080] text-[13px] mb-2 px-[4px]'>
            Groups in Workspace
          </div>
          {groups.length === 0 ? (
            <div className='text-[#A0A0A0] text-[12px] px-[8px] py-[10px] rounded-[8px] border border-[#343434] bg-[#232323]'>
              No Groups yet
            </div>
          ) : (
            <div className='max-h-[260px] overflow-y-auto'>
              <ul role='list' aria-label='Workspace groups' className='rounded-[8px] border border-[#343434] bg-[#232323] divide-y divide-[#2E2E2E]'>
                {groups.map(g => (
                  <Menu.Item key={g.id}>
                    {({ active }) => (
                      <li>
                        <div
                          className={`px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                            active ? 'bg-[#2A2A2A]' : 'hover:bg-[#2A2A2A]'
                          }`}
                          onClick={e => {
                            e.preventDefault();
                            e.stopPropagation();
                            activateNode(g.id);
                          }}
                        >
                          <div className='flex items-center gap-2 min-w-0'>
                            <div className='w-5 h-5 flex items-center justify-center flex-shrink-0 rounded-[6px] bg-[#282828] border border-[#3A3A3A]'>
                              <svg width='12' height='12' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                                <path d='M8 4V20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                                <path d='M16 4V20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                                <path d='M4 8H20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                                <path d='M4 16H20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                              </svg>
                            </div>
                            <div className='truncate text-[12px] text-[#E0E0E0]'>{g.name}</div>
                            <div className='text-[10px] text-[#666666] whitespace-nowrap'>
                              ({groupCounts[g.id] ?? 0} {(groupCounts[g.id] ?? 0) === 1 ? 'node' : 'nodes'})
                            </div>
                          </div>
                          <button
                            className='flex items-center justify-center w-[22px] h-[22px] rounded-[6px] border border-[#3A3A3A] bg-[#2A2A2A] text-[#39bc66] hover:bg-[#39bc66] hover:text-black active:scale-95'
                            title='Run group'
                            aria-label={`Run group ${g.name}`}
                            onClick={e => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRunGroup(g.id);
                            }}
                          >
                            <svg width='12' height='12' viewBox='0 0 24 24' fill='currentColor' xmlns='http://www.w3.org/2000/svg'>
                              <path d='M8 5V19L19 12L8 5Z' />
                            </svg>
                          </button>
                        </div>
                      </li>
                    )}
                  </Menu.Item>
                ))}
              </ul>
            </div>
          )}

          <div className='mt-3 pt-3 border-t border-[#343434]'>
            <button
              className={`w-full h-[32px] rounded-md text-[12px] border transition-colors flex items-center justify-center gap-2 ${
                isOnGeneratingNewNode
                  ? 'border-[#2A2A2A] bg-[#2A2A2A] text-[#CDCDCD] opacity-60 cursor-not-allowed'
                  : 'border-[#2A2A2A] bg-[#2A2A2A] text-[#CDCDCD] hover:bg-[#3A3A3A] active:scale-95'
              }`}
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent('openAddNodeMenu', {
                    detail: { preselect: 'group' },
                  } as any)
                );
              }}
              disabled={isOnGeneratingNewNode}
              title='New Group'
              aria-label='New Group'
            >
              <svg width='12' height='12' viewBox='0 0 16 16' fill='currentColor' xmlns='http://www.w3.org/2000/svg'>
                <polygon points='2,2 11,6 8,7 9,12 7,12 6,8 2,9' />
              </svg>
              <span>New Group</span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderActivePanel = () => {
    return renderListPanel();
  };

  return (
    <button
      className='inline-flex items-center justify-center h-[36px] w-[36px] rounded-md px-0 py-0 border border-[#2A2A2A] bg-transparent text-[#CDCDCD] hover:bg-[#444444] transition-colors'
      title='New Group'
      aria-label='New Group'
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(
          new CustomEvent('openAddNodeMenu', {
            detail: { preselect: 'group', startDirect: true },
          } as any)
        );
      }}
    >
      <svg
        width='20'
        height='20'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className='text-[#CDCDCD]'
      >
        <path d='M8 4V20' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
        <path d='M16 4V20' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
        <path d='M4 8H20' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
        <path d='M4 16H20' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
      </svg>
    </button>
  );
}
