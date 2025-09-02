// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import { Position, Node } from '@xyflow/react';
import React, { useState, useRef, useEffect, Fragment } from 'react';
import { useReactFlow } from '@xyflow/react';
import { Transition } from '@headlessui/react';
import { createPortal } from 'react-dom';

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
    setNodeEditable,
    preventInactivateNode,
    clearAll,
  } = useNodesPerFlowContext();
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow();
  // container for the portaled menu
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const currRef = componentRef.current;

    const closeSettings = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const clickedInsideButton = !!currRef && currRef.contains(target);
      const clickedInsideMenu = !!menuContainerRef.current && menuContainerRef.current.contains(target);
      if (!clickedInsideButton && !clickedInsideMenu && isMenuOpen) {
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

  // Keep menu tethered to button position (independent of React Flow zoom/pan)
  useEffect(() => {
    if (!isMenuOpen) return;

    let rafId: number | null = null;

    const positionMenu = () => {
      const btn = settingControllerRef.current;
      const container = menuContainerRef.current;
      if (!btn || !container) {
        rafId = requestAnimationFrame(positionMenu);
        return;
      }
      const rect = btn.getBoundingClientRect();
      const GAP = 8;
      const MENU_WIDTH = 160; // matches w-[160px]
      const top = rect.bottom + GAP;
      let left = rect.left; // align menu's left edge to button's left edge
      left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));

      container.style.position = 'fixed';
      container.style.top = `${top}px`;
      container.style.left = `${left}px`;
      container.style.zIndex = '2000000';

      rafId = requestAnimationFrame(positionMenu);
    };

    positionMenu();

    const onScroll = () => positionMenu();
    const onResize = () => positionMenu();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [isMenuOpen]);

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
      const menu = (
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
          <ul
            className='flex flex-col p-[8px] w-[160px] gap-[4px] bg-[#252525] border-[1px] border-[#404040] rounded-[8px]'
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
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

      return createPortal(
        <div
          ref={menuContainerRef}
          style={{ position: 'fixed', zIndex: 2000000 }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {menu}
        </div>,
        document.body
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
      {renderSettingMenu()}
    </div>
  );
}

export default NodeSettingsController;
