'use client';
import React, {
  useRef,
  useCallback,
  useState,
  useEffect,
  Fragment,
} from 'react';
import ReactDOM from 'react-dom';
import {
  NodeProps,
  Handle,
  Position,
  Node as ReactFlowNode,
  NodeResizeControl,
  NodeToolbar,
  useReactFlow,
} from '@xyflow/react';
import { Menu, Transition } from '@headlessui/react';
import {
  useDetachNodes,
  useGroupNodeCalculation,
} from '../../hooks/useNodeDragHandlers';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import {
  runGroupNode,
  RunGroupNodeContext,
} from '../edgesNode/edgeNodesNew/hook/runGroupNodeExecutor';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';
import { useAppSettings } from '../../states/AppSettingsContext';
import useGetSourceTarget from '../../hooks/useGetSourceTarget';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import { useServers } from '../../states/UserServersContext';
import { useServerOperations } from '../../hooks/useServerManagement';
import { SYSTEM_URLS } from '@/config/urls';

// Import the new toolbar component
import { GroupDeployToolbar } from './GroupDeployToolbar';

export type GroupNodeData = {
  label: string;
  backgroundColor?: string;
  [key: string]: unknown;
};

type GroupNodeProps = NodeProps<ReactFlowNode<GroupNodeData>>;

// 定义允许进入组的节点类型（只允许 block nodes）
const ALLOWED_NODE_TYPES = ['text', 'file', 'weblink', 'structured'];

// Notion风格的暗色系颜色配置
const BACKGROUND_COLORS = [
  { name: 'Default', value: 'transparent', preview: '#2A2B2D' },
  { name: 'Gray', value: 'rgba(85, 83, 77, 0.2)', preview: '#55534D' },
  { name: 'Brown', value: 'rgba(108, 72, 60, 0.2)', preview: '#6C483C' },
  { name: 'Red', value: 'rgba(143, 63, 61, 0.2)', preview: '#8F3F3D' },
  { name: 'Green', value: 'rgba(68, 106, 91, 0.2)', preview: '#446A5B' },
  { name: 'Blue', value: 'rgba(64, 101, 131, 0.2)', preview: '#406583' },
  { name: 'Purple', value: 'rgba(110, 95, 133, 0.2)', preview: '#6E5F85' },
  { name: 'Pink', value: 'rgba(119, 89, 110, 0.2)', preview: '#77596E' },
];

