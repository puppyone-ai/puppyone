'use client';

// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext';
import React, { useState, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { VectorIndexingItem, IndexingItem } from '../JsonNodeNew';
import IndexingMenu from './NodeIndexingAddMenu';
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
      const containerWidth = container.offsetWidth || 560; // 估算，首次渲染后会被真实宽度覆盖
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
  const iconColor = indexingList.length > 0 ? '#39BC66' : fillColor;

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
        title='Manage Interactions'
      >
        {/* paw logo icon */}
        <svg
          width='16'
          height='16'
          viewBox='0 0 57 45'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <ellipse
            cx='48.515'
            cy='19.2436'
            rx='6'
            ry='7'
            transform='rotate(14 48.515 19.2436)'
            fill={iconColor}
          />
          <ellipse
            cx='19.9854'
            cy='8.26189'
            rx='6'
            ry='7.5'
            transform='rotate(-8 19.9854 8.26189)'
            fill={iconColor}
          />
          <ellipse
            cx='35.9857'
            cy='8.26205'
            rx='6'
            ry='7.5'
            transform='rotate(8 35.9857 8.26205)'
            fill={iconColor}
          />
          <ellipse
            cx='7.51523'
            cy='19.2439'
            rx='6'
            ry='7'
            transform='rotate(-14 7.51523 19.2439)'
            fill={iconColor}
          />
          <path
            d='M26.8105 20.1118C27.7267 19.9626 27.7962 19.9628 28.7124 20.112C30.3514 20.379 31.1832 21.0044 32.5181 21.9713C35.334 24.011 34.7603 26.0934 37.2751 28.4795C38.608 29.7441 40.3591 30.8111 41.5574 32.1984C43.0053 33.8746 43.7401 35.1267 43.9359 37.312C44.1012 39.1563 44.0006 40.3981 42.9845 41.9606C41.9881 43.4929 40.9513 44.2061 39.1789 44.7499C37.5836 45.2393 36.565 44.8691 34.8975 44.7499C32.0632 44.5472 30.6034 43.3172 27.7619 43.3552C25.1022 43.3909 23.7531 44.5385 21.102 44.7499C19.4355 44.8827 18.4158 45.2393 16.8206 44.7499C15.0481 44.2061 14.0113 43.4929 13.0149 41.9606C11.9988 40.3981 11.8989 39.1559 12.0642 37.3116C12.26 35.1264 13.1525 33.9939 14.4421 32.1984C15.6495 30.5172 16.8619 30.0237 18.2477 28.4795C20.355 26.1311 20.4199 23.8084 23.0048 21.9713C24.3486 21.0162 25.1714 20.3788 26.8105 20.1118Z'
            fill={iconColor}
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
