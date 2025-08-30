'use client';

import React, { useMemo, useState } from 'react';
import { Controls, useReactFlow } from '@xyflow/react';
import SaveButton from './SaveButton';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';

export default function Upright() {
  const { getNodes } = useReactFlow();
  const { activateNode } = useNodesPerFlowContext();
  const [areGroupsOpen, setAreGroupsOpen] = useState(true);

  const groups = useMemo(() => {
    return getNodes()
      .filter(n => n.type === 'group')
      .map(n => ({ id: n.id, name: String(n.data?.label || n.id) }));
  }, [getNodes]);

  return (
    <div className='flex flex-col items-end gap-2 pointer-events-auto'>
      <div className='flex items-start gap-3'>
        <SaveButton />
        <Controls
          className='react-flow__controls-custom'
          showZoom={true}
          showFitView={true}
          showInteractive={false}
          orientation='horizontal'
          style={{ position: 'relative' }}
        />
        <div className='relative'>
          <button
            className='inline-flex items-center gap-1.5 h-[32px] rounded-[8px] px-2.5 border border-[#3A3A3A] bg-[#181818] text-[#CDCDCD] hover:bg-[#444444]'
            title='Groups'
            aria-label='Toggle group list'
            aria-expanded={areGroupsOpen}
            onClick={e => {
              e.preventDefault();
              e.stopPropagation();
              setAreGroupsOpen(v => !v);
            }}
          >
            <svg width='12' height='12' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
              <path d='M8 4V20' stroke='#CDCDCD' strokeWidth='1.8' strokeLinecap='round' />
              <path d='M16 4V20' stroke='#CDCDCD' strokeWidth='1.8' strokeLinecap='round' />
              <path d='M4 8H20' stroke='#CDCDCD' strokeWidth='1.8' strokeLinecap='round' />
              <path d='M4 16H20' stroke='#CDCDCD' strokeWidth='1.8' strokeLinecap='round' />
            </svg>
            <span className='text-[12px]'>Groups</span>
            {areGroupsOpen ? (
              <svg width='10' height='10' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M6 14L12 8L18 14' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
            ) : (
              <svg width='10' height='10' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                <path d='M6 10L12 16L18 10' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' />
              </svg>
            )}
          </button>
          {areGroupsOpen && (
            <div className='absolute right-0 top-full mt-2 z-[10001]'>
              <div className='py-[8px] px-[8px] w-[300px] bg-[#181818] border border-[#3A3A3A] rounded-[8px] shadow-2xl'>
                <div className='text-[#808080] text-[12px] mb-1 px-[2px]'>Groups</div>
                {groups.length === 0 ? (
                  <div className='text-[#606060] text-[12px] px-[2px] py-[6px]'>No Groups yet</div>
                ) : (
                  <div className='space-y-1 max-h-[200px] overflow-y-auto'>
                    {groups.map(g => (
                      <button
                        key={g.id}
                        className='w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border transition-colors border-[#404040] hover:bg-[#2A2A2A] text-[#CDCDCD] text-[12px]'
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          activateNode(g.id);
                        }}
                      >
                        <span className='truncate'>{g.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {/* Group dropdown attached to button above */}
    </div>
  );
}