function GroupNode({ data, id, selected }: GroupNodeProps) {
  const componentRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const deployMenuRef = useRef<HTMLDivElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const { getNodes, deleteElements, setNodes, getNode } = useReactFlow();
  const { detachNodes, detachNodesFromGroup } = useDetachNodes();
  const { recalculateGroupNodes } = useGroupNodeCalculation();
  const { activatedNode, clearAll } = useNodesPerFlowContext();
  const [isHovered, setIsHovered] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState<string>(data?.label || '');
  // Measure meta slot width (block count) to keep layout width stable when swapping to rename
  const countRef = useRef<HTMLDivElement | null>(null);
  const [metaSlotWidth, setMetaSlotWidth] = useState<number>(0);

  // Add workspace context for deployment
  const { showingItem } = useWorkspaces();
  const selectedFlowId =
    showingItem?.type === 'workspace' ? showingItem.id : null;

  // Deployment state
  const [showDeployMenu, setShowDeployMenu] = useState(false);

  // 获取所有需要的依赖
  const {
    streamResult,
    streamResultForMultipleNodes,
    reportError,
    resetLoadingUI,
  } = useJsonConstructUtils();
  const { } = useAppSettings();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();

  // 创建执行上下文
  const createExecutionContext = useCallback(
    (): RunGroupNodeContext => ({
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
    }),
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

  // 获取此组内的所有子节点
  const childNodes = getNodes().filter(node => {
    const groupIds = (node.data as any)?.groupIds;
    return Array.isArray(groupIds) && groupIds.includes(id);
  });

  // 检查当前节点是否被激活
  const isActivated = activatedNode?.id === id;

  // 当组节点被激活时，重新计算组内节点
  useEffect(() => {
    if (isActivated) {
      console.log(`🎯 Group ${id} activated, recalculating nodes...`);
      recalculateGroupNodes(id);
    }
  }, [isActivated, id, recalculateGroupNodes]);

  // 获取当前背景颜色
  const currentBackgroundColor = data.backgroundColor || 'transparent';

  // 获取toolbar背景颜色 - 固定主基调，叠加少量组色（不透明）
  const getToolbarBackgroundColor = () => {
    const baseR = 35, baseG = 35, baseB = 35; // #232323 主基调
    const weight = 0.06; // 极轻的组色个性

    const color = currentBackgroundColor;
    if (!color || color === 'transparent') {
      return `rgb(${baseR}, ${baseG}, ${baseB})`;
    }

    let tr: number | null = null;
    let tg: number | null = null;
    let tb: number | null = null;

    // rgba(r, g, b, a)
    const rgbaMatch = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/i);
    if (rgbaMatch) {
      tr = parseInt(rgbaMatch[1], 10);
      tg = parseInt(rgbaMatch[2], 10);
      tb = parseInt(rgbaMatch[3], 10);
    }

    // rgb(r, g, b)
    if (tr === null) {
      const rgbMatch = color.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (rgbMatch) {
        tr = parseInt(rgbMatch[1], 10);
        tg = parseInt(rgbMatch[2], 10);
        tb = parseInt(rgbMatch[3], 10);
      }
    }

    // #rrggbb
    if (tr === null) {
      const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
      if (hexMatch) {
        const hex = hexMatch[1];
        tr = parseInt(hex.slice(0, 2), 16);
        tg = parseInt(hex.slice(2, 4), 16);
        tb = parseInt(hex.slice(4, 6), 16);
      }
    }

    if (tr === null || tg === null || tb === null) {
      return `rgb(${baseR}, ${baseG}, ${baseB})`;
    }

    const r = Math.round(baseR * (1 - weight) + tr * weight);
    const g = Math.round(baseG * (1 - weight) + tg * weight);
    const b = Math.round(baseB * (1 - weight) + tb * weight);
    return `rgb(${r}, ${g}, ${b})`;
  };

  // 更新节点背景颜色
  const updateBackgroundColor = useCallback(
    (color: string) => {
      setNodes(nodes =>
        nodes.map(node =>
          node.id === id
            ? { ...node, data: { ...node.data, backgroundColor: color } }
            : node
        )
      );
      setShowColorPicker(false);
    },
    [id, setNodes]
  );

  // 计算边框样式 - 使用outline向外扩展
  const getBorderStyle = () => {
    if (isActivated) {
      return {
        border: '1px solid #888888',
      };
    } else if (isHovered) {
      return {
        border: '1px solid #888888',
      };
    } else {
      return {
        border: '1px solid #666666',
      };
    }
  };

  // 处理组点击事件 - 移除手动重新计算
  const handleGroupClick = useCallback(
    (e: React.MouseEvent) => {
      // 点击时不做任何计算，因为激活时已经自动计算了
      console.log(`🖱️ Group ${id} clicked`);
    },
    [id]
  );

  // 处理调整大小结束事件
  const handleResizeEnd = useCallback(() => {
    // 延迟一点执行，确保 ReactFlow 已经更新了节点的尺寸
    setTimeout(() => {
      console.log(`📏 Group ${id} resized, recalculating nodes...`);
      recalculateGroupNodes(id);
    }, 100);
  }, [id, recalculateGroupNodes]);

  // 删除组节点及其所有子节点
  const onDelete = useCallback(() => {
    deleteElements({ nodes: [{ id }] });
  }, [deleteElements, id]);

  // 分离组内所有子节点（从所有组中完全分离）
  const onDetachAll = useCallback(() => {
    const childIds = childNodes.map(node => node.id);
    detachNodes(childIds);
  }, [detachNodes, childNodes]);

  // 仅从当前组分离（保留其他组关联）
  const onDetachFromThisGroup = useCallback(() => {
    const childIds = childNodes.map(node => node.id);
    detachNodesFromGroup(childIds, id);
  }, [detachNodesFromGroup, childNodes, id]);

  // 运行组的逻辑 - 使用新的执行函数
  const onRunGroup = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      console.log('Running group:', id);
      const context = createExecutionContext();
      await runGroupNode({
        groupNodeId: id,
        context,
        // 可以选择不提供 constructJsonData，使用默认实现
      });
    } catch (error) {
      console.error('运行组节点失败:', error);
    } finally {
      setIsLoading(false);
    }
  }, [id, isLoading, createExecutionContext]);

  // 手动重新计算按钮（调试用）
  const onManualRecalculate = useCallback(() => {
    console.log(`🔄 Manual recalculate for group ${id}`);
    recalculateGroupNodes(id);
  }, [id, recalculateGroupNodes]);

  // 获取当前颜色的显示名称
  const getCurrentColorName = () => {
    const currentColor = BACKGROUND_COLORS.find(
      color => color.value === currentBackgroundColor
    );
    return currentColor?.name || 'Custom';
  };

  // Close deploy menu on outside click or ESC
  useEffect(() => {
    if (!showDeployMenu) return;

    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const container = deployMenuRef.current;
      const target = event.target as EventTarget | null;
      if (!container || !target) return;
      if (target instanceof Node && !container.contains(target)) {
        setShowDeployMenu(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDeployMenu(false);
      }
    };

    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showDeployMenu]);

  // Focus the input when entering rename mode
  useEffect(() => {
    if (isRenaming) {
      setTimeout(() => {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      }, 0);
    }
  }, [isRenaming]);

  const startRename = useCallback(() => {
    setNameDraft(data?.label || '');
    setIsRenaming(true);
  }, [data?.label]);

  const commitRename = useCallback(() => {
    const next = (nameDraft || '').trim();
    const finalName = next.length > 0 ? next : (data?.label || '');
    setNodes(nodes =>
      nodes.map(n =>
        n.id === id ? { ...n, data: { ...n.data, label: finalName } } : n
      )
    );
    setIsRenaming(false);
  }, [nameDraft, data?.label, id, setNodes]);

  const cancelRename = useCallback(() => {
    setNameDraft(data?.label || '');
    setIsRenaming(false);
  }, [data?.label]);

  // Keep the meta slot width constant across hover swaps (block count <-> rename)
  useEffect(() => {
    const measure = () => {
      const width = countRef.current?.offsetWidth ?? 0;
      const finalWidth = Math.max(width, 24); // at least rename button width
      setMetaSlotWidth(finalWidth);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [childNodes.length]);

  return (
    <div
      className='relative w-full h-full min-w-[240px] min-h-[176px] cursor-default'
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 内层容器 - 保持 overflow-hidden */}
      <div
        ref={contentRef}
        id={id}
        className='relative w-full h-full min-w-[240px] min-h-[176px] rounded-[24px] overflow-hidden nodrag transition-all duration-100'
        style={{
          borderRadius: '16px',
          backgroundColor: currentBackgroundColor,
          ...getBorderStyle(),
        }}
        onClick={handleGroupClick}
      >
        {/* 内部 Toolbar - 一直显示 */}
        <>

        </>

        {/* ReactFlow NodeToolbar - simplified design */}
        <NodeToolbar isVisible={true}>
          <div 
            className='will-change-auto flex items-center gap-2 px-2 py-1.5 rounded-[8px] border border-[#404040] bg-transparent'
            style={{ 
              backgroundColor: getToolbarBackgroundColor()
            }}>
            {/* Group Title with rename (rename appears on hover) */}
            <div className='group/label flex items-center gap-2'>
              {isRenaming ? (
                <input
                  ref={titleInputRef}
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                  className='h-[26px] px-2 bg-[#2A2A2A] text-[#CDCDCD] border border-[#404040] rounded-[6px] text-[12px] outline-none'
                  placeholder='Group name'
                />
              ) : (
                <span className='font-medium text-[12px] leading-[18px] font-plus-jakarta-sans text-[#CDCDCD]'>
                  {data.label}
                </span>
              )}
              {/* 子节点数量指示器（hover 时隐藏，显示 Rename） */}
              {childNodes.length > 0 && (
                <div
                  ref={countRef}
                  className='text-[10px] text-[#666666] px-1 py-0.5 rounded group-hover/label:hidden'
                  style={{ minWidth: `${metaSlotWidth}px` }}
                >
                  ({childNodes.length}{' '}
                  {childNodes.length === 1 ? 'block' : 'blocks'})
                </div>
              )}
              {!isRenaming && (
                <div
                  className='hidden group-hover/label:inline-flex items-center justify-start'
                  style={{ minWidth: `${metaSlotWidth}px` }}
                >
                  <button
                    onClick={startRename}
                    className='inline-flex items-center justify-center w-[24px] h-[24px] rounded-[6px] text-[#808080] hover:text-[#CDCDCD] hover:bg-[#2A2A2A] transition-colors'
                    title='Rename'
                    aria-label='Rename group'
                  >
                    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                      <path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z' stroke='currentColor' strokeWidth='1.5'/>
                      <path d='M14.06 6.19l1.41-1.41a1.5 1.5 0 0 1 2.12 0l1.63 1.63a1.5 1.5 0 0 1 0 2.12l-1.41 1.41-3.75-3.75z' stroke='currentColor' strokeWidth='1.5'/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
            
            {/* 分隔符 */}
            <div className='w-px h-[26px] bg-[#3e3e41] opacity-90'></div>

            {/* Settings Menu */}
            <Menu as="div" className="relative">
              <Menu.Button className='group w-[28px] h-[28px] rounded-[6px] bg-transparent text-[#808080] hover:text-[#CDCDCD] flex items-center justify-center transition-colors duration-150 hover:bg-[#2A2A2A]'>
                <svg
                  width='15'
                  height='3'
                  viewBox='0 0 15 3'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <rect x='0' y='0' width='3' height='3' className='fill-[#808080] group-hover:fill-[#CDCDCD]'/>
                  <rect x='6' y='0' width='3' height='3' className='fill-[#808080] group-hover:fill-[#CDCDCD]'/>
                  <rect x='12' y='0' width='3' height='3' className='fill-[#808080] group-hover:fill-[#CDCDCD]'/>
                </svg>
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-150"
                enterFrom="opacity-0 -translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 -translate-y-1"
              >
                <Menu.Items className="absolute top-full left-0 mt-1 w-56 bg-[#1E1E1E] border border-[#404040] rounded-[8px] shadow-xl z-50 p-1">
                  {/* Recalculate */}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={onManualRecalculate}
                        className={`${active ? 'bg-[#2A2A2A]' : ''} w-full text-left px-3 py-2 text-[12px] text-[#CDCDCD] rounded-md flex items-center gap-2`}
                      >
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
                          <path d='M1 4V10H7' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                          <path d='M23 20V14H17' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                          <path d='M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14L18.36 18.36A9 9 0 0 1 3.51 15' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                        </svg>
                        Recalculate Nodes
                      </button>
                    )}
                  </Menu.Item>

                  {/* Background Color */}
                  <Menu.Item>
                    <div className="px-3 py-2">
                      <div className="text-[11px] text-[#888888] mb-2">Background Color</div>
                      <div className='grid grid-cols-4 gap-1.5'>
                        {BACKGROUND_COLORS.map(color => (
                          <button
                            key={color.name}
                            onClick={() => updateBackgroundColor(color.value)}
                            className={`w-6 h-6 rounded-md border-2 transition-all hover:scale-110 shadow-sm ${
                              currentBackgroundColor === color.value
                                ? 'border-[#60A5FA] ring-1 ring-[#60A5FA] ring-opacity-50 shadow-md'
                                : 'border-0 hover:border-[#666666] hover:shadow-md'
                            }`}
                            style={{
                              backgroundColor:
                                color.value === 'transparent'
                                  ? '#2A2B2D'
                                  : color.preview,
                            }}
                            title={color.name}
                          >
                            {color.value === 'transparent' && (
                              <div className='w-full h-full flex items-center justify-center'>
                                <div className='w-3 h-0.5 bg-[#CDCDCD] rotate-45'></div>
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Menu.Item>

                  <div className="w-full h-px bg-[#404040] my-1"></div>

                  {/* Detach All */}
                  {childNodes.length > 0 && (
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={onDetachAll}
                          className={`${active ? 'bg-[#2A2A2A]' : ''} w-full text-left px-3 py-2 text-[12px] text-[#CDCDCD] rounded-md flex items-center gap-2`}
                        >
                          <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
                            <path d='M9 14L4 9L9 4' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                            <path d='M20 20V13C20 11.9391 19.5786 10.9217 18.8284 10.1716C18.0783 9.42143 17.0609 9 16 9H4' stroke='#CDCDCD' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                          </svg>
                          Detach All Nodes
                        </button>
                      )}
                    </Menu.Item>
                  )}

                  {/* Delete */}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={onDelete}
                        className={`${active ? 'bg-[#E53E3E] text-white' : 'text-[#E53E3E]'} w-full text-left px-3 py-2 text-[12px] rounded-md flex items-center gap-2`}
                      >
                        <svg width='14' height='14' viewBox='0 0 24 24' fill='none'>
                          <path d='M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12z' stroke='currentColor' fill='none' strokeWidth='2'/>
                          <path d='M19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z' stroke='currentColor' fill='none' strokeWidth='2'/>
                        </svg>
                        Delete Group
                      </button>
                    )}
                  </Menu.Item>
                </Menu.Items>
              </Transition>
            </Menu>

            {/* Right-aligned actions */}
            <div className='ml-auto flex items-center gap-2'>
            {/* Deploy Button with Menu (icon only) */}
            <div className="relative" ref={deployMenuRef}>
              <button
                className={`group flex items-center justify-center w-[28px] h-[28px] rounded-[6px] bg-transparent hover:bg-[#2A2A2A] transition-colors`}
                onClick={() => setShowDeployMenu(!showDeployMenu)}
                aria-label='Deploy'
                title='Deploy'
              >
                <svg
                  width='14'
                  height='12'
                  viewBox='0 0 18 15'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <path
                    className='fill-[#808080] group-hover:fill-[#FFA73D] transition-colors'
                    d='M14.5 11L17.5 15H14.5V11Z'
                  />
                  <path
                    className='fill-[#808080] group-hover:fill-[#FFA73D] transition-colors'
                    d='M3.5 11V15H0.5L3.5 11Z'
                  />
                  <path
                    className='fill-[#808080] group-hover:fill-[#FFA73D] transition-colors'
                    fillRule='evenodd'
                    clipRule='evenodd'
                    d='M12.0049 5.19231C11.0095 2.30769 9.01893 0 9.01893 0C9.01893 0 7.02834 2.30769 6.03314 5.19231C4.79777 8.77308 5.03785 15 5.03785 15H13.0002C13.0002 15 13.2405 8.77298 12.0049 5.19231ZM9 6C7.89543 6 7 6.89543 7 8C7 9.10457 7.89543 10 9 10C10.1046 10 11 9.10457 11 8C11 6.89543 10.1046 6 9 6Z'
                  />
                </svg>
              </button>

              {/* Deploy Menu - positioned directly below the deploy button */}
              <Transition
                show={showDeployMenu}
                as={Fragment}
                enter="transition ease-out duration-150"
                enterFrom="opacity-0 -translate-y-1"
                enterTo="opacity-100 translate-y-0"
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100 translate-y-0"
                leaveTo="opacity-0 -translate-y-1"
              >
                <div className='absolute top-full left-0 mt-1 z-50 nodrag'>
                  <GroupDeployToolbar
                    groupNodeId={id}
                    onClose={() => setShowDeployMenu(false)}
                  />
                </div>
              </Transition>
            </div>

            {/* Separator between Deploy and Run */}
            <div className='w-px h-[26px] bg-[#3e3e41] opacity-90'></div>

            {/* Run Button */}
            <button
              onClick={onRunGroup}
              disabled={isLoading}
              className={`inline-flex items-center gap-1.5 h-[26px] px-2 rounded-[6px] border border-[#404040] text-[#39bc66] text-[12px] hover:bg-[#39bc66] hover:text-black transition-all duration-150 active:scale-95 ${
                isLoading ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              {isLoading ? (
                <div className='w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
              ) : (
                <svg
                  width='12'
                  height='12'
                  viewBox='0 0 24 24'
                  fill='currentColor'
                  xmlns='http://www.w3.org/2000/svg'
                  className='transition-colors duration-200'
                >
                  <path d='M8 5V19L19 12L8 5Z' />
                </svg>
              )}
              {isLoading ? 'Running...' : 'Run'}
            </button>
            </div>
          </div>
        </NodeToolbar>


        {/* 子节点指示 - 在空白时显示提示 */}
        {childNodes.length === 0 && (
          <div className='absolute inset-0 flex items-center justify-center text-[#6D7177] text-sm opacity-50 nodrag mt-12'>
            Drag nodes here
          </div>
        )}

        {/* 调整手柄保持不变... */}
        <>
          {/* 右侧中间调整手柄 */}
          <NodeResizeControl
            position='right'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              right: '0px',
              top: '50%',
              transform: 'translateY(-50%)',
              cursor: 'e-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '12px',
                height: '32px',
              }}
            >
              <div className='w-1 h-6 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          {/* 其他调整手柄保持不变... */}
          <NodeResizeControl
            position='bottom'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              bottom: '0px',
              left: '50%',
              transform: 'translateX(-50%)',
              cursor: 's-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '32px',
                height: '12px',
              }}
            >
              <div className='w-6 h-1 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          <NodeResizeControl
            position='left'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              left: '0px',
              top: '50%',
              transform: 'translateY(-50%)',
              cursor: 'w-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '12px',
                height: '32px',
              }}
            >
              <div className='w-1 h-6 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          <NodeResizeControl
            position='top'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              top: '0px',
              left: '50%',
              transform: 'translateX(-50%)',
              cursor: 'n-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '8px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '32px',
                height: '12px',
              }}
            >
              <div className='w-6 h-1 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          <NodeResizeControl
            position='bottom-right'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              right: '0px',
              bottom: '0px',
              cursor: 'se-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: '8px',
                bottom: '8px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '16px',
                height: '16px',
              }}
            >
              <div className='w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          <NodeResizeControl
            position='bottom-left'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              left: '0px',
              bottom: '0px',
              cursor: 'sw-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '8px',
                bottom: '8px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '16px',
                height: '16px',
              }}
            >
              <div className='w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          <NodeResizeControl
            position='top-right'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              right: '0px',
              top: '0px',
              cursor: 'ne-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: '8px',
                top: '8px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '16px',
                height: '16px',
              }}
            >
              <div className='w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>

          <NodeResizeControl
            position='top-left'
            minWidth={240}
            minHeight={176}
            onResizeEnd={handleResizeEnd}
            style={{
              position: 'absolute',
              left: '0px',
              top: '0px',
              cursor: 'nw-resize',
              background: 'transparent',
              border: 'none',
              opacity: isActivated || isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: isActivated || isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '8px',
                top: '8px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '16px',
                height: '16px',
              }}
            >
              <div className='w-2 h-2 bg-[#6D7177] hover:bg-[#CDCDCD] rounded-full transition-all duration-200'></div>
            </div>
          </NodeResizeControl>
        </>
      </div>
    </div>
  );
}

export default GroupNode;
