'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { nanoid } from 'nanoid';
import { Transition } from '@headlessui/react';

// Simplified menu type - only keeping the ones we need
type menuNameType =
  | null
  | 'Textsub1'
  | 'StructuredTextsub1'
  | 'Filesub1'
  | 'Weblinksub1';

function AddNodeButton({
  showTriggerButton = true,
}: {
  showTriggerButton?: boolean;
}) {
  const [selectedMenu, setSelectedMenu] = useState(0);
  const {
    allowActivateOtherNodesWhenConnectEnd,
    clearAll,
    isOnGeneratingNewNode,
  } = useNodesPerFlowContext();
  const { setNodes, getNodes } = useReactFlow();
  const [externalCreate, setExternalCreate] = useState<{
    nodeType: string;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    // define onClick action and click out action
    const onMouseClick = (event: MouseEvent) => {
      const menubuttonContainer = document.getElementById(
        'nodeMenuButtonContainer'
      ) as HTMLButtonElement;
      const menubutton = document.getElementById(
        'nodeMenuButton'
      ) as HTMLButtonElement;
      const target = event.target as HTMLElement;
      if (!menubuttonContainer.contains(target)) {
        setSelectedMenu(0);
      } else if (menubutton.contains(target)) {
        setSelectedMenu(prev => (prev === 0 ? 1 : 0));
        clearAll();
      }
    };

    document.addEventListener('click', onMouseClick);
    return () => document.removeEventListener('click', onMouseClick);
  }, []);

  // Listen to external openAddNodeMenu events (from Group button)
  useEffect(() => {
    const onOpenAddNodeMenu = (evt: Event) => {
      try {
        const e = evt as CustomEvent<any>;
        const preselect = e?.detail?.preselect as string | undefined;
        const startDirect =
          (e?.detail?.startDirect as boolean | undefined) ?? false;
        if (isOnGeneratingNewNode) return;
        // Optionally open menu; or start directly when triggered externally
        if (!startDirect) {
          setSelectedMenu(1);
        }
        if (preselect) {
          setExternalCreate({ nodeType: preselect, nonce: Date.now() });
        }
      } catch (_) {
        // noop
      }
    };
    window.addEventListener('openAddNodeMenu' as any, onOpenAddNodeMenu as any);
    return () => {
      window.removeEventListener(
        'openAddNodeMenu' as any,
        onOpenAddNodeMenu as any
      );
    };
  }, [isOnGeneratingNewNode]);

  const clearMenu = () => {
    setSelectedMenu(0);
  };

  return (
    <div id='nodeMenuButtonContainer' className='relative inline-block'>
      {showTriggerButton && (
        <button
          id='nodeMenuButton'
          title='Block'
          aria-label='Block'
          className={`group inline-flex items-center gap-2 h-[36px] rounded-[8px] px-2.5 py-1.5 border-0 text-[14px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#4599DF]/40 ${
            selectedMenu === 1
              ? 'bg-[#4599DF] text-black'
              : 'bg-[#4599DF] text-black hover:bg-[#3A8BD9] active:bg-[#2F7EC9]'
          } ${isOnGeneratingNewNode ? 'pointer-events-none opacity-60' : 'pointer-events-auto'}`}
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            width='14'
            height='14'
            viewBox='0 0 8 8'
            fill='none'
            className='text-current'
          >
            <path d='M4 0L4 8' stroke='currentColor' strokeWidth='1.5' />
            <path d='M0 4L8 4' stroke='currentColor' strokeWidth='1.5' />
          </svg>
          <span>Block</span>
        </button>
      )}
      <NodeMenu
        selectedMenu={selectedMenu}
        clearMenu={clearMenu}
        externalCreate={externalCreate}
        onExternalHandled={() => setExternalCreate(null)}
      />
    </div>
  );
}

