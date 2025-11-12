'use client';
import {
  NodeProps,
  Node,
  Handle,
  Position,
  useReactFlow,
  NodeResizeControl,
} from '@xyflow/react';
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext';
import WhiteBallHandle from '../handles/WhiteBallHandle';
import TreeJSONForm from '../../tableComponent/TreeJSONForm';
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon';
import useGetSourceTarget from '../../hooks/useGetSourceTarget';
import { useWorkspaceManagement } from '../../hooks/useWorkspaceManagement';
import { useAppSettings } from '../../states/AppSettingsContext';
import { syncBlockContent } from '../../workflow/utils/externalStorage';
import {
  handleDynamicStorageSwitch,
  getStorageInfo,
  CONTENT_LENGTH_THRESHOLD,
} from '../../workflow/utils/dynamicStorageStrategy';
import { useWorkspaces } from '../../states/UserWorkspacesContext';
import TreePathEditor, { PathNode } from '../components/TreePathEditor';
import RichJSONForm from '../../tableComponent/RichJSONFormTableStyle/RichJSONForm';
import JSONForm from '../../tableComponent/JSONForm';

import IndexingMenu from './JsonNodeTopSettingBar/NodeIndexingAddMenu';
import useIndexingUtils from './hooks/useIndexingUtils';
import NodeSettingsController from './JsonNodeTopSettingBar/NodeSettingsButton';
import NodeIndexingButton from './JsonNodeTopSettingBar/NodeIndexingButton';
import NodeLoopButton from './JsonNodeTopSettingBar/NodeLoopButton';
import NodeViewToggleButton from './JsonNodeTopSettingBar/NodeViewToggleButton';

type methodNames = 'cosine';
type modelNames = 'text-embedding-ada-002';
type vdb_typeNames = 'pgvector';

type VectorIndexingStatus =
  | 'notStarted'
  | 'processing'
  | 'done'
  | 'error'
  | 'deleting';

export interface BaseIndexingItem {
  type: string;
}

interface PathSegment {
  id: string;
  type: 'key' | 'num';
  value: string;
}

export interface VectorIndexingItem extends BaseIndexingItem {
  type: 'vector';
  status: VectorIndexingStatus;
  key_path: PathSegment[];
  value_path: PathSegment[];
  entries: any[];
  index_name: string;
  collection_configs: {
    set_name: string;
    model: string;
    vdb_type: string;
    user_id: string;
    collection_name: string;
  };
}

export interface OtherIndexingItem extends BaseIndexingItem {
  type: 'other';
}

export type IndexingItem = VectorIndexingItem | OtherIndexingItem;

export type JsonNodeData = {
  content: string;
  label: string;
  isLoading: boolean;
  isWaitingForFlow: boolean;
  locked: boolean;
  isInput: boolean;
  isOutput: boolean;
  editable: boolean;
  looped: boolean;
  indexingList: IndexingItem[];
  model?: modelNames | undefined;
  method?: methodNames | undefined;
  vdb_type?: vdb_typeNames | undefined;
  index_name?: string | undefined;
};

type JsonBlockNodeProps = NodeProps<Node<JsonNodeData>>;

