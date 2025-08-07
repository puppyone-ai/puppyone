import React, { useEffect, useState, Fragment } from 'react';
import { useReactFlow, Position } from '@xyflow/react';
import { flushSync } from 'react-dom';
import { useNodesPerFlowContext } from '../../../../states/NodesPerFlowContext';
import { Transition } from '@headlessui/react';

type WebLinkNodeSettingMenuProps = {
  showSettingMenu: number;
  clearMenu: () => void;
  nodeid: string;
};

function WebLinkNodeSettingMenu({
  showSettingMenu,
  clearMenu,
  nodeid,
}: WebLinkNodeSettingMenuProps) {
  const {
    manageNodeasInput,
    manageNodeasLocked,
    manageNodeasOutput,
    setNodeEditable,
    preventInactivateNode,
  } = useNodesPerFlowContext();
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow();

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
    <Transition
      show={!!showSettingMenu}
      as={Fragment}
      enter='transition ease-out duration-100'
      enterFrom='transform opacity-0 translate-y-[-10px]'
      enterTo='transform opacity-100 translate-y-0'
      leave='transition ease-in duration-75'
      leaveFrom='transform opacity-100 translate-y-0'
      leaveTo='transform opacity-0 translate-y-[-10px]'
    >
      <ul className='flex flex-col absolute top-[8px] p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px] left-0 z-[20000]'>
        <li>
          <button className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'>
            <div className='flex items-center justify-center'>
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  fillRule='evenodd'
                  clipRule='evenodd'
                  d='M14.9705 12.3963C14.9054 12.2987 14.8305 12.2059 14.746 12.1192C14.0069 11.3612 12.8085 11.3612 12.0694 12.1192L10.3383 13.8946C9.59917 14.6526 9.59917 15.8816 10.3383 16.6396C11.0774 17.3976 12.2757 17.3976 13.0148 16.6396L14.143 15.4826L13.4449 14.7666L12.3167 15.9236C11.9632 16.2862 11.39 16.2862 11.0364 15.9236C10.6829 15.5611 10.6829 14.9732 11.0364 14.6106L12.7675 12.8352C13.1211 12.4726 13.6943 12.4726 14.0479 12.8352C14.1356 12.9251 14.2015 13.0289 14.2457 13.1397L14.9705 12.3963Z'
                  fill='currentColor'
                />
                <path
                  fillRule='evenodd'
                  clipRule='evenodd'
                  d='M12.8103 13.6044C12.8754 13.7019 12.9502 13.7947 13.0347 13.8813C13.7738 14.6393 14.9721 14.6393 15.7112 13.8813L17.4424 12.1059C18.1815 11.3479 18.1815 10.1189 17.4424 9.36087C16.7033 8.60285 15.5049 8.60285 14.7658 9.36087L13.6374 10.5181L14.3356 11.2341L15.4639 10.0768C15.8175 9.71425 16.3907 9.71425 16.7442 10.0768C17.0978 10.4394 17.0978 11.0273 16.7442 11.3899L15.0131 13.1653C14.6596 13.5279 14.0863 13.5279 13.7328 13.1653C13.6452 13.0754 13.5793 12.9717 13.5351 12.8611L12.8103 13.6044Z'
                  fill='currentColor'
                />
              </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
              Update Link
            </div>
          </button>
        </li>
        <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
        <li>
          <button
            className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
            onClick={() => manageNodeasLocked(nodeid)}
          >
            <div className='flex items-center justify-center'>
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <rect x='7' y='13' width='12' height='7' fill='currentColor' />
                <rect
                  x='9'
                  y='7'
                  width='8'
                  height='11'
                  rx='4'
                  stroke='currentColor'
                  strokeWidth='2'
                />
              </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
              {getNode(nodeid)?.data?.locked
                ? 'Unlock the Link'
                : 'Lock the Link'}
            </div>
          </button>
        </li>
        <li>
          <button
            className='renameButton flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#CDCDCD] hover:text-white'
            onClick={manageEditLabel}
          >
            <div className='renameButton flex items-center justify-center'>
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M16.8891 6L20.0003 9.11118L13.0002 16.111L9.88915 13L16.8891 6Z'
                  fill='currentColor'
                />
                <path
                  d='M9.1109 13.7776L12.222 16.8887L7.55536 18.4442L9.1109 13.7776Z'
                  fill='currentColor'
                />
              </svg>
            </div>
            <div className='renameButton font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
              Rename
            </div>
          </button>
        </li>
        <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
        <li>
          <button
            className='flex flex-row items-center justify-start gap-[8px] w-full h-[26px] hover:bg-[#3E3E41] rounded-[4px] border-none text-[#F44336] hover:text-[#FF6B64]'
            onClick={deleteNode}
          >
            <div className='flex items-center justify-center'>
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path d='M19 7L7 19' stroke='currentColor' strokeWidth='2' />
                <path d='M19 19L7 7' stroke='currentColor' strokeWidth='2' />
              </svg>
            </div>
            <div className='font-plus-jakarta-sans text-[12px] font-normal leading-normal whitespace-nowrap'>
              Delete
            </div>
          </button>
        </li>
      </ul>
    </Transition>
  );
}

export default WebLinkNodeSettingMenu;
