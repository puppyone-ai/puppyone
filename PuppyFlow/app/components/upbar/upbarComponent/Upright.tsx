'use client';

import React, { useMemo, useState, useCallback, Fragment } from 'react';
import { Controls, useReactFlow } from '@xyflow/react';
import SaveButton from './SaveButton';
import MoreOptionsButton from './MoreOptionsButton';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';
import useGetSourceTarget from '../../hooks/useGetSourceTarget';
import { runGroupNode } from '../../workflow/edgesNode/edgeNodesNew/hook/runGroupNodeExecutor';

export default function Upright() {
  const { activateNode, clearAll } = useNodesPerFlowContext();
  const { getCurrentWorkspaceContent } = useWorkspaces();
  const { getNode, getNodes, setNodes } = useReactFlow();
  const {
    streamResult,
    streamResultForMultipleNodes,
    reportError,
    resetLoadingUI,
  } = useJsonConstructUtils();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();
  const [areGroupsOpen, setAreGroupsOpen] = useState(true);
  const [topRightMenu, setTopRightMenu] = useState<number>(-1);

  const content = getCurrentWorkspaceContent?.() ?? null;

  const groups = useMemo(() => {
    const blocks = content?.blocks ?? [];
    return blocks
      .filter(n => n?.type === 'group')
      .map(n => ({ id: String(n.id), name: String(n?.data?.label ?? n.id) }));
  }, [content]);

  // Keep menu logically open; visually collapse when there are no groups

  const handleRunGroup = useCallback(
    async (groupId: string) => {
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
    },
    [
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
    ]
  );

  return (
    <div className='will-change-auto bg-[#1E1E1E] rounded-[12px] border border-[#343434] ring-1 ring-black/20 shadow-xl shadow-black/30 backdrop-blur-md flex items-center gap-[8px] px-[8px] py-[6px] pointer-events-auto'>
      <SaveButton />
      <MoreOptionsButton
        showMenu={topRightMenu}
        showMenuHandler={setTopRightMenu}
      />
      <div
        className='w-px h-[36px] bg-[#3e3e41] opacity-90 mx-0'
        aria-hidden
      ></div>
      <Controls
        className='react-flow__controls-custom'
        showZoom={true}
        showFitView={true}
        showInteractive={false}
        orientation='horizontal'
        style={{ position: 'relative' }}
      />
      <div
        className='w-px h-[36px] bg-[#3e3e41] opacity-90 mx-0'
        aria-hidden
      ></div>
      <div className='relative'>
        <button
          className='inline-flex items-center gap-1.5 h-[36px] rounded-[8px] px-2 border border-[#2A2A2A] bg-transparent text-[#CDCDCD] hover:bg-[#444444]'
          title='Groups'
          aria-label='Toggle group list'
          aria-expanded={areGroupsOpen}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            setAreGroupsOpen(v => !v);
          }}
        >
          <svg
            width='12'
            height='12'
            viewBox='0 0 24 24'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
          >
            <path
              d='M8 4V20'
              stroke='#CDCDCD'
              strokeWidth='1.8'
              strokeLinecap='round'
            />
            <path
              d='M16 4V20'
              stroke='#CDCDCD'
              strokeWidth='1.8'
              strokeLinecap='round'
            />
            <path
              d='M4 8H20'
              stroke='#CDCDCD'
              strokeWidth='1.8'
              strokeLinecap='round'
            />
            <path
              d='M4 16H20'
              stroke='#CDCDCD'
              strokeWidth='1.8'
              strokeLinecap='round'
            />
          </svg>
          <span className='text-[12px]'>Groups</span>
          {areGroupsOpen ? (
            <svg
              width='10'
              height='10'
              viewBox='0 0 24 24'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M6 14L12 8L18 14'
                stroke='#CDCDCD'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          ) : (
            <svg
              width='10'
              height='10'
              viewBox='0 0 24 24'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M6 10L12 16L18 10'
                stroke='#CDCDCD'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
          )}
        </button>
        {areGroupsOpen && (
          <div className='absolute right-0 top-full mt-4 z-[10001] translate-x-[8px]'>
            <div
              className={`w-[220px] rounded-[8px] shadow-none transition-all duration-150 ${
                groups.length === 0
                  ? 'h-0 p-0 opacity-0 bg-transparent border-0 pointer-events-none overflow-hidden'
                  : 'py-[8px] opacity-100 bg-transparent border-0'
              }`}
            >
              <div className='max-h-[200px] overflow-y-auto flex flex-col'>
                {groups.map((g, idx) => (
                  <React.Fragment key={g.id}>
                    {idx > 0 && <div className='h-[4px] bg-[#181818]' />}
                    <div
                      className='w-full flex items-center justify-between gap-2 pl-3 p-2 rounded-[8px] bg-[#232323] hover:bg-[#2A2A2A] text-[#CDCDCD] text-[12px] cursor-pointer'
                      onClick={e => {
                        e.preventDefault();
                        e.stopPropagation();
                        activateNode(g.id);
                      }}
                    >
                      <div className='flex items-center gap-2 min-w-0'>
                        <span className='truncate'>{g.name}</span>
                      </div>
                      <button
                        className='inline-flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] border border-[#404040] text-[#39bc66] hover:bg-[#39bc66] hover:text-black active:scale-95'
                        title='Run group'
                        aria-label={`Run group ${g.name}`}
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRunGroup(g.id);
                        }}
                      >
                        <svg
                          width='12'
                          height='12'
                          viewBox='0 0 24 24'
                          fill='currentColor'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path d='M8 5V19L19 12L8 5Z' />
                        </svg>
                        <span className='text-[12px]'>Run</span>
                      </button>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
