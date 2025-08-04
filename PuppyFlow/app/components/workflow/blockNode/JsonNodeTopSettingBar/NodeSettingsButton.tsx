// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import { Position, Node } from '@xyflow/react';
import React, { useState, useRef, useEffect, Fragment } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Transition } from '@headlessui/react';

type NodeSettingsControllerProps = {
  nodeid: string;
};

function NodeSettingsController({ nodeid }: NodeSettingsControllerProps) {
  const [isHovered, setHovered] = useState(false);
  const settingControllerRef = useRef<HTMLButtonElement | null>(null);
  const componentRef = useRef<HTMLDivElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false); // 更清晰的命名和布尔类型
  // const {searchNode, inactivateHandle} = useNodeContext()
  const {
    activatedNode,
    setHandleActivated,
    manageNodeasLocked,
    setNodeEditable,
    preventInactivateNode,
    clearAll,
  } = useNodesPerFlowContext();
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow();

  useEffect(() => {
    const currRef = componentRef.current;

    const closeSettings = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (currRef && !currRef.contains(target) && isMenuOpen) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('click', closeSettings);
    }

    return () => {
      document.removeEventListener('click', closeSettings);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (activatedNode?.id !== nodeid) {
      setIsMenuOpen(false);
    }
  }, [activatedNode?.id, nodeid]);

  const manageSettings = () => {
    const target = getNode(nodeid);
    if (target) {
      setHandleActivated(nodeid, null);
      setIsMenuOpen(prev => !prev); // 直接切换布尔值
    }
  };

  const clearMenu = () => {
    setIsMenuOpen(false);
  };

  const onMouseEnter = () => {
    setHovered(true);
  };

  const onMouseLeave = () => {
    setHovered(false);
  };

  // 从JsonNodeSettingMenu移植的方法
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

  const renderSettingMenu = () => {
    const parentNodeType = getNode(nodeid)?.type;
    if (parentNodeType === 'structured' && isMenuOpen) {
      return (
        <Transition
          show={isMenuOpen}
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
                    <rect
                      x='7'
                      y='13'
                      width='12'
                      height='7'
                      fill='currentColor'
                    />
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
                    ? 'Unlock the text'
                    : 'Lock the text'}
                </div>
              </button>
            </li>
            <li className='w-full h-[1px] bg-[#404040] my-[2px]'></li>
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
                    <path
                      d='M19 7L7 19'
                      stroke='currentColor'
                      strokeWidth='2'
                    />
                    <path
                      d='M19 19L7 7'
                      stroke='currentColor'
                      strokeWidth='2'
                    />
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
    return null;
  };

  const fillColor = isHovered || isMenuOpen ? '#BEBEBE' : '#6D7177';

  return (
    <div
      ref={componentRef}
      style={{ position: 'relative', isolation: 'isolate' }}
    >
      <button
        ref={settingControllerRef}
        className={`flex items-center justify-center ${isHovered || isMenuOpen ? 'bg-[#3E3E41]' : ''} w-[24px] h-[24px] rounded-[8px]`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={manageSettings}
      >
        <svg
          xmlns='http://www.w3.org/2000/svg'
          width='11'
          height='2'
          viewBox='0 0 11 2'
          fill='none'
        >
          <path d='M0 0H2V2H0V0Z' fill={fillColor} />
          <path d='M9 0H11V2H9V0Z' fill={fillColor} />
          <path d='M4.5 0H6.5V2H4.5V0Z' fill={fillColor} />
        </svg>
      </button>
      <div style={{ position: 'fixed', zIndex: 20000 }}>
        {renderSettingMenu()}
      </div>
    </div>
  );
}

export default NodeSettingsController;
