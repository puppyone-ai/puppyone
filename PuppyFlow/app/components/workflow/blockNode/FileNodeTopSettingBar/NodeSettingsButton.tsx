'use client';

import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, { useState, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { createPortal } from 'react-dom';
import FileNodeSettingMenu from '../nodeTopRightBar/nodeSettingMenu/FileNodeSettingMenu';

type FileNodeSettingsControllerProps = {
  nodeid: string;
};

function FileNodeSettingsController({ nodeid }: FileNodeSettingsControllerProps) {
  const [isHovered, setHovered] = useState(false);
  const settingControllerRef = useRef<HTMLButtonElement | null>(null);
  const componentRef = useRef<HTMLDivElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const { activatedNode, setHandleActivated } = useNodesPerFlowContext();
  const { getNode } = useReactFlow();

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
      document.addEventListener('click', closeSettings, true);
    }

    return () => {
      document.removeEventListener('click', closeSettings, true);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (activatedNode?.id !== nodeid) {
      setIsMenuOpen(false);
    }
  }, [activatedNode?.id, nodeid]);

  // Keep menu tethered to the button; left-align; avoid canvas transforms
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
      const MENU_WIDTH = 160; // matches w-[160px] in FileNodeSettingMenu ul
      const top = rect.bottom; // menu has absolute top-[8px] itself
      let left = rect.left; // align left edge to button's left edge
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
      setIsMenuOpen(prev => !prev);
    }
  };

  const clearMenu = () => setIsMenuOpen(false);

  const onMouseEnter = () => setHovered(true);
  const onMouseLeave = () => setHovered(false);

  const renderSettingMenu = () => {
    if (!isMenuOpen) return null;

    return createPortal(
      <div
        ref={menuContainerRef}
        style={{ position: 'fixed', zIndex: 2000000 }}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
      >
        <FileNodeSettingMenu
          showSettingMenu={isMenuOpen ? 1 : 0}
          clearMenu={clearMenu}
          nodeid={nodeid}
        />
      </div>,
      document.body
    );
  };

  const fillColor = isHovered || isMenuOpen ? '#BEBEBE' : '#6D7177';

  return (
    <div ref={componentRef} style={{ position: 'relative', isolation: 'isolate' }}>
      <button
        ref={settingControllerRef}
        className={`flex items-center justify-center ${isHovered || isMenuOpen ? 'bg-[#3E3E41]' : ''} w-[24px] h-[24px] rounded-[8px]`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={manageSettings}
        title='Settings'
      >
        <svg xmlns='http://www.w3.org/2000/svg' width='11' height='2' viewBox='0 0 11 2' fill='none'>
          <path d='M0 0H2V2H0V0Z' fill={fillColor} />
          <path d='M9 0H11V2H9V0Z' fill={fillColor} />
          <path d='M4.5 0H6.5V2H4.5V0Z' fill={fillColor} />
        </svg>
      </button>
      {renderSettingMenu()}
    </div>
  );
}

export default FileNodeSettingsController;