// NodeMenu component (previously in separate file)
function NodeMenu({
  selectedMenu,
  clearMenu,
  externalCreate,
  onExternalHandled,
}: {
  selectedMenu: number;
  clearMenu: () => void;
  externalCreate: { nodeType: string; nonce: number } | null;
  onExternalHandled: () => void;
}) {
  const { getNodes, setNodes, screenToFlowPosition } = useReactFlow();
  const {
    allowActivateOtherNodesWhenConnectEnd,
    clearAll,
    preventActivateOtherNodesWhenConnectStart,
    generateNewNode,
    finishGeneratingNewNode,
    isOnGeneratingNewNode,
  } = useNodesPerFlowContext();

  // for drag and drop purpose
  // Rectangle-to-create workflow state
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [rectEnd, setRectEnd] = useState<{ x: number; y: number } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(
    null
  );

  const handleMouseDown = useCallback((nodeType: string) => {
    setIsDragging(true);
    setDraggedNodeType(nodeType);
    generateNewNode();
    clearMenu();
    // The rectangle starts on first mousedown on canvas pane
  }, []);

  const handlePointerMove = useCallback(
    (event: MouseEvent) => {
      setCursorPos({ x: event.clientX, y: event.clientY });
      if (!isDragging || !rectStart) return;
      setRectEnd({ x: event.clientX, y: event.clientY });
    },
    [isDragging, rectStart]
  );

  const handlePaneMouseDown = useCallback(
    (event: MouseEvent) => {
      if (!isDragging) return;
      // Start rectangle from where user pressed down
      setRectStart({ x: event.clientX, y: event.clientY });
      setRectEnd({ x: event.clientX, y: event.clientY });
    },
    [isDragging]
  );

  const handleRectMouseUp = useCallback(
    (event: MouseEvent) => {
      if (!isDragging || !draggedNodeType || !rectStart || !rectEnd) return;

      // Convert both corners to flow coordinates
      const p0 = screenToFlowPosition({ x: rectStart.x, y: rectStart.y });
      const p1 = screenToFlowPosition({ x: rectEnd.x, y: rectEnd.y });
      const topLeft = { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y) };
      const rawWidth = Math.abs(p1.x - p0.x);
      const rawHeight = Math.abs(p1.y - p0.y);

      const getMinSize = (nodeType: string) => {
        switch (nodeType) {
          case 'structured':
            return { width: 304, height: 176 };
          case 'text':
          case 'file':
          case 'weblink':
          default:
            return { width: 240, height: 176 };
        }
      };

      const minSize = getMinSize(draggedNodeType);
      const width = Math.max(rawWidth, minSize.width);
      const height = Math.max(rawHeight, minSize.height);
      // snap top-left when user dragged to the left/up to keep overlay and final rect aligned
      const dx = rectEnd.x - rectStart.x;
      const dy = rectEnd.y - rectStart.y;
      const snappedTopLeft = {
        x: dx >= 0 ? topLeft.x : topLeft.x - (width - rawWidth),
        y: dy >= 0 ? topLeft.y : topLeft.y - (height - rawHeight),
      };

      // Build node data
      const newNodeId = nanoid(6);
      const defaultNodeContent =
        draggedNodeType === 'structured' ? '["structured text", null]' : '';
      const nodeData: any = {
        content: defaultNodeContent,
        label: newNodeId,
        isLoading: false,
        locked: false,
        isInput: false,
        isOutput: false,
        editable: false,
      };

      setNodes(prev => [
        ...prev,
        {
          id: newNodeId,
          position: snappedTopLeft,
          data: nodeData,
          type: draggedNodeType,
          width,
          height,
        } as any,
      ]);

      // Reset states and listeners
      setRectStart(null);
      setRectEnd(null);
      setIsDragging(false);
      setDraggedNodeType(null);
      clearAll();
    },
    [
      isDragging,
      draggedNodeType,
      rectStart,
      rectEnd,
      screenToFlowPosition,
      setNodes,
    ]
  );

  // 右键点击取消
  const handleRightClick = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      if (isOnGeneratingNewNode) {
        // 重置状态
        setIsDragging(false);
        setDraggedNodeType(null);
        setRectStart(null);
        setRectEnd(null);
        clearAll();
        console.log('Node generation cancelled');
      }
    },
    [isOnGeneratingNewNode]
  );

  useEffect(() => {
    if (!isDragging) return;

    const pane = document.querySelector('.react-flow__pane');
    pane?.addEventListener('mousedown', handlePaneMouseDown as any);
    document.addEventListener('mousemove', handlePointerMove as any);
    document.addEventListener('mouseup', handleRectMouseUp as any);
    document.addEventListener('contextmenu', handleRightClick as any);

    return () => {
      pane?.removeEventListener('mousedown', handlePaneMouseDown as any);
      document.removeEventListener('mousemove', handlePointerMove as any);
      document.removeEventListener('mouseup', handleRectMouseUp as any);
      document.removeEventListener('contextmenu', handleRightClick as any);
    };
  }, [
    isDragging,
    handlePaneMouseDown,
    handlePointerMove,
    handleRectMouseUp,
    handleRightClick,
  ]);

  const [selectedNodeMenuSubMenu, setSelectedNodeMenuSubMenu] = useState(-1);

  useEffect(() => {
    if (selectedMenu === 0) {
      setSelectedNodeMenuSubMenu(-1);
    }
  }, [selectedMenu]);

  // Respond to external create requests (e.g., Group button)
  useEffect(() => {
    if (!externalCreate) return;
    const nodeType = externalCreate.nodeType;
    if (!nodeType) return;
    // Start create flow using the same logic as clicking a menu item
    handleMouseDown(nodeType);
    onExternalHandled();
  }, [externalCreate]);

  const manageNodeMenuSubMenu = (menuName: menuNameType) => {
    let value = -1;
    if (menuName === null) {
      setSelectedNodeMenuSubMenu(-1);
      return;
    }
    switch (menuName) {
      case 'Textsub1':
        value = 0;
        break;
      case 'StructuredTextsub1':
        value = 1;
        break;
      case 'Filesub1':
        value = 2;
        break;
      case 'Weblinksub1':
        value = 3;
        break;
      default:
        value = -1;
        break;
    }
    setSelectedNodeMenuSubMenu(value);
    return;
  };

  // 渲染矩形选择覆盖层
  const renderSelectionOverlay = () => {
    if (
      !isDragging ||
      !draggedNodeType ||
      !rectStart ||
      !rectEnd ||
      !isOnGeneratingNewNode
    )
      return <></>;

    // no min size in overlay; show exactly what user dragged in SCREEN coords
    const left = Math.min(rectStart.x, rectEnd.x);
    const top = Math.min(rectStart.y, rectEnd.y);
    const width = Math.abs(rectEnd.x - rectStart.x);
    const height = Math.abs(rectEnd.y - rectStart.y);

    const theme = (() => {
      switch (draggedNodeType) {
        case 'text':
          return { border: '#60A5FA', bg: 'rgba(96,165,250,0.08)' };
        case 'structured':
          return { border: '#A78BFA', bg: 'rgba(167,139,250,0.10)' };
        case 'file':
          return { border: '#22C55E', bg: 'rgba(34,197,94,0.10)' };
        case 'weblink':
          return { border: '#F59E0B', bg: 'rgba(245,158,11,0.10)' };
        default:
          return { border: '#60A5FA', bg: 'rgba(96,165,250,0.08)' };
      }
    })();

    const overlayEl = (
      <div
        style={{
          position: 'fixed',
          left,
          top,
          width,
          height,
          pointerEvents: 'none',
          zIndex: 100000,
          borderColor: theme.border,
          backgroundColor: theme.bg,
        }}
        className='border border-dashed rounded-lg'
      />
    );

    if (typeof document !== 'undefined') {
      return createPortal(overlayEl, document.body);
    }
    return overlayEl;
  };

  // 渲染创建模式提示（跟随光标的类型图标，无文字）
  const renderCreateModeHint = () => {
    if (!isOnGeneratingNewNode || !isDragging || !draggedNodeType || !cursorPos)
      return <></>;

    const getTypeIcon = () => {
      switch (draggedNodeType) {
        case 'text':
          return (
            <span className='text-[13px] font-semibold bg-gradient-to-r from-blue-400 to-blue-600 text-transparent bg-clip-text'>
              Aa
            </span>
          );
        case 'structured':
          return (
            <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
              <defs>
                <linearGradient
                  id='structuredSmall'
                  x1='2'
                  y1='2'
                  x2='22'
                  y2='22'
                >
                  <stop offset='0%' stopColor='#A78BFA' />
                  <stop offset='100%' stopColor='#7C3AED' />
                </linearGradient>
              </defs>
              <rect
                x='3'
                y='3'
                width='18'
                height='18'
                rx='3'
                stroke='url(#structuredSmall)'
                strokeWidth='2'
              />
            </svg>
          );
        case 'file':
          return (
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='url(#g1)'
              strokeWidth='2'
            >
              <defs>
                <linearGradient id='g1' x1='0%' y1='0%' x2='100%' y2='100%'>
                  <stop offset='0%' stopColor='#22C55E' />
                  <stop offset='100%' stopColor='#16A34A' />
                </linearGradient>
              </defs>
              <path d='M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z' />
              <polyline points='13 2 13 9 20 9'></polyline>
            </svg>
          );
        case 'weblink':
          return (
            <svg
              width='14'
              height='14'
              viewBox='0 0 24 24'
              fill='none'
              stroke='url(#g2)'
              strokeWidth='2'
            >
              <defs>
                <linearGradient id='g2' x1='0%' y1='0%' x2='100%' y2='100%'>
                  <stop offset='0%' stopColor='#F59E0B' />
                  <stop offset='100%' stopColor='#D97706' />
                </linearGradient>
              </defs>
              <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
              <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
            </svg>
          );
        default:
          return null;
      }
    };

    const hint = (
      <div
        style={{
          position: 'fixed',
          left: cursorPos.x + 14,
          top: cursorPos.y + 14,
          pointerEvents: 'none',
          zIndex: 100001,
          borderColor: (() => {
            switch (draggedNodeType) {
              case 'text':
                return '#60A5FA';
              case 'structured':
                return '#A78BFA';
              case 'file':
                return '#22C55E';
              case 'weblink':
                return '#F59E0B';
              default:
                return '#3E3E41';
            }
          })(),
        }}
        className='w-[32px] h-[32px] rounded-md border bg-[#1C1D1F]/85 shadow-lg backdrop-blur-sm flex items-center justify-center'
      >
        {getTypeIcon()}
      </div>
    );

    if (typeof document !== 'undefined') {
      return createPortal(hint, document.body);
    }
    return hint;
  };

  return (
    <>
      <Transition
        show={selectedMenu === 1}
        enter='transition duration-100 ease-out'
        enterFrom='transform opacity-0 translate-y-[-10px]'
        enterTo='transform opacity-100 translate-y-0'
        leave='transition duration-75 ease-in'
        leaveFrom='transform opacity-100 translate-y-0'
        leaveTo='transform opacity-0 translate-y-[-10px]'
      >
        <ul
          id='nodeMenu'
          className={`will-change-auto bg-gradient-to-b from-[#1E1F22]/95 to-[#131416]/95 rounded-[14px] border border-[#3e3e41] ring-1 ring-black/30 absolute -left-3 top-full mt-3 z-[10000] text-white text-[12px] font-plus-jakarta-sans flex flex-col gap-[12px] p-[12px] transition-all duration-300 ease-in-out origin-top pointer-events-auto shadow-2xl shadow-black/50 w-[260px] backdrop-blur-md`}
          onMouseLeave={() => manageNodeMenuSubMenu(null)}
        >
          {/* Nodes */}
          <button
            className={`group w-full h-[64px] bg-[#2A2A2A] border border-[#3e3e41] rounded-[12px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#3A3A3A] hover:shadow-black/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`}
            onMouseEnter={() => {
              manageNodeMenuSubMenu('Textsub1');
            }}
            onMouseLeave={() => {
              manageNodeMenuSubMenu(null);
            }}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              handleMouseDown('text');
            }}
          >
            <div className='absolute inset-0 bg-gradient-to-r from-blue-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200'></div>
            <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center text-[20px] font-[500] rounded-[10px] shadow-inner relative'>
              <span className='bg-gradient-to-r from-blue-400 to-blue-600 text-transparent bg-clip-text group-hover:scale-110 transition-transform duration-200'>
                Aa
              </span>
            </div>
            <div className='flex flex-col items-start relative'>
              <div className='text-[12px] font-[600] text-white group-hover:text-white transition-colors'>
                Text
              </div>
              <div className='text-[10px] font-[400] text-gray-400 group-hover:text-gray-200 transition-colors'>
                Basic text node
              </div>
            </div>
          </button>

          <button
            className={`group w-full h-[64px] bg-[#2A2A2A] border border-[#3e3e41] rounded-[12px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#3A3A3A] hover:shadow-black/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`}
            onMouseEnter={() => {
              manageNodeMenuSubMenu('StructuredTextsub1');
            }}
            onMouseLeave={() => {
              manageNodeMenuSubMenu(null);
            }}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              handleMouseDown('structured');
            }}
          >
            <div className='absolute inset-0 bg-gradient-to-r from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200'></div>
            <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[10px] shadow-inner relative'>
              <svg
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <defs>
                  <linearGradient
                    id='structuredGradient'
                    x1='2'
                    y1='2'
                    x2='22'
                    y2='22'
                  >
                    <stop offset='0%' stopColor='#A78BFA' />
                    <stop offset='100%' stopColor='#7C3AED' />
                  </linearGradient>
                </defs>
                <rect
                  x='2'
                  y='2'
                  width='20'
                  height='20'
                  rx='3'
                  stroke='url(#structuredGradient)'
                  strokeWidth='1.5'
                  strokeOpacity='0.5'
                />
                <rect
                  x='5'
                  y='6'
                  width='14'
                  height='2.5'
                  rx='1'
                  fill='url(#structuredGradient)'
                  fillOpacity='0.9'
                />
                <rect
                  x='5'
                  y='11'
                  width='11'
                  height='2.5'
                  rx='1'
                  fill='url(#structuredGradient)'
                  fillOpacity='0.6'
                />
                <rect
                  x='5'
                  y='16'
                  width='8'
                  height='2.5'
                  rx='1'
                  fill='url(#structuredGradient)'
                  fillOpacity='0.3'
                />
              </svg>
            </div>
            <div className='flex flex-col items-start relative'>
              <div className='text-[12px] font-[600] text-white leading-tight'>
                Structured Text
              </div>
              <div className='text-[10px] font-[400] text-gray-400 group-hover:text-gray-200'>
                JSON format
              </div>
            </div>
          </button>
          <button
            className={`group w-full h-[64px] bg-[#2A2A2A] border border-[#3e3e41] rounded-[12px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#3A3A3A] hover:shadow-black/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`}
            onMouseEnter={() => {
              manageNodeMenuSubMenu('Filesub1');
            }}
            onMouseLeave={() => {
              manageNodeMenuSubMenu(null);
            }}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              handleMouseDown('file');
            }}
          >
            <div className='absolute inset-0 bg-gradient-to-r from-green-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200'></div>
            <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[10px] shadow-inner'>
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='24'
                height='24'
                viewBox='0 0 24 24'
                fill='none'
                stroke='url(#gradientFileGreen)'
                strokeWidth='2'
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                <defs>
                  <linearGradient
                    id='gradientFileGreen'
                    x1='0%'
                    y1='0%'
                    x2='100%'
                    y2='100%'
                  >
                    <stop offset='0%' stopColor='#22C55E' />
                    <stop offset='100%' stopColor='#16A34A' />
                  </linearGradient>
                </defs>
                <path d='M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z'></path>
                <polyline points='13 2 13 9 20 9'></polyline>
              </svg>
            </div>
            <div className='flex flex-col items-start'>
              <div className='text-[12px] font-[600] text-white transition-colors group-hover:text-white'>
                File
              </div>
              <div className='text-[10px] font-[400] text-gray-400 group-hover:text-gray-200'>
                Upload & Process
              </div>
            </div>
          </button>

          {/* Group creation has been removed from menu UI */}
        </ul>
      </Transition>
      {renderSelectionOverlay()}
      {renderCreateModeHint()}
    </>
  );
}

export default AddNodeButton;
