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
  Node,
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

type GroupNodeProps = NodeProps<Node<GroupNodeData>>;

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
  const { getNodes, deleteElements, setNodes, getNode } = useReactFlow();
  const { detachNodes, detachNodesFromGroup } = useDetachNodes();
  const { recalculateGroupNodes } = useGroupNodeCalculation();
  const { activatedNode, clearAll } = useNodesPerFlowContext();
  const [isHovered, setIsHovered] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Add workspace context for deployment
  const { showingItem } = useWorkspaces();
  const selectedFlowId =
    showingItem?.type === 'workspace' ? showingItem.id : null;

  // Deployment state
  const [deployHovered, setDeployHovered] = useState(false);
  const [showDeployMenu, setShowDeployMenu] = useState(false);

  // 获取所有需要的依赖
  const {
    streamResult,
    streamResultForMultipleNodes,
    reportError,
    resetLoadingUI,
  } = useJsonConstructUtils();
  const { getAuthHeaders } = useAppSettings();
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
      getAuthHeaders,
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
      getAuthHeaders,
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
          <div className='flex items-center gap-2 backdrop-blur-sm border border-[#333333]/80 rounded-lg p-2 shadow-lg'>
            {/* Group Title */}
            <div className='flex items-center gap-2'>
              <span className='font-[600] text-[13px] leading-[20px] font-plus-jakarta-sans text-[#888888]'>
                {`Group ${data.label}`}
              </span>
              {/* 子节点数量指示器 */}
              {childNodes.length > 0 && (
                <div className='text-[10px] text-[#666666] px-1 py-0.5 rounded'>
                  ({childNodes.length}{' '}
                  {childNodes.length === 1 ? 'node' : 'nodes'})
                </div>
              )}
            </div>
            
            {/* 分隔符 */}
            <div className='w-px h-[32px] bg-[#555555]/80'></div>

            {/* Settings Menu */}
            <Menu as="div" className="relative">
              <Menu.Button className='group w-[32px] h-[32px] text-sm bg-[#2A2B2D] hover:bg-[#3A3B3D] text-[#CDCDCD] rounded-md border border-[#444444] hover:border-[#555555] flex items-center justify-center transition-all duration-200 hover:shadow-md'>
                <svg
                  width='15'
                  height='3'
                  viewBox='0 0 15 3'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                >
                  <rect x='0' y='0' width='3' height='3' className='fill-[#6D7177] group-hover:fill-[#CDCDCD]'/>
                  <rect x='6' y='0' width='3' height='3' className='fill-[#6D7177] group-hover:fill-[#CDCDCD]'/>
                  <rect x='12' y='0' width='3' height='3' className='fill-[#6D7177] group-hover:fill-[#CDCDCD]'/>
                </svg>
              </Menu.Button>
              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                <Menu.Items className="absolute top-full left-0 mt-1 w-56 bg-[#1A1A1A]/95 backdrop-blur-md border border-[#333333] rounded-lg shadow-2xl z-50 p-1">
                  {/* Recalculate */}
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={onManualRecalculate}
                        className={`${active ? 'bg-[#3A3B3D]' : ''} w-full text-left px-3 py-2 text-sm text-[#CDCDCD] rounded-md flex items-center gap-2`}
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
                      <div className="text-xs text-[#888888] mb-2">Background Color</div>
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

                  <div className="w-full h-px bg-[#333333] my-1"></div>

                  {/* Detach All */}
                  {childNodes.length > 0 && (
                    <Menu.Item>
                      {({ active }) => (
                        <button
                          onClick={onDetachAll}
                          className={`${active ? 'bg-[#3A3B3D]' : ''} w-full text-left px-3 py-2 text-sm text-[#CDCDCD] rounded-md flex items-center gap-2`}
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
                        className={`${active ? 'bg-[#E53E3E] text-white' : 'text-[#E53E3E]'} w-full text-left px-3 py-2 text-sm rounded-md flex items-center gap-2`}
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

            <button
              onClick={onRunGroup}
              disabled={isLoading}
              className={`px-3 py-1.5 h-[32px] text-sm bg-[#2A2B2D] hover:bg-[#39BC66] text-[#CDCDCD] hover:text-black rounded-md border border-[#444444] hover:border-[#39BC66] flex items-center gap-2 transition-all duration-200 ${
                isLoading
                  ? 'opacity-50 cursor-not-allowed'
                  : 'hover:shadow-md'
              }`}
            >
              {isLoading ? (
                <div className='w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
              ) : (
                <svg
                  width='14'
                  height='14'
                  viewBox='0 0 24 24'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  className='transition-colors duration-200'
                >
                  <path d='M8 5V19L19 12L8 5Z' fill='currentColor' />
                </svg>
              )}
              {isLoading ? 'Running...' : 'Test Run'}
            </button>

            {/* Deploy Button with Menu */}
            <div className="relative">
              <button
                className={`flex flex-row items-center justify-center gap-[8px] px-[10px] h-[32px] rounded-[8px] bg-[#2A2B2D] border-[1px] hover:bg-[#FFA73D] transition-colors border-[#444444] hover:border-[#FFA73D] group`}
                onMouseEnter={() => setDeployHovered(true)}
                onMouseLeave={() => setDeployHovered(false)}
                onClick={() => setShowDeployMenu(!showDeployMenu)}
              >
                <svg
                  width='18'
                  height='15'
                  viewBox='0 0 18 15'
                  fill='none'
                  xmlns='http://www.w3.org/2000/svg'
                  className='transition-[stroke]'
                >
                  <path
                    className='transition-[fill]'
                    d='M14.5 11L17.5 15H14.5V11Z'
                    fill={deployHovered === true ? '#000' : '#CDCDCD'}
                  />
                  <path
                    className='transition-[fill]'
                    d='M3.5 11V15H0.5L3.5 11Z'
                    fill={deployHovered === true ? '#000' : '#CDCDCD'}
                  />
                  <path
                    className='transition-[fill]'
                    fillRule='evenodd'
                    clipRule='evenodd'
                    d='M12.0049 5.19231C11.0095 2.30769 9.01893 0 9.01893 0C9.01893 0 7.02834 2.30769 6.03314 5.19231C4.79777 8.77308 5.03785 15 5.03785 15H13.0002C13.0002 15 13.2405 8.77298 12.0049 5.19231ZM9 6C7.89543 6 7 6.89543 7 8C7 9.10457 7.89543 10 9 10C10.1046 10 11 9.10457 11 8C11 6.89543 10.1046 6 9 6Z'
                    fill={deployHovered === true ? '#000' : '#CDCDCD'}
                  />
                </svg>
                <div
                  className={`text-[14px] font-normal leading-normal transition-colors ${deployHovered === true ? 'text-[#000]' : 'text-[#CDCDCD]'}`}
                >
                  Deploy
                </div>
              </button>

              {/* Deploy Menu - positioned directly below the deploy button */}
              {showDeployMenu && (
                <div className='absolute top-full left-0 mt-1 z-50 nodrag'>
                  <GroupDeployToolbar
                    groupNodeId={id}
                    onClose={() => setShowDeployMenu(false)}
                  />
                </div>
              )}
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
