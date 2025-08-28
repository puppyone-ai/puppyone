'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import { nanoid } from 'nanoid';
import { Transition } from '@headlessui/react';

// deprecated legacy type removed

// 恢复 "Groupsub1" 类型
type menuNameType =
  | null
  | 'Textsub1'
  | 'StructuredTextsub1'
  | 'Filesub1'
  | 'Switchsub1'
  | 'VectorDatabasesub1'
  | 'Otherssub1'
  | 'Groupsub1';

function AddNodeButton() {
  const [selectedMenu, setSelectedMenu] = useState(0);
  const {
    allowActivateOtherNodesWhenConnectEnd,
    clearAll,
    isOnGeneratingNewNode,
  } = useNodesPerFlowContext();
  const { setNodes, getNodes } = useReactFlow();
  const [externalCreate, setExternalCreate] = useState<
    { nodeType: string; nonce: number } | null
  >(null);

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
        if (isOnGeneratingNewNode) return;
        // Open the menu then trigger create via NodeMenu
        setSelectedMenu(1);
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
      <button
        id='nodeMenuButton'
        title='Add Block'
        aria-label='Add Block'
        className={`group inline-flex items-center gap-2 h-[36px] rounded-md px-2.5 py-1.5 border text-[13px] font-medium transition-colors ${
          selectedMenu === 1
            ? 'bg-[#3A3A3A] border-[#3A3A3A] text-white'
            : 'bg-[#2A2A2A] border-[#2A2A2A] text-[#CDCDCD] hover:bg-[#3A3A3A]'
        } ${isOnGeneratingNewNode ? 'pointer-events-none opacity-60' : 'pointer-events-auto'}`}
      >
        <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 8 8' fill='none' className='text-current'>
          <path d='M4 0L4 8' stroke='currentColor' strokeWidth='1.5' />
          <path d='M0 4L8 4' stroke='currentColor' strokeWidth='1.5' />
        </svg>
        <span>Add Block</span>
      </button>
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
  const { getNodes, setNodes, screenToFlowPosition, getZoom } = useReactFlow();
  const {
    allowActivateOtherNodesWhenConnectEnd,
    clearAll,
    preventActivateOtherNodesWhenConnectStart,
    generateNewNode,
    finishGeneratingNewNode,
    isOnGeneratingNewNode,
  } = useNodesPerFlowContext();
  // removed legacy single-click placement node state

  // for drag and drop purpose
  // Rectangle-to-create workflow state
  const [isDragging, setIsDragging] = useState(false);
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);
  const [rectStart, setRectStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [rectEnd, setRectEnd] = useState<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback((nodeType: string) => {
    setIsDragging(true);
    setDraggedNodeType(nodeType);
    generateNewNode();
    clearMenu();
    // The rectangle starts on first mousedown on canvas pane
  }, []);

  const handleRectMouseMove = useCallback(
    (event: MouseEvent) => {
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
          case 'group':
            return { width: 240, height: 176 };
          case 'text':
          case 'structured':
          case 'file':
          case 'weblink':
          case 'switch':
          default:
            return { width: 240, height: 176 };
        }
      };

      const minSize = getMinSize(draggedNodeType);
      const width = Math.max(rawWidth, minSize.width);
      const height = Math.max(rawHeight, minSize.height);

      // Build node data
      const newNodeId = nanoid(6);
      const defaultNodeContent = draggedNodeType === 'switch' ? 'OFF' : '';
      const nodeData: any = {
        content: defaultNodeContent,
        label: newNodeId,
        isLoading: false,
        locked: false,
        isInput: false,
        isOutput: false,
        editable: false,
      };
      if (draggedNodeType === 'group') {
        // Random background color for group
        const colors = [
          'rgba(85, 83, 77, 0.2)',
          'rgba(108, 72, 60, 0.2)',
          'rgba(143, 63, 61, 0.2)',
          'rgba(68, 106, 91, 0.2)',
          'rgba(64, 101, 131, 0.2)',
          'rgba(110, 95, 133, 0.2)',
          'rgba(119, 89, 110, 0.2)',
        ];
        nodeData.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
      }

      setNodes(prev => [
        ...prev,
        {
          id: newNodeId,
          position: topLeft,
          data: nodeData,
          type: draggedNodeType,
          measured: { width, height },
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
    [isDragging, draggedNodeType, rectStart, rectEnd, screenToFlowPosition, setNodes]
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
    document.addEventListener('mousemove', handleRectMouseMove as any);
    document.addEventListener('mouseup', handleRectMouseUp as any);
    document.addEventListener('contextmenu', handleRightClick as any);

    return () => {
      pane?.removeEventListener('mousedown', handlePaneMouseDown as any);
      document.removeEventListener('mousemove', handleRectMouseMove as any);
      document.removeEventListener('mouseup', handleRectMouseUp as any);
      document.removeEventListener('contextmenu', handleRightClick as any);
    };
  }, [isDragging, handlePaneMouseDown, handleRectMouseMove, handleRectMouseUp, handleRightClick]);

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

  // removed legacy mousePosition-based placement effect

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
      case 'Switchsub1':
        value = 3;
        break;
      case 'VectorDatabasesub1':
        value = 4;
        break;
      case 'Otherssub1':
        value = 5;
        break;
      case 'Groupsub1': // 恢复 group 菜单项
        value = 6;
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
    if (!isDragging || !draggedNodeType || !rectStart || !rectEnd || !isOnGeneratingNewNode)
      return <></>;

    const left = Math.min(rectStart.x, rectEnd.x);
    const top = Math.min(rectStart.y, rectEnd.y);
    const width = Math.abs(rectEnd.x - rectStart.x);
    const height = Math.abs(rectEnd.y - rectStart.y);

    return (
      <div
        style={{
          position: 'fixed',
          left,
          top,
          width,
          height,
          pointerEvents: 'none',
          zIndex: 100000,
        }}
        className='border border-[#60A5FA] border-dashed bg-[rgba(96,165,250,0.08)] rounded-lg'
      />
    );
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
          className={`will-change-auto bg-[#1c1d1f] rounded-[16px] border-solid border-[1.5px] border-[#3e3e41] absolute left-1/2 -translate-x-1/2 transform top-full mt-3 z-[10000] text-white flex flex-col gap-[16px] p-[14px] transition-all duration-300 ease-in-out origin-top pointer-events-auto shadow-lg min-w-[384px] backdrop-blur-sm bg-opacity-95`}
          onMouseLeave={() => manageNodeMenuSubMenu(null)}
        >
          {/* First Section Title */}
          <div className='flex items-center gap-3 px-2 group'>
            <span className='text-[11px] font-medium text-gray-500 whitespace-nowrap flex items-center gap-2'>
              <div className='w-1 h-1 rounded-full bg-blue-500'></div>
              Text Elements
            </span>
            <div className='h-[1px] flex-grow bg-gradient-to-r from-gray-600 to-transparent opacity-50'></div>
          </div>

          {/* First Row - Text Elements */}
          <div className='grid grid-cols-2 gap-[12px] px-1'>
            <button
              className={`group w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`}
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
              <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center text-[20px] font-[500] rounded-[8px] shadow-inner relative'>
                <span className='bg-gradient-to-r from-blue-400 to-blue-600 text-transparent bg-clip-text group-hover:scale-110 transition-transform duration-200'>
                  Aa
                </span>
              </div>
              <div className='flex flex-col items-start relative'>
                <div className='text-[14px] font-[600] text-white group-hover:text-white transition-colors'>
                  Text
                </div>
                <div className='text-[11px] font-[400] text-gray-400 group-hover:text-gray-200 transition-colors'>
                  Basic text node
                </div>
              </div>
            </button>

            <button
              className={`group w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200 relative overflow-hidden`}
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
              <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[8px] shadow-inner relative'>
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
                <div className='text-[13px] font-[600] text-white leading-tight'>
                  Structured Text
                </div>
                <div className='text-[11px] font-[400] text-gray-400 group-hover:text-gray-200'>
                  JSON format
                </div>
              </div>
            </button>
          </div>

          {/* Second Section Title */}
          <div className='flex items-center gap-3 px-2 group mt-1'>
            <span className='text-[11px] font-medium text-gray-500 whitespace-nowrap flex items-center gap-2'>
              <div className='w-1 h-1 rounded-full bg-orange-500'></div>
              External Resources
            </span>
            <div className='h-[1px] flex-grow bg-gradient-to-r from-gray-600 to-transparent opacity-50'></div>
          </div>

          {/* Second Row - Resource Elements */}
          <div className='grid grid-cols-2 gap-[12px] px-1'>
            <button
              className={`w-[180px] h-[64px] bg-[#2A2B2D] rounded-[10px] flex flex-row items-center gap-[16px] p-[8px] font-plus-jakarta-sans text-[#CDCDCD] cursor-pointer hover:bg-[#2563EB] hover:shadow-blue-500/20 hover:shadow-lg transition-all duration-200`}
              onMouseEnter={() => {
                manageNodeMenuSubMenu('Filesub1');
              }}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                handleMouseDown('file');
              }}
            >
              <div className='w-[48px] h-[48px] bg-[#1C1D1F] flex items-center justify-center rounded-[8px] shadow-inner'>
                <svg
                  xmlns='http://www.w3.org/2000/svg'
                  width='24'
                  height='24'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='url(#gradient1)'
                  strokeWidth='2'
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <defs>
                    <linearGradient
                      id='gradient1'
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
                <div className='text-[14px] font-[600] text-white'>File</div>
                <div className='text-[11px] font-[400] text-gray-400'>
                  Upload & Process
                </div>
              </div>
            </button>
          </div>

          {/* Group creation has been removed from menu UI */}
        </ul>
      </Transition>
      {renderSelectionOverlay()}
    </>
  );
}

export default AddNodeButton;
