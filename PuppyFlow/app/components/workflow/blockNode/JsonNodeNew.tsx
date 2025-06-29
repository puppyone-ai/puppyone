'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React, { useRef, useEffect, useState, ReactElement, Fragment, useCallback } from 'react'
// import { nodeState, useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
// 更新导入 - 使用新的 TreeJSONForm
import TreeJSONForm from '../../tableComponent/TreeJSONForm'
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon'
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils'
import { useWorkspaceManagement } from '../../hooks/useWorkspaceManagement'
import { useWorkspaces } from "../../states/UserWorkspacesContext"
// 导入新组件
import TreePathEditor, { PathNode } from '../components/TreePathEditor'
import RichJSONForm from '../../tableComponent/RichJSONForm/RichJSONForm'
import JSONForm from '../../tableComponent/JSONForm'

import IndexingMenu from './JsonNodeTopSettingBar/NodeIndexingMenu'
import useIndexingUtils from './hooks/useIndexingUtils'
import NodeSettingsController from './JsonNodeTopSettingBar/NodeSettingsButton'
import NodeIndexingButton from './JsonNodeTopSettingBar/NodeIndexingButton'
import NodeLoopButton from './JsonNodeTopSettingBar/NodeLoopButton'
import NodeViewToggleButton from './JsonNodeTopSettingBar/NodeViewToggleButton'

type methodNames = "cosine"
type modelNames = "text-embedding-ada-002"
type vdb_typeNames = "pgvector"

// 添加这个类型定义
type VectorIndexingStatus = 'notStarted' | 'processing' | 'done' | 'error' | 'deleting';

// 定义基本的 IndexingItem 类型
export interface BaseIndexingItem {
  type: string; // 用于区分不同类型的索引项
}

interface PathSegment {
  id: string;
  type: 'key' | 'num';
  value: string;
}

// Vector 类型的索引项
export interface VectorIndexingItem extends BaseIndexingItem {
  type: 'vector';
  status: VectorIndexingStatus;
  key_path: PathSegment[];
  value_path: PathSegment[];
  chunks: any[]; // 修改为任意类型的列表
  index_name: string;
  collection_configs: {
    set_name: string;
    model: string;
    vdb_type: string;
    user_id: string;
    collection_name: string;
  }
}

// 可以添加其他类型的索引项
export interface OtherIndexingItem extends BaseIndexingItem {
  type: 'other';
  // 其他特定属性
}

// 联合类型，包含所有可能的索引项类型
export type IndexingItem = VectorIndexingItem | OtherIndexingItem;

export type JsonNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
  looped: boolean,
  indexingList: IndexingItem[],

  // embedding configurations
  model?: modelNames | undefined,
  method?: methodNames | undefined,
  vdb_type?: vdb_typeNames | undefined,
  index_name?: string | undefined, // 用于存储embedding 的index_name
}

type JsonBlockNodeProps = NodeProps<Node<JsonNodeData>>

// 注意：PathNode 类型已经在 TreePathEditor 组件中导出，这里不需要重复定义

