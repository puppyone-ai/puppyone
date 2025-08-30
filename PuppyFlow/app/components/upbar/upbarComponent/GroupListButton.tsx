'use client';

import React, { Fragment, useMemo } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';

export default function GroupListButton() {
  const { getNodes } = useReactFlow();
  const { isOnGeneratingNewNode, activateNode } = useNodesPerFlowContext();

  // 计算当前工作区内的所有 Group 节点
  const groups = useMemo(() => {
    return getNodes()
      .filter(n => n.type === 'group')
      .map(n => ({ id: n.id, name: String(n.data?.label || n.id) }));
  }, [getNodes]);

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
            {groups.map(g => (
              <Menu.Item key={g.id}>
                {({ active }) => (
                  <button
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border transition-colors ${
                      active ? 'bg-[#2A2A2A] border-[#404040]' : 'border-[#404040] hover:bg-[#2A2A2A]'
                    }`}
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      activateNode(g.id);
                    }}
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
                  </button>
                )}
              </Menu.Item>
            ))}
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
