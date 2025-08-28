'use client';

import React from 'react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';

export default function AddGroupButton() {
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();

  return (
    <button
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        // 不再直接创建 Group，只打开 + Add Block 菜单
        window.dispatchEvent(
          new CustomEvent('openAddNodeMenu', {
            detail: { preselect: 'group' },
          } as any)
        );
      }}
      className={`group inline-flex items-center gap-2 h-[36px] rounded-md px-2.5 py-1.5 border text-[13px] font-medium transition-colors bg-[#2A2A2A] border-[#2A2A2A] text-[#CDCDCD] hover:bg-[#3A3A3A] ${
        isOnGeneratingNewNode ? 'pointer-events-none opacity-60' : 'pointer-events-auto'
      }`}
      title='Group'
      aria-label='Group'
    >
      <svg
        width='14'
        height='14'
        viewBox='0 0 24 24'
        fill='none'
        xmlns='http://www.w3.org/2000/svg'
        className='text-current'
      >
        <rect
          x='3'
          y='3'
          width='18'
          height='18'
          rx='2'
          stroke='currentColor'
          strokeWidth='1.5'
          strokeDasharray='4 4'
        />
      </svg>
      <span>Group</span>
    </button>
  );
}
