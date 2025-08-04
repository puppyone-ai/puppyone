import React, { useEffect, useState } from 'react';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { useReactFlow, Position } from '@xyflow/react';
import { flushSync } from 'react-dom';

type DatabaseNodeSettingMenuProps = {
  showSettingMenu: number;
  clearMenu: () => void;
  nodeid: string;
};

function DatabaseNodeSettingMenu({
  showSettingMenu,
  clearMenu,
  nodeid,
}: DatabaseNodeSettingMenuProps) {
  const {
    manageNodeasInput,
    manageNodeasLocked,
    manageNodeasOutput,
    setNodeEditable,
    preventInactivateNode,
  } = useNodesPerFlowContext();
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow();
  // 0 未开始， 1待开始 ， 2 完成步骤1:disconnect handle ， 3 完成步骤二：delete node in the context 3. 完成步骤3: 在reactflow中删除节点和连线

  const deleteNode = () => {
    setEdges(prevEdges =>
      prevEdges.filter(edge => edge.source !== nodeid && edge.target !== nodeid)
    );
    setNodes(prevNodes => prevNodes.filter(node => node.id !== nodeid));
  };

  const manageEditLabel = () => {
    setNodeEditable(nodeid);
    preventInactivateNode();
    clearMenu();
  };

  return (
    <ul
      className={`flex flex-col absolute top-[21px] bg-[#3E3E41] rounded-[4px] left-0 z-[20000] ${showSettingMenu ? '' : 'hidden'}`}
    >
      <li>
        <button className='flex flex-row items-center justify-start px-[11px] pt-[6px] pb-[2px] gap-[6px] w-[108px] h-[24px] bg-[#3E3E41] border-none rounded-t-[4px] '>
          <div className='flex items-center justify-center'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='11'
              height='12'
              viewBox='0 0 11 12'
              fill='none'
            >
              <path d='M4 7.5L7 4.5' stroke='#BEBEBE' strokeWidth='1.5' />
              <rect
                x='6.75'
                y='1.25'
                width='3.5'
                height='3.5'
                stroke='#BEBEBE'
                strokeWidth='1.5'
              />
              <rect
                x='0.75'
                y='7.25'
                width='3.5'
                height='3.5'
                stroke='#BEBEBE'
                strokeWidth='1.5'
              />
            </svg>
          </div>
          <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
            Link
          </div>
        </button>
      </li>
      <li>
        <button
          className='flex flex-row items-center justify-start px-[11px] py-[2px] gap-[9px] w-[108px] h-[20px] bg-[#3E3E41]'
          onClick={() => manageNodeasLocked(nodeid)}
        >
          <div className='flex items-center justify-center'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='8'
              height='9'
              viewBox='0 0 8 9'
              fill='none'
            >
              <rect y='4' width='8' height='5' fill='#BEBEBE' />
              <rect
                x='1.75'
                y='0.75'
                width='4.5'
                height='6.5'
                rx='2.25'
                stroke='#BEBEBE'
                strokeWidth='1.5'
              />
            </svg>
          </div>
          <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
            {getNode(nodeid)?.data?.locked ? 'Unlock it' : 'Lock it'}
          </div>
        </button>
      </li>
      <li>
        <div className='h-[1px] w-[91px] bg-[#D9D9D9] mx-[8px] my-[5px]'></div>
      </li>
      <li>
        <button
          className='renameButton flex flex-row items-center justify-start px-[11px] py-[2px] gap-[8px] w-[108px] h-[20px] bg-[#3E3E41]'
          onClick={manageEditLabel}
        >
          <div className='renameButton flex items-center justify-center'>
            <svg
              className='renameButton'
              xmlns='http://www.w3.org/2000/svg'
              width='9'
              height='10'
              viewBox='0 0 9 10'
              fill='none'
            >
              <path
                d='M7 0.5L9.00006 2.50006L4.5 7L2.5 5L7 0.5Z'
                fill='#BEBEBE'
              />
              <path d='M2 5.5L4 7.5L1 8.5L2 5.5Z' fill='#BEBEBE' />
            </svg>
          </div>
          <div className='renameButton font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
            rename
          </div>
        </button>
      </li>
      <li>
        <button
          className='flex flex-row items-center justify-start px-[11px] pt-[2px] pb-[6px] gap-[7px] w-[108px] h-[24px] bg-[#3E3E41] rounded-b-[4px]'
          onClick={deleteNode}
        >
          <div className='flex items-center justify-center'>
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='10'
              height='10'
              viewBox='0 0 10 10'
              fill='none'
            >
              <path d='M9 1L1 9' stroke='#BEBEBE' strokeWidth='2' />
              <path d='M9 9L1 1' stroke='#BEBEBE' strokeWidth='2' />
            </svg>
          </div>
          <div className='font-plus-jakarta-sans text-[10px] font-normal leading-normal text-[#BEBEBE] whitespace-nowrap'>
            Delete
          </div>
        </button>
      </li>
    </ul>
  );
}

export default DatabaseNodeSettingMenu;