function JsonBlockNode({ isConnectable, id, type, data: { content, label, isLoading, locked, isInput, isOutput, editable, index_name, indexingList = [] } }: JsonBlockNodeProps) {
  const { fetchUserId } = useWorkspaceManagement()
  const { userId } = useWorkspaces()

  type ExtendedNode = Node<JsonNodeData> & { looped?: boolean };
  // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  // const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const { activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside, clearAll, manageNodeasInput, manageNodeasOutput } = useNodesPerFlowContext()
  const { setNodes, setEdges, getEdges, getNode } = useReactFlow()
  // for linking to handle bar, it will be highlighed.
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel
  const [isEditing, setIsEditing] = useState(false)
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")
  const [vectorIndexingStatus, setVectorIndexingStatus] = useState<VectorIndexingStatus>('notStarted');

  // Get connected nodes
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } = useJsonConstructUtils()
  const sourceNodes = getSourceNodeIdWithLabel(id)
  const targetNodes = getTargetNodeIdWithLabel(id)

  // 添加自动检测和同步状态的 useEffect
  useEffect(() => {
    const isAutoDetectInput = sourceNodes.length === 0 && targetNodes.length > 0;
    const isAutoDetectOutput = targetNodes.length === 0 && sourceNodes.length > 0;

    // 仅当当前状态与自动检测不一致时更新状态
    if (isAutoDetectInput && !isInput) {
      manageNodeasInput(id);
    } else if (isAutoDetectOutput && !isOutput) {
      manageNodeasOutput(id);
    } else if (!isAutoDetectInput && !isAutoDetectOutput && (isInput || isOutput)) {
      // 如果既不是输入也不是输出，但当前有一个标记，则移除标记
      if (isInput) manageNodeasInput(id);
      if (isOutput) manageNodeasOutput(id);
    }
  }, [sourceNodes.length, targetNodes.length, isInput, isOutput, id]);

  // Validation function to check if any node has an empty value
  const hasEmptyValues = (nodes: PathNode[]): boolean => {
    for (const node of nodes) {
      if (node.value.trim() === '') {
        return true;
      }
      if (node.children.length > 0 && hasEmptyValues(node.children)) {
        return true;
      }
    }
    return false;
  };

  useEffect(() => {
    if (activatedNode?.id === id) {
      setBorderColor("border-[#9B7EDB]");
    } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched, locked, isInput, isOutput, id])

  // 管理labelContainer的宽度
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (!labelContainerRef.current?.contains(e.target as HTMLElement) &&
        !(e.target as HTMLElement).classList.contains("renameButton")) {
        setNodeUneditable(id)
      }
    }

    document.addEventListener("click", handleClickOutside)

    return () => {
      document.removeEventListener("click", handleClickOutside)
    }
  }, [id]) // 添加 id 作为依赖

  // 自动聚焦，同时需要让cursor focus 到input 的最后一位
  useEffect(() => {
    if (editable && labelRef.current) {
      labelRef.current?.focus();
      const length = labelRef.current.value.length;
      labelRef.current.setSelectionRange(length, length);
    }
  }, [editable, id]);

  // 管理 label onchange， 注意：若是当前的workflow中已经存在同样的id，那么不回重新对于这个node进行initialized，那么此时label就是改变了也不会rendering 最新的值，所以我们必须要通过这个useEffect来确保label的值是最新的，同时需要update measureSpanRef 中需要被测量的内容
  useEffect(() => {
    const currentLabel = getNode(id)?.data?.label as string | undefined
    if (currentLabel !== undefined && currentLabel !== nodeLabel && !isLocalEdit) {
      setNodeLabel(currentLabel)
    }
  }, [label, id, isLocalEdit])

  const onFocus: () => void = () => {
    preventInactivateNode()
    const curRef = componentRef.current
    if (curRef && !curRef.classList.contains("nodrag")) {
      curRef.classList.add("nodrag")
    }
  }

  const onBlur: () => void = () => {
    allowInactivateNodeWhenClickOutside()
    const curRef = componentRef.current
    if (curRef) {
      curRef.classList.remove("nodrag")
    }
    if (isLocalEdit) {
      //  管理 node label onchange，只有 onBlur 的时候，才会更新 label
      // setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
      editNodeLabel(id, nodeLabel)
      setIsLocalEdit(false)
    }
  }

  // 添加 JSON 内容同步函数
  const updateNodeContent = useCallback((newValue: string) => {
    setNodes(prevNodes => (prevNodes.map(node => node.id === id ? {
      ...node,
      data: { ...node.data, content: newValue }
    } : node)))
  }, [id, setNodes])

  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    return (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M9 9H11V11H9V9Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M9 13H11V15H9V13Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M13 9H15V11H13V9Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
        <path d="M13 13H15V15H13V13Z" className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]" />
      </svg>
    )
  }

  // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
  const calculateMaxLabelContainerWidth = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth - 32}px`
    }
    return '100%'
  }

  const [userInput, setUserInput] = useState<string | undefined>("input view")

  const [showSettingMenu, setShowSettingMenu] = useState(false)

  useEffect(
    () => {
      console.log("jsonndoe isloading", isLoading)
    }
    , []
  )

  // 添加点击外部关闭菜单的逻辑
  useEffect(() => {
    if (!showSettingMenu) return;

    const handleClickOutside = (e: MouseEvent) => {
      // 检查点击是否在菜单外部
      const targetElement = e.target as HTMLElement;
      if (showSettingMenu && !targetElement.closest('.indexing-menu-container')) {
        setShowSettingMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSettingMenu]);

  const { handleAddIndex, handleRemoveIndex } = useIndexingUtils();

  // 辅助函数：获取用户ID
  const getUserId = async (): Promise<string | null> => {
    if (!userId || userId.trim() === "") {
      const res = await fetchUserId();
      if (res) {
        return res;
      } else {
        return null;
      }
    }
    return userId;
  };

  // 更新的 onRemoveIndex 方法
  const onRemoveIndex = async (index: number) => {
    // 获取当前要删除的项
    const itemToRemove = indexingList[index];

    // 如果是向量索引类型，先显示"删除中"状态
    if (itemToRemove && itemToRemove.type === 'vector') {
      // 创建带有"删除中"状态的索引列表副本
      const updatedList = [...indexingList];
      (updatedList[index] as VectorIndexingItem).status = 'deleting';

      // 立即更新UI显示删除中状态
      setNodes(nodes => nodes.map(node =>
        node.id === id ? {
          ...node,
          data: {
            ...node.data,
            indexingList: updatedList
          }
        } : node
      ));
    }

    try {
      // 调用删除函数，添加setVectorIndexingStatus参数
      const { success, newList } = await handleRemoveIndex(
        index,
        indexingList,
        id,
        getUserId,
        setVectorIndexingStatus  // 添加缺少的参数
      );

      // 更新节点状态
      setNodes(nodes => nodes.map(node =>
        node.id === id ? {
          ...node,
          data: {
            ...node.data,
            indexingList: newList
          }
        } : node
      ));
    } catch (error) {
      console.error("Error removing index:", error);

      // 如果是向量索引且发生异常，将状态设为错误并保留该项
      if (itemToRemove && itemToRemove.type === 'vector') {
        const errorList = [...indexingList];
        (errorList[index] as VectorIndexingItem).status = 'error';

        setNodes(nodes => nodes.map(node =>
          node.id === id ? {
            ...node,
            data: {
              ...node.data,
              indexingList: errorList
            }
          } : node
        ));
      }
    }
  };

  // 修改后的 onAddIndex 方法
  const onAddIndex = async (newItem: IndexingItem) => {
    // 如果是向量索引类型，先创建一个 processing 状态的临时项
    if (newItem.type === 'vector') {
      // 创建临时索引项
      const temporaryItem: VectorIndexingItem = {
        ...newItem as VectorIndexingItem,
        status: 'processing',
        chunks: [],
        index_name: '', // 初始为空，等待后端返回
        collection_configs: {
          set_name: '',
          model: 'text-embedding-ada-002',
          vdb_type: 'pgvector',
          user_id: '',
          collection_name: ''
        }
      };

      // 先将临时项添加到索引列表
      const tempIndexingList = [...indexingList, temporaryItem];

      // 立即更新 UI 显示处理中状态
      setNodes(nodes => nodes.map(node =>
        node.id === id ? {
          ...node,
          data: {
            ...node.data,
            indexingList: tempIndexingList
          }
        } : node
      ));

      // 调用 handleAddIndex 处理实际的索引创建
      const finalIndexingList = await handleAddIndex(
        id,
        newItem,
        indexingList,
        setVectorIndexingStatus,
        getUserId
      );

      // 如果成功获取到更新后的索引列表
      if (finalIndexingList) {
        // 找到新添加的索引项(最后一项)并确保其状态被正确更新为'done'
        const updatedListWithStatus = [...finalIndexingList];
        const lastIndex = updatedListWithStatus.length - 1;

        if (lastIndex >= 0 && updatedListWithStatus[lastIndex].type === 'vector') {
          (updatedListWithStatus[lastIndex] as VectorIndexingItem).status = 'done';
        }

        setNodes(nodes => nodes.map(node =>
          node.id === id ? {
            ...node,
            data: {
              ...node.data,
              indexingList: updatedListWithStatus
            }
          } : node
        ));
      } else {
        // 如果索引创建失败，更新临时项的状态为错误
        const errorIndexingList = [...tempIndexingList];
        const errorItemIndex = errorIndexingList.length - 1;

        if (errorItemIndex >= 0 && errorIndexingList[errorItemIndex].type === 'vector') {
          (errorIndexingList[errorItemIndex] as VectorIndexingItem).status = 'error';

          setNodes(nodes => nodes.map(node =>
            node.id === id ? {
              ...node,
              data: {
                ...node.data,
                indexingList: errorIndexingList
              }
            } : node
          ));
        }
      }
    } else {
      // 如果不是向量索引类型，直接处理
      const newIndexingList = await handleAddIndex(
        id,
        newItem,
        indexingList,
        setVectorIndexingStatus,
        getUserId
      );

      if (newIndexingList) {
        setNodes(nodes => nodes.map(node =>
          node.id === id ? { ...node, data: { ...node.data, indexingList: newIndexingList } } : node
        ));
      }
    }
  };

  // 添加视图切换状态
  const [useRichEditor, setUseRichEditor] = useState(false); // 默认使用传统 JSONForm

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[176px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      {/* Add tags for input, output and locked states */}
      <div className="absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5">
        {isInput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="16" y="7" width="3" height="12" rx="1" fill="currentColor" />
              <path d="M5 13H14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M10 9L14 13L10 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>INPUT</span>
          </div>
        )}

        {isOutput && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#FF9267] text-black">
            <svg width="16" height="16" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="7" y="7" width="3" height="12" rx="1" fill="currentColor" />
              <path d="M12 13H21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M17 9L21 13L17 17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>OUTPUT</span>
          </div>
        )}

        {locked && (
          <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <rect x="4" y="7" width="8" height="6" rx="1" fill="currentColor" />
            </svg>
            <span>LOCKED</span>
          </div>
        )}
      </div>

      <div ref={contentRef} id={id} className={`w-full h-full min-w-[240px] min-h-[176px] border-[1px] rounded-[16px] px-[8px] pt-[8px] pb-[8px] ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden json-block-node flex flex-col`}>

        {/* the top bar of a block */}
        <div ref={labelContainerRef}
          className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}>

          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
            style={{
              maxWidth: `calc(${calculateMaxLabelContainerWidth()} - 44px)`,
            }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]">
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
                value={nodeLabel}
                onChange={(e) => {
                  setIsLocalEdit(true);
                  setNodeLabel(e.target.value);
                }}
                onFocus={() => {
                  setIsEditing(true);
                  onFocus();
                }}
                onBlur={() => {
                  setIsEditing(false);
                  if (isLocalEdit) {
                    editNodeLabel(id, nodeLabel);
                    setIsLocalEdit(false);
                  }
                  onBlur();
                }}
              />
            ) : (
              <span
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#9B7EDB]
                `}
              >
                {nodeLabel}
              </span>
            )}
          </div>

          {/* top-right toolbar */}
          <div className="min-w-[60px] min-h-[24px] z-[100000] flex items-center justify-end gap-[8px]">
            {/* NodeToolBar */}
            <NodeSettingsController nodeid={id} />

            {/* 使用新的 NodeViewToggleButton 组件 */}
            {/* <NodeViewToggleButton
              useRichEditor={useRichEditor}
              onToggle={() => setUseRichEditor(!useRichEditor)}
            /> */}

            {/* 使用 NodeIndexingButton 组件，传递所需的索引操作函数 */}
            <NodeIndexingButton
              nodeid={id}
              indexingList={indexingList}
              onAddIndex={onAddIndex}
              onRemoveIndex={onRemoveIndex}
            />

            {/* 使用新的 NodeLoopButton 组件 */}
            <NodeLoopButton nodeid={id} />
          </div>
        </div>

        {/* JSON Editor - 根据状态切换不同的编辑器 */}
        {isLoading ? <SkeletonLoadingIcon /> :
          <div className={`flex-1 min-h-0 overflow-hidden`}
            style={{
              background: "transparent",
              boxShadow: "none",
            }}
          >
            {useRichEditor ? (
              <RichJSONForm
                preventParentDrag={onFocus}
                allowParentDrag={onBlur}
                placeholder='Create your JSON structure...'
                value={content || ""}
                onChange={updateNodeContent}
                widthStyle={0}  // 0 表示使用 100%
                heightStyle={0} // 0 表示使用 100%
                readonly={locked}
              />
            ) : (
              <JSONForm
                preventParentDrag={onFocus}
                allowParentDrag={onBlur}
                placeholder='{"key": "value"}'
                value={content || ""}
                onChange={updateNodeContent}
                widthStyle={0}  // 0 表示使用 100%
                heightStyle={0} // 0 表示使用 100%
                readonly={locked}
              />
            )}
          </div>
        }

        <NodeResizeControl
          minWidth={240}
          minHeight={176}
          style={{
            position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize',
            background: 'transparent',
            border: 'none'
          }}
        >
          <div
            style={{
              position: "absolute",
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
              right: "0px",
              bottom: "0px",
              display: "flex",
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width: "26px",
              height: "26px",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#9B7EDB]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
              <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]" />
            </svg>
          </div>
        </NodeResizeControl>

        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
          isConnectable={isConnectable} position={Position.Top} />
        <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Right} />
        <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable} position={Position.Bottom} />
        <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Left} />
        <Handle
          id={`${id}-a`}
          type="target"
          position={Position.Top}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            // border: isActivated ? "1px solid #4599DF" : "none",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
            // maybe consider about using stored isActivated
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-b`}
          type="target"
          position={Position.Right}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            // border: isActivated ? "1px solid #4599DF" : "none",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
            // maybe consider about using stored isActivated
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-c`}
          type="target"
          position={Position.Bottom}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            // border: isActivated ? "1px solid #4599DF" : "none",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
            // maybe consider about using stored isActivated
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
        <Handle
          id={`${id}-d`}
          type="target"
          position={Position.Left}
          style={{
            position: "absolute",
            width: "calc(100%)",
            height: "calc(100%)",
            top: "0",
            left: "0",
            borderRadius: "0",
            transform: "translate(0px, 0px)",
            background: "transparent",
            // border: isActivated ? "1px solid #4599DF" : "none",
            border: "3px solid transparent",
            zIndex: !isOnConnect ? "-1" : "1",
            // maybe consider about using stored isActivated
          }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />


      </div>

      {/* Add the source/target nodes display at the bottom of the component */}

      {/*
      <div className="absolute left-0 -bottom-[2px] transform translate-y-full w-full flex gap-2 z-10">
        {sourceNodes.length > 0 && (
          <div className="w-[48%] bg-[#101010] rounded-lg border border-[#333333] p-1.5 shadow-lg">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Source Nodes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {displaySourceNodeLabels()}
            </div>
          </div>
        )}
        {targetNodes.length > 0 && (
          <div className="w-[48%] ml-auto bg-[#101010] rounded-lg border border-[#333333] p-1.5 shadow-lg">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Target Nodes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {displayTargetNodeLabels()}
            </div>
          </div>
        )}
      </div>
      */}

    </div >

  )
}

export default JsonBlockNode