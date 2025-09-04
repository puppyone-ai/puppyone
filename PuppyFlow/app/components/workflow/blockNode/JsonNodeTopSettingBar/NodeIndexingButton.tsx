'use client';

// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, { useState, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { VectorIndexingItem, IndexingItem } from '../JsonNodeNew';
import IndexingMenu from './NodeIndexingMenu';
import { createPortal } from 'react-dom';

type NodeIndexingButtonProps = {
  nodeid: string;
  indexingList: IndexingItem[];
  onAddIndex: (newItem: IndexingItem) => void;
  onRemoveIndex: (index: number) => void;
};

function NodeIndexingButton({
  nodeid,
  indexingList,
  onAddIndex,
  onRemoveIndex,
}: NodeIndexingButtonProps) {
  const [isHovered, setHovered] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const indexButtonRef = useRef<HTMLButtonElement | null>(null);
  const componentRef = useRef<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  const { activatedNode, setHandleActivated } = useNodesPerFlowContext();
  const { getNode } = useReactFlow();

  // 鼠标悬浮效果
  const onMouseEnter = () => {
    setHovered(true);
  };

  const onMouseLeave = () => {
    setHovered(false);
  };

  // 点击按钮处理
  const handleIndexClick = () => {
    const target = getNode(nodeid);
    if (target) {
      setHandleActivated(nodeid, null);
      setShowMenu(!showMenu);
    }
  };

  // 关闭菜单
  const handleCloseMenu = () => {
    setShowMenu(false);
  };

  // 点击外部关闭（考虑 portal 后的容器）
  useEffect(() => {
    if (!showMenu) return;

    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const clickedInsideButton =
        !!componentRef.current && componentRef.current.contains(target);
      const clickedInsideMenu =
        !!menuContainerRef.current && menuContainerRef.current.contains(target);
      if (!clickedInsideButton && !clickedInsideMenu) {
        setShowMenu(false);
      }
    };

    document.addEventListener('click', onDocClick, true);
    return () => document.removeEventListener('click', onDocClick, true);
  }, [showMenu]);

  // 当节点不再激活时关闭菜单
  useEffect(() => {
    if (activatedNode?.id !== nodeid) {
      setShowMenu(false);
    }
  }, [activatedNode?.id, nodeid]);

  // 位置更新：将菜单锚定到按钮（左对齐），并通过 portal 放到 body，避免缩放
  useEffect(() => {
    if (!showMenu) return;

    let rafId: number | null = null;

    const positionMenu = () => {
      const btn = indexButtonRef.current;
      const container = menuContainerRef.current;
      if (!btn || !container) {
        rafId = requestAnimationFrame(positionMenu);
        return;
      }
      const rect = btn.getBoundingClientRect();
      const GAP = 8;
      const containerWidth = container.offsetWidth || 420; // 估算，首次渲染后会被真实宽度覆盖
      const top = rect.bottom + GAP;
      let left = rect.left; // 左对齐按钮
      left = Math.max(
        8,
        Math.min(left, window.innerWidth - containerWidth - 8)
      );

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
  }, [showMenu]);

  // 设置悬浮效果对应的颜色
  const fillColor = isHovered ? '#BEBEBE' : '#6D7177';

  return (
    <div
      ref={componentRef}
      style={{ position: 'relative', isolation: 'isolate' }}
      className='indexing-button-container'
    >
      <button
        ref={indexButtonRef}
        className={`flex items-center justify-center ${isHovered || showMenu ? 'bg-[#3E3E41]' : ''} w-[24px] h-[24px] rounded-[8px]`}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={handleIndexClick}
        title='Manage Indexing'
      >
        {/* 索引图标 - 使用不同于设置按钮的图标 */}
        <svg
          width='16'
          height='16'
          viewBox='0 0 16 16'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <rect
            x='2.75'
            y='1.75'
            width='10.5'
            height='12.5'
            rx='2.25'
            stroke={indexingList.length > 0 ? '#39BC66' : fillColor}
            strokeWidth='1.5'
          />
          <path
            d='M3 6H12.5'
            stroke={indexingList.length > 0 ? '#39BC66' : fillColor}
            strokeWidth='1.5'
          />
          <path
            d='M3 10H13'
            stroke={indexingList.length > 0 ? '#39BC66' : fillColor}
            strokeWidth='1.5'
          />
          <path
            d='M4.5 3.5H5.5V4.5H4.5V3.5Z'
            fill={indexingList.length > 0 ? '#39BC66' : fillColor}
          />
          <path
            d='M4.5 7.5H5.5V8.5H4.5V7.5Z'
            fill={indexingList.length > 0 ? '#39BC66' : fillColor}
          />
          <path
            d='M4.5 11.5H5.5V12.5H4.5V11.5Z'
            fill={indexingList.length > 0 ? '#39BC66' : fillColor}
          />
        </svg>
      </button>

      {showMenu &&
        createPortal(
          <div
            ref={menuContainerRef}
            style={{ position: 'fixed', zIndex: 2000000 }}
            className='indexing-menu-container'
            onMouseDown={e => e.stopPropagation()}
            onClick={e => e.stopPropagation()}
          >
            <IndexingMenu
              id={nodeid}
              showMenu={showMenu}
              indexingList={indexingList}
              onClose={handleCloseMenu}
              onAddIndex={onAddIndex}
              onRemoveIndex={onRemoveIndex}
            />
          </div>,
          document.body
        )}
    </div>
  );
}

export default NodeIndexingButton;