// 优化点 1: 使用 React.memo 包裹组件，避免不必要的重渲染
const JsonBlockNode = React.memo<JsonBlockNodeProps>(
  ({
    isConnectable,
    id,
    type,
    data: {
      content,
      label,
      isLoading,
      isWaitingForFlow,
      locked,
      isInput,
      isOutput,
      editable,
      index_name,
      indexingList = [],
    },
  }) => {
    const { fetchUserId } = useWorkspaceManagement();
    const { userId } = useWorkspaces();

    const {
      activatedNode,
      isOnConnect,
      isOnGeneratingNewNode,
      setNodeUneditable,
      editNodeLabel,
      preventInactivateNode,
      allowInactivateNodeWhenClickOutside,
      manageNodeasInput,
      manageNodeasOutput,
      activateNode,
      inactivateNode,
    } = useNodesPerFlowContext();

    const { setNodes, setEdges, getEdges, getNode } = useReactFlow();
    const {} = useAppSettings();

    // 优化点 2: 将多个相关的 state 合并，减少 state 更新的复杂性
    const [nodeState, setNodeState] = useState({
      isTargetHandleTouched: false,
      nodeLabel: label ?? id,
      isLocalEdit: false,
      isHovered: false,
      isEditing: false,
      vectorIndexingStatus: 'notStarted' as VectorIndexingStatus,
      showSettingMenu: false,
      useRichEditor: true,
      userInput: 'input view' as string | undefined,
    });

    // 使用 refs 来引用 DOM 元素，避免因引用变化导致重渲染
    const componentRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const labelContainerRef = useRef<HTMLDivElement | null>(null);
    const labelRef = useRef<HTMLInputElement | null>(null);
    // 优化点 3: 使用 ref 标记初始渲染，用于延迟计算
    const hasMountedRef = useRef(false);

    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();
    const sourceNodes = getSourceNodeIdWithLabel(id);
    const targetNodes = getTargetNodeIdWithLabel(id);

    // 优化点 4: 使用 useMemo 缓存边框颜色的计算逻辑
    const borderColor = useMemo(() => {
      if (isLoading) return 'border-[#FFA500]';
      if (isWaitingForFlow) return 'border-[#39bc66]';
      if (activatedNode?.id === id) return 'border-[#9B7EDB]';
      if (nodeState.isHovered) return 'border-[#9B7EDB]';
      return isOnConnect && nodeState.isTargetHandleTouched
        ? 'border-main-orange'
        : 'border-main-deep-grey';
    }, [
      isLoading,
      isWaitingForFlow,
      activatedNode?.id,
      id,
      nodeState.isHovered,
      isOnConnect,
      nodeState.isTargetHandleTouched,
    ]);

    // 优化点 4: 使用 useMemo 缓存整个容器的 className 字符串
    const containerClassName = useMemo(
      () =>
        `w-full h-full min-w-[240px] min-h-[176px] border-[1px] rounded-[16px] px-[8px] pt-[8px] pb-[8px] ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden json-block-node flex flex-col`,
      [borderColor]
    );

    // 优化点 4 & 5: 使用 useMemo 缓存 Handle 的样式对象，避免内联样式导致重渲染
    const handleStyle = useMemo(
      () => ({
        position: 'absolute' as const,
        width: 'calc(100%)',
        height: 'calc(100%)',
        top: '0',
        left: '0',
        borderRadius: '0',
        transform: 'translate(0px, 0px)',
        background: 'transparent',
        border: '3px solid transparent',
        zIndex: !isOnConnect ? -1 : 1,
      }),
      [isOnConnect]
    );

    // 优化点 6: 使用 useCallback 缓存所有事件处理函数和内部函数
    const handleMouseEnter = useCallback(() => {
      setNodeState(prev => ({ ...prev, isHovered: true }));
      activateNode(id);
    }, [activateNode, id]);

    const handleMouseLeave = useCallback(() => {
      setNodeState(prev => ({ ...prev, isHovered: false }));
    }, []);

    const handleTargetHandleMouseEnter = useCallback(() => {
      setNodeState(prev => ({ ...prev, isTargetHandleTouched: true }));
    }, []);

    const handleTargetHandleMouseLeave = useCallback(() => {
      setNodeState(prev => ({ ...prev, isTargetHandleTouched: false }));
    }, []);

    const onFocus = useCallback(() => {
      preventInactivateNode();
      componentRef.current?.classList.add('nodrag');
    }, [preventInactivateNode]);

    const onBlur = useCallback(() => {
      allowInactivateNodeWhenClickOutside();
      componentRef.current?.classList.remove('nodrag');
      if (nodeState.isLocalEdit) {
        editNodeLabel(id, nodeState.nodeLabel);
        setNodeState(prev => ({ ...prev, isLocalEdit: false }));
      }
    }, [
      allowInactivateNodeWhenClickOutside,
      editNodeLabel,
      id,
      nodeState.isLocalEdit,
      nodeState.nodeLabel,
    ]);

    const handleLabelChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        setNodeState(prev => ({
          ...prev,
          isLocalEdit: true,
          nodeLabel: e.target.value,
        }));
      },
      []
    );

    const handleLabelFocus = useCallback(() => {
      setNodeState(prev => ({ ...prev, isEditing: true }));
      onFocus();
    }, [onFocus]);

    const handleLabelBlur = useCallback(() => {
      setNodeState(prev => ({ ...prev, isEditing: false }));
      if (nodeState.isLocalEdit) {
        editNodeLabel(id, nodeState.nodeLabel);
        setNodeState(prev => ({ ...prev, isLocalEdit: false }));
      }
      onBlur();
    }, [editNodeLabel, id, nodeState.isLocalEdit, nodeState.nodeLabel, onBlur]);

    const updateNodeContent = useCallback(
      (newValue: string) => {
        setNodes(prevNodes =>
          prevNodes.map(node => {
            if (node.id !== id) return node;
            const storageClass = node.data?.storage_class || 'internal';
            const isExternal = storageClass === 'external';
            return {
              ...node,
              data: {
                ...node.data,
                content: newValue,
                // 仅 external 使用 dirty 标记
                dirty: isExternal ? true : false,
                savingStatus: 'editing',
              },
            };
          })
        );
      },
      [id, setNodes]
    );

    // 始终向 JSON 编辑器传入字符串，避免对非字符串执行 trim 报错
    const contentString = useMemo(() => {
      try {
        // content 在运行时可能是对象/数组（例如结构化输出），需要字符串化
        return typeof content === 'string'
          ? content
          : JSON.stringify(content ?? null, null, 2);
      } catch (e) {
        return String(content ?? '');
      }
    }, [content]);

    // 基于内容长度的动态存储策略切换（2s防抖），根据内容动态选择 structured/text
    useEffect(() => {
      const node = getNode(id);
      if (!node) return;
      const data = node.data || {};
      const currentContent = data.content;
      const storageClass = data.storage_class || 'internal';
      const isExternal = storageClass === 'external';
      const isDirty = !!data.dirty;
      const isEditing = data.savingStatus === 'editing';
      // 外部存储：仅在 dirty=true 时触发；内部存储：仅在编辑中触发
      const shouldProceed = isExternal ? isDirty : isEditing;
      if (!shouldProceed || data.isLoading) return;

      const timer = setTimeout(async () => {
        try {
          setNodes(prev =>
            prev.map(n =>
              n.id === id
                ? { ...n, data: { ...n.data, savingStatus: 'saving' } }
                : n
            )
          );

          // 将内容转换为字符串用于长度判断和存储
          const contentString =
            typeof currentContent === 'string'
              ? currentContent
              : JSON.stringify(currentContent ?? []);

          // 仅当能解析为对象/数组时使用 structured，否则按 text 处理
          let useStructured = false;
          try {
            const parsed =
              typeof currentContent === 'string'
                ? JSON.parse(currentContent)
                : currentContent;
            useStructured =
              parsed !== null &&
              (Array.isArray(parsed) || typeof parsed === 'object');
          } catch {
            useStructured = false;
          }

          // 使用动态存储策略处理内容保存
          await handleDynamicStorageSwitch({
            node,
            content: contentString,
            contentType: useStructured ? 'structured' : 'text',
            getUserId: fetchUserId as any,
            setNodes: setNodes as any,
          });

          // 调试信息：显示存储策略状态
          const storageInfo = getStorageInfo(node);
          const chunkCount = Math.ceil(
            contentString.length / CONTENT_LENGTH_THRESHOLD
          );
          console.log(`🏗️ JSON block ${id} saved:`, {
            contentLength: contentString.length,
            threshold: CONTENT_LENGTH_THRESHOLD,
            storageClass: storageInfo.storageClass,
            switched:
              storageInfo.storageClass !==
              (node.data?.storage_class || 'internal'),
            estimatedChunks:
              storageInfo.storageClass === 'external' ? chunkCount : 1,
            resourceKey: storageInfo.resourceKey,
            cleanupEnabled: storageInfo.storageClass === 'external',
          });
        } catch (e) {
          setNodes(prev =>
            prev.map(n =>
              n.id === id
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      savingStatus: 'error',
                      saveError: (e as Error)?.message || String(e),
                    },
                  }
                : n
            )
          );
        }
      }, 2000);

      return () => clearTimeout(timer);
    }, [id, getNode, setNodes, fetchUserId]);

    const calculateMaxLabelContainerWidth = useCallback(() => {
      return contentRef.current
        ? `${contentRef.current.clientWidth - 32}px`
        : '100%';
    }, []);

    const renderTagLogo = useCallback(
      () => (
        <svg
          width='24'
          height='24'
          viewBox='0 0 24 24'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
          className='group'
        >
          <path
            d='M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z'
            className='fill-[#B0A4E3] group-active:fill-[#9B7EDB]'
          />
          <path
            d='M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z'
            className='fill-[#B0A4E3] group-active:fill-[#9B7EDB]'
          />
          <path
            d='M9 9H11V11H9V9Z'
            className='fill-[#B0A4E3] group-active:fill-[#9B7EDB]'
          />
          <path
            d='M9 13H11V15H9V13Z'
            className='fill-[#B0A4E3] group-active:fill-[#9B7EDB]'
          />
          <path
            d='M13 9H15V11H13V9Z'
            className='fill-[#B0A4E3] group-active:fill-[#9B7EDB]'
          />
          <path
            d='M13 13H15V15H13V13Z'
            className='fill-[#B0A4E3] group-active:fill-[#9B7EDB]'
          />
        </svg>
      ),
      []
    );

    const { handleAddIndex, handleRemoveIndex } = useIndexingUtils();

    // 辅助函数：获取用户ID
    const getUserId = useCallback(async (): Promise<string | null> => {
      if (!userId || userId.trim() === '') {
        const res = await fetchUserId();
        return res || null;
      }
      return userId;
    }, [userId, fetchUserId]);

    // 更新的 onRemoveIndex 方法
    const onRemoveIndex = useCallback(
      async (index: number) => {
        const itemToRemove = indexingList[index];

        if (itemToRemove && itemToRemove.type === 'vector') {
          const updatedList = [...indexingList];
          (updatedList[index] as VectorIndexingItem).status = 'deleting';

          setNodes(nodes =>
            nodes.map(node =>
              node.id === id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      indexingList: updatedList,
                    },
                  }
                : node
            )
          );
        }

        try {
          const { success, newList } = await handleRemoveIndex(
            index,
            indexingList,
            id,
            getUserId,
            (status: VectorIndexingStatus) =>
              setNodeState(prev => ({
                ...prev,
                vectorIndexingStatus: status,
              }))
          );

          setNodes(nodes =>
            nodes.map(node =>
              node.id === id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      indexingList: newList,
                    },
                  }
                : node
            )
          );
        } catch (error) {
          console.error('Error removing index:', error);

          if (itemToRemove && itemToRemove.type === 'vector') {
            const errorList = [...indexingList];
            (errorList[index] as VectorIndexingItem).status = 'error';

            setNodes(nodes =>
              nodes.map(node =>
                node.id === id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        indexingList: errorList,
                      },
                    }
                  : node
              )
            );
          }
        }
      },
      [indexingList, id, setNodes, handleRemoveIndex, getUserId]
    );

    // 修改后的 onAddIndex 方法
    const onAddIndex = useCallback(
      async (newItem: IndexingItem) => {
        if (newItem.type === 'vector') {
          const temporaryItem: VectorIndexingItem = {
            ...(newItem as VectorIndexingItem),
            status: 'processing',
            entries: [],
            index_name: '',
            collection_configs: {
              set_name: '',
              model: 'text-embedding-ada-002',
              vdb_type: 'pgvector',
              user_id: '',
              collection_name: '',
            },
          };

          const tempIndexingList = [...indexingList, temporaryItem];

          setNodes(nodes =>
            nodes.map(node =>
              node.id === id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      indexingList: tempIndexingList,
                    },
                  }
                : node
            )
          );

          const finalIndexingList = await handleAddIndex(
            id,
            newItem,
            indexingList,
            (status: VectorIndexingStatus) =>
              setNodeState(prev => ({
                ...prev,
                vectorIndexingStatus: status,
              })),
            getUserId
          );

          if (finalIndexingList) {
            const updatedListWithStatus = [...finalIndexingList];
            const lastIndex = updatedListWithStatus.length - 1;

            if (
              lastIndex >= 0 &&
              updatedListWithStatus[lastIndex].type === 'vector'
            ) {
              (updatedListWithStatus[lastIndex] as VectorIndexingItem).status =
                'done';
            }

            setNodes(nodes =>
              nodes.map(node =>
                node.id === id
                  ? {
                      ...node,
                      data: {
                        ...node.data,
                        indexingList: updatedListWithStatus,
                      },
                    }
                  : node
              )
            );
          } else {
            const errorIndexingList = [...tempIndexingList];
            const errorItemIndex = errorIndexingList.length - 1;

            if (
              errorItemIndex >= 0 &&
              errorIndexingList[errorItemIndex].type === 'vector'
            ) {
              (errorIndexingList[errorItemIndex] as VectorIndexingItem).status =
                'error';

              setNodes(nodes =>
                nodes.map(node =>
                  node.id === id
                    ? {
                        ...node,
                        data: {
                          ...node.data,
                          indexingList: errorIndexingList,
                        },
                      }
                    : node
                )
              );
            }
          }
        } else {
          const newIndexingList = await handleAddIndex(
            id,
            newItem,
            indexingList,
            (status: VectorIndexingStatus) =>
              setNodeState(prev => ({
                ...prev,
                vectorIndexingStatus: status,
              })),
            getUserId
          );

          if (newIndexingList) {
            setNodes(nodes =>
              nodes.map(node =>
                node.id === id
                  ? {
                      ...node,
                      data: { ...node.data, indexingList: newIndexingList },
                    }
                  : node
              )
            );
          }
        }
      },
      [indexingList, id, setNodes, handleAddIndex, getUserId]
    );

    const toggleRichEditor = useCallback(() => {
      setNodeState(prev => ({ ...prev, useRichEditor: !prev.useRichEditor }));
    }, []);

    // 优化点 3: 借鉴 TextBlockNode，延迟初始渲染时的副作用
    useEffect(() => {
      const checkAndSetNodeRole = () => {
        const isAutoDetectInput =
          sourceNodes.length === 0 && targetNodes.length > 0;
        const isAutoDetectOutput =
          targetNodes.length === 0 && sourceNodes.length > 0;

        if (isAutoDetectInput && !isInput) {
          manageNodeasInput(id);
        } else if (isAutoDetectOutput && !isOutput) {
          manageNodeasOutput(id);
        } else if (
          !isAutoDetectInput &&
          !isAutoDetectOutput &&
          (isInput || isOutput)
        ) {
          if (isInput) manageNodeasInput(id);
          if (isOutput) manageNodeasOutput(id);
        }
      };

      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        requestAnimationFrame(checkAndSetNodeRole);
      } else {
        checkAndSetNodeRole();
      }
    }, [
      sourceNodes.length,
      targetNodes.length,
      isInput,
      isOutput,
      id,
      manageNodeasInput,
      manageNodeasOutput,
    ]);

    // 管理外部点击事件
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          !labelContainerRef.current?.contains(e.target as HTMLElement) &&
          !(e.target as HTMLElement).classList.contains('renameButton')
        ) {
          setNodeUneditable(id);
        }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }, [id, setNodeUneditable]);

    // 自动聚焦
    useEffect(() => {
      if (editable && labelRef.current) {
        labelRef.current.focus();
        const length = labelRef.current.value.length;
        labelRef.current.setSelectionRange(length, length);
      }
    }, [editable]);

    // 同步外部 label 变化
    useEffect(() => {
      const currentLabel = getNode(id)?.data?.label;
      if (
        currentLabel !== undefined &&
        currentLabel !== nodeState.nodeLabel &&
        !nodeState.isLocalEdit
      ) {
        const labelString =
          typeof currentLabel === 'string'
            ? currentLabel
            : String(currentLabel);
        setNodeState(prev => ({ ...prev, nodeLabel: labelString }));
      }
    }, [label, id, getNode, nodeState.isLocalEdit, nodeState.nodeLabel]);

    // 添加点击外部关闭菜单的逻辑
    useEffect(() => {
      if (!nodeState.showSettingMenu) return;

      const handleClickOutside = (e: MouseEvent) => {
        const targetElement = e.target as HTMLElement;
        if (
          nodeState.showSettingMenu &&
          !targetElement.closest('.indexing-menu-container')
        ) {
          setNodeState(prev => ({ ...prev, showSettingMenu: false }));
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [nodeState.showSettingMenu]);

    // Prevent wheel/touch scroll from bubbling to ReactFlow at native capture phase
    useEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const stopWheel = (e: WheelEvent) => {
        e.stopPropagation();
      };
      const stopTouchMove = (e: TouchEvent) => {
        e.stopPropagation();
      };
      el.addEventListener('wheel', stopWheel, { capture: true });
      el.addEventListener('touchmove', stopTouchMove as any, { capture: true });
      return () => {
        el.removeEventListener('wheel', stopWheel, { capture: true } as any);
        el.removeEventListener(
          'touchmove',
          stopTouchMove as any,
          {
            capture: true,
          } as any
        );
      };
    }, []);

    return (
      <div
        ref={componentRef}
        className={`relative w-full h-full min-w-[240px] min-h-[176px] ${
          isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Tag for locked state only (input/output tags hidden) */}
        {locked && (
          <div className='absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5'>
            <div className='px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black'>
              <svg
                width='16'
                height='16'
                viewBox='0 0 16 16'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
              >
                <path
                  d='M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7'
                  stroke='currentColor'
                  strokeWidth='1.5'
                  strokeLinecap='round'
                />
                <rect
                  x='4'
                  y='7'
                  width='8'
                  height='6'
                  rx='1'
                  fill='currentColor'
                />
              </svg>
              <span>LOCKED</span>
            </div>
          </div>
        )}

        <div ref={contentRef} id={id} className={containerClassName}>
          {/* the top bar of a block */}
          <div
            ref={labelContainerRef}
            className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}
          >
            {/* top-left wrapper */}
            <div
              className='flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group'
              style={{
                maxWidth: `calc(${calculateMaxLabelContainerWidth()} - 44px)`,
              }}
            >
              <div className='min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]'>
                {renderTagLogo()}
              </div>

              {editable ? (
                <input
                  ref={labelRef}
                  className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]
                  w-full
                `}
                  value={nodeState.nodeLabel}
                  onChange={handleLabelChange}
                  onFocus={handleLabelFocus}
                  onBlur={handleLabelBlur}
                />
              ) : (
                <span
                  className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]
                `}
                >
                  {nodeState.nodeLabel}
                </span>
              )}
            </div>

            {/* top-right toolbar */}
            <div className='min-w-[60px] min-h-[24px] z-[100000] flex items-center justify-end gap-[8px]'>
              <NodeSettingsController nodeid={id} />
              <NodeIndexingButton
                nodeid={id}
                indexingList={indexingList}
                onAddIndex={onAddIndex}
                onRemoveIndex={onRemoveIndex}
              />

              <NodeLoopButton nodeid={id} />
            </div>
          </div>

          {/* JSON Editor - 根据状态切换不同的编辑器 */}
          {isLoading ? (
            <SkeletonLoadingIcon />
          ) : (
            <div
              className={`flex-1 min-h-0 overflow-auto overscroll-contain scrollbar-hide`}
              style={{
                background: 'transparent',
                boxShadow: 'none',
              }}
              ref={scrollContainerRef}
              onWheel={e => {
                e.stopPropagation();
              }}
              onWheelCapture={e => {
                e.stopPropagation();
              }}
              onScroll={e => {
                e.stopPropagation();
              }}
              onTouchMove={e => {
                e.stopPropagation();
              }}
              onTouchMoveCapture={e => {
                e.stopPropagation();
              }}
            >
              {nodeState.useRichEditor ? (
                <RichJSONForm
                  preventParentDrag={onFocus}
                  allowParentDrag={onBlur}
                  placeholder='Create your JSON structure...'
                  value={contentString}
                  onChange={updateNodeContent}
                  widthStyle={0}
                  heightStyle={0}
                  readonly={locked}
                />
              ) : (
                <JSONForm
                  preventParentDrag={onFocus}
                  allowParentDrag={onBlur}
                  placeholder='{"key": "value"}'
                  value={contentString}
                  onChange={updateNodeContent}
                  widthStyle={0}
                  heightStyle={0}
                  readonly={locked}
                />
              )}
            </div>
          )}

          {/* Bottom-left view toggle button - show on hover only */}
          <div
            className='absolute left-2 bottom-2 z-[100001] transition-opacity duration-200'
            style={{
              opacity: nodeState.isHovered ? 1 : 0,
              pointerEvents: nodeState.isHovered ? 'auto' : 'none',
            }}
          >
            <NodeViewToggleButton
              useRichEditor={nodeState.useRichEditor}
              onToggle={toggleRichEditor}
            />
          </div>

          <NodeResizeControl
            minWidth={240}
            minHeight={176}
            style={{
              position: 'absolute',
              right: '0px',
              bottom: '0px',
              cursor: 'se-resize',
              background: 'transparent',
              border: 'none',
              opacity: nodeState.isHovered ? 1 : 0,
              transition: 'opacity 0.2s ease-in-out',
              pointerEvents: nodeState.isHovered ? 'auto' : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                visibility: `${nodeState.isHovered ? 'visible' : 'hidden'}`,
                right: '0px',
                bottom: '0px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: 'transparent',
                zIndex: '200000',
                width: '26px',
                height: '26px',
              }}
            >
              <svg
                width='26'
                height='26'
                viewBox='0 0 26 26'
                fill='none'
                xmlns='http://www.w3.org/2000/svg'
                className='group active:group-[]:fill-[#9B7EDB]'
              >
                <path
                  d='M10 5.99998H12V7.99998H10V5.99998Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]'
                />
                <path
                  d='M10 2H12V4H10V2Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]'
                />
                <path
                  d='M6 5.99998H8V7.99998H6V5.99998Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]'
                />
                <path
                  d='M6 10H8V12H6V10Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]'
                />
                <path
                  d='M2 10H4V12H2V10Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]'
                />
                <path
                  d='M10 10H12V12H10V10Z'
                  className='fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]'
                />
              </svg>
            </div>
          </NodeResizeControl>

          {/* Source Handles */}
          <WhiteBallHandle
            id={`${id}-a`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Top}
          />
          <WhiteBallHandle
            id={`${id}-b`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}
          />
          <WhiteBallHandle
            id={`${id}-c`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Bottom}
          />
          <WhiteBallHandle
            id={`${id}-d`}
            type='source'
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Left}
          />

          {/* Target Handles */}
          {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(
            (pos, index) => (
              <Handle
                key={pos}
                id={`${id}-${String.fromCharCode(97 + index)}`}
                type='target'
                position={pos}
                style={handleStyle}
                isConnectable={isConnectable}
                onMouseEnter={handleTargetHandleMouseEnter}
                onMouseLeave={handleTargetHandleMouseLeave}
              />
            )
          )}
        </div>
      </div>
    );
  }
);

JsonBlockNode.displayName = 'JsonBlockNode';

export default JsonBlockNode;
