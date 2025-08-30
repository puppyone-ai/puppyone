'use client';

import React, { Fragment, useMemo, useState } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import useJsonConstructUtils from '@/app/components/hooks/useJsonConstructUtils';
import useGetSourceTarget from '@/app/components/hooks/useGetSourceTarget';
import { forceSyncDirtyNodes } from '@/app/components/workflow/utils/externalStorage';
import { useWorkspaceManagement } from '@/app/components/hooks/useWorkspaceManagement';
import {
  runGroupNode,
  RunGroupNodeContext,
} from '@/app/components/workflow/edgesNode/edgeNodesNew/hook/runGroupNodeExecutor';
import { GroupDeployToolbar } from '@/app/components/workflow/groupNode/GroupDeployToolbar';

export default function GroupListButton() {
  const { getNodes, getNode, setNodes } = useReactFlow();
  const { clearAll, isOnGeneratingNewNode } = useNodesPerFlowContext();
  const {
    reportError,
    resetLoadingUI,
    streamResult,
    streamResultForMultipleNodes,
  } = useJsonConstructUtils();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();
  const { fetchUserId } = useWorkspaceManagement();

  // 计算当前工作区内的所有 Group 节点
  const groups = useMemo(() => {
    return getNodes()
      .filter(n => n.type === 'group')
      .map(n => ({ id: n.id, name: String(n.data?.label || n.id) }));
  }, [getNodes]);

  // 控制面板：default 列表 或 deploy:<groupId>
  const [activePanel, setActivePanel] = useState<string | null>('default');
  // 跑任务的忙碌状态：记录正在运行的 groupId
  const [runningGroupIds, setRunningGroupIds] = useState<Set<string>>(new Set());

  const handleRunGroup = async (groupId: string) => {
    if (runningGroupIds.has(groupId)) return;

    // 如果在生成新节点，阻止运行
    if (isOnGeneratingNewNode) return;

    try {
      setRunningGroupIds(prev => new Set(prev).add(groupId));

      // 运行前强制同步所有脏节点，确保运行数据一致
      await forceSyncDirtyNodes({
        getNodes: () => getNodes() as unknown as any[],
        setNodes: (updater: (nodes: any[]) => any[]) =>
          setNodes((prev: any) => updater(prev as any)),
        getUserId: fetchUserId as any,
      });

      const context: RunGroupNodeContext = {
        getNode,
        getNodes,
        setNodes,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        // 组运行内部主要使用 streamResultForMultipleNodes，这里同时提供占位的 streamResult
        streamResult: async (_taskId: string, _nodeId: string) => Promise.resolve(),
        streamResultForMultipleNodes,
        reportError,
        resetLoadingUI,
      };

      await runGroupNode({ groupNodeId: groupId, context });
    } catch (error) {
      console.error('Error running group:', error);
      window.alert('Failed to run the selected group. See console for details.');
    } finally {
      setRunningGroupIds(prev => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
    }
  };

  const renderListPanel = () => {
    return (
      <div className='py-[12px] px-[12px] w-[380px]'>
        <div className='text-[#808080] text-[13px] mb-2 px-[4px]'>
          Groups in Workspace
        </div>
        {groups.length === 0 ? (
          <div className='text-[#606060] text-[12px] px-[4px] py-[8px]'>
            No Groups yet
          </div>
        ) : (
          <div className='space-y-2 max-h-[260px] overflow-y-auto'>
            {groups.map(g => {
              const isRunning = runningGroupIds.has(g.id);
              return (
                <div
                  key={g.id}
                  className='flex items-center justify-between gap-2 px-3 py-2 rounded-md border border-[#404040] hover:bg-[#2A2A2A] transition-colors'
                >
                  <div className='flex items-center gap-2 min-w-0'>
                    <div className='w-5 h-5 flex items-center justify-center flex-shrink-0'>
                      <svg width='12' height='12' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M8 4V20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                        <path d='M16 4V20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                        <path d='M4 8H20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                        <path d='M4 16H20' stroke='#9B7EDB' strokeWidth='2' strokeLinecap='round' />
                      </svg>
                    </div>
                    <div className='truncate text-[12px] text-[#CDCDCD]'>
                      {g.name}
                    </div>
                  </div>
                  <div className='flex items-center gap-2 flex-shrink-0'>
                    <button
                      className={`h-[28px] px-2 rounded-md text-[12px] border transition-colors ${
                        isRunning
                          ? 'border-[#2A2A2A] bg-[#2A2A2A] text-[#39BC66] opacity-60 cursor-not-allowed'
                          : 'border-[#2A2A2A] bg-[#2A2A2A] text-[#39BC66] hover:bg-[#39BC66] hover:text-black active:scale-95'
                      }`}
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRunGroup(g.id);
                      }}
                      disabled={isRunning}
                    >
                      {isRunning ? 'Running…' : 'Run'}
                    </button>
                    <button
                      className='h-[28px] px-2 rounded-md text-[12px] border border-[#2A2A2A] bg-[#2A2A2A] text-[#FFA73D] hover:bg-[#FFA73D] hover:text-black active:scale-95'
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        setActivePanel(`deploy:${g.id}`);
                      }}
                    >
                      Deploy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderActivePanel = () => {
    if (activePanel?.startsWith('deploy:')) {
      const groupId = activePanel.replace('deploy:', '');
      return (
        <div className='p-2'>
          <div className='flex items-center justify-between px-2 pt-2 pb-1'>
            <div className='text-[#808080] text-[13px]'>Deploy Group</div>
            <button
              className='h-[26px] px-2 rounded-md text-[12px] border border-[#2A2A2A] bg-[#2A2A2A] text-[#CDCDCD] hover:bg-[#3A3A3A] active:scale-95'
              onClick={() => setActivePanel('default')}
            >
              Back
            </button>
          </div>
          <GroupDeployToolbar groupNodeId={groupId} onClose={() => setActivePanel('default')} />
        </div>
      );
    }

    return renderListPanel();
  };

  return (
    <Menu as='div' className='relative'>
      {({ open }) => (
        <>
          <Menu.Button
            className='group inline-flex items-center gap-2 h-[36px] rounded-md px-2.5 py-1.5 border border-[#2A2A2A] bg-[#2A2A2A] text-[13px] font-medium text-[#CDCDCD] hover:bg-[#3A3A3A] transition-colors'
            title='Group List'
          >
            <svg
              width='16'
              height='16'
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
            <span>Group List</span>
          </Menu.Button>

          <Transition
            as={Fragment}
            enter='transition ease-out duration-100'
            enterFrom='transform opacity-0 translate-y-[-10px]'
            enterTo='transform opacity-100 translate-y-0'
            leave='transition ease-in duration-75'
            leaveFrom='transform opacity-100 translate-y-0'
            leaveTo='transform opacity-0 translate-y-[-10px]'
          >
            <Menu.Items className='absolute right-0 mt-[16px] w-[400px] origin-top-right rounded-2xl bg-[#1E1E1E] shadow-lg border border-[#343434] focus:outline-none'>
              {renderActivePanel()}
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  );
}
