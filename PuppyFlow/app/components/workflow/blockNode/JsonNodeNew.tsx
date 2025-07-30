"use client";
import {
  NodeProps,
  Node,
  Handle,
  Position,
  useReactFlow,
  NodeResizeControl,
} from "@xyflow/react";
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useNodesPerFlowContext } from "../../states/NodesPerFlowContext";
import WhiteBallHandle from "../handles/WhiteBallHandle";
import TreeJSONForm from "../../tableComponent/TreeJSONForm";
import SkeletonLoadingIcon from "../../loadingIcon/SkeletonLoadingIcon";
import useGetSourceTarget from "../../hooks/useGetSourceTarget";
import { useWorkspaceManagement } from "../../hooks/useWorkspaceManagement";
import { useWorkspaces } from "../../states/UserWorkspacesContext";
import TreePathEditor, { PathNode } from "../components/TreePathEditor";
import RichJSONForm from "../../tableComponent/RichJSONForm/RichJSONForm";
import JSONForm from "../../tableComponent/JSONForm";

import IndexingMenu from "./JsonNodeTopSettingBar/NodeIndexingMenu";
import useIndexingUtils from "./hooks/useIndexingUtils";
import NodeSettingsController from "./JsonNodeTopSettingBar/NodeSettingsButton";
import NodeIndexingButton from "./JsonNodeTopSettingBar/NodeIndexingButton";
import NodeLoopButton from "./JsonNodeTopSettingBar/NodeLoopButton";
import NodeViewToggleButton from "./JsonNodeTopSettingBar/NodeViewToggleButton";

type methodNames = "cosine";
type modelNames = "text-embedding-ada-002";
type vdb_typeNames = "pgvector";

type VectorIndexingStatus =
  | "notStarted"
  | "processing"
  | "done"
  | "error"
  | "deleting";

export interface BaseIndexingItem {
  type: string;
}

interface PathSegment {
  id: string;
  type: "key" | "num";
  value: string;
}

export interface VectorIndexingItem extends BaseIndexingItem {
  type: "vector";
  status: VectorIndexingStatus;
  key_path: PathSegment[];
  value_path: PathSegment[];
  chunks: any[];
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
  type: "other";
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
      clearAll,
      manageNodeasInput,
      manageNodeasOutput,
      activateNode,
      inactivateNode,
    } = useNodesPerFlowContext();

    const { setNodes, setEdges, getEdges, getNode } = useReactFlow();

    // 优化点 2: 将多个相关的 state 合并，减少 state 更新的复杂性
    const [nodeState, setNodeState] = useState({
      isTargetHandleTouched: false,
      nodeLabel: label ?? id,
      isLocalEdit: false,
      isEditing: false,
      isHovered: false,
      showSettingMenu: false,
      useRichEditor: false,
      userInput: "input view" as string | undefined,
    });

    const [vectorIndexingStatus, setVectorIndexingStatus] =
      useState<VectorIndexingStatus>("notStarted");

    // 使用 refs 来引用 DOM 元素，避免因引用变化导致重渲染
    const componentRef = useRef<HTMLDivElement | null>(null);
    const contentRef = useRef<HTMLDivElement | null>(null);
    const labelContainerRef = useRef<HTMLDivElement | null>(null);
    const labelRef = useRef<HTMLInputElement | null>(null);

    // 优化点 3: 使用 ref 标记初始渲染，用于延迟计算
    const hasMountedRef = useRef(false);

    // Get connected nodes
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();
    const sourceNodes = getSourceNodeIdWithLabel(id);
    const targetNodes = getTargetNodeIdWithLabel(id);

    // 优化点 4: 使用 useMemo 缓存边框颜色的计算逻辑
    const borderColor = useMemo(() => {
      if (isLoading) return "border-[#FFA500]";
      if (isWaitingForFlow) return "border-[#39bc66]";
      if (activatedNode?.id === id) return "border-[#9B7EDB]";
      if (nodeState.isHovered) return "border-[#9B7EDB]";
      return isOnConnect && nodeState.isTargetHandleTouched
        ? "border-main-orange"
        : "border-main-deep-grey";
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

    // 优化点 5: 使用 useMemo 缓存 Handle 的样式对象，避免内联样式导致重渲染
    const handleStyle = useMemo(
      () => ({
        position: "absolute" as const,
        width: "calc(100%)",
        height: "calc(100%)",
        top: "0",
        left: "0",
        borderRadius: "0",
        transform: "translate(0px, 0px)",
        background: "transparent",
        border: "3px solid transparent",
        zIndex: !isOnConnect ? -1 : 1,
      }),
      [isOnConnect]
    );

    // 优化点 6: 使用 useCallback 缓存所有事件处理函数
    const handleMouseEnter = useCallback(() => {
      setNodeState((prev) => ({ ...prev, isHovered: true }));
      activateNode(id);
    }, [activateNode, id]);

    const handleMouseLeave = useCallback(() => {
      setNodeState((prev) => ({ ...prev, isHovered: false }));
    }, []);

    const handleTargetHandleMouseEnter = useCallback(() => {
      setNodeState((prev) => ({ ...prev, isTargetHandleTouched: true }));
    }, []);

    const handleTargetHandleMouseLeave = useCallback(() => {
      setNodeState((prev) => ({ ...prev, isTargetHandleTouched: false }));
    }, []);

    const onFocus = useCallback(() => {
      preventInactivateNode();
      const curRef = componentRef.current;
      if (curRef && !curRef.classList.contains("nodrag")) {
        curRef.classList.add("nodrag");
      }
    }, [preventInactivateNode]);

    const onBlur = useCallback(() => {
      allowInactivateNodeWhenClickOutside();
      const curRef = componentRef.current;
      if (curRef) {
        curRef.classList.remove("nodrag");
      }
      if (nodeState.isLocalEdit) {
        editNodeLabel(id, nodeState.nodeLabel);
        setNodeState((prev) => ({ ...prev, isLocalEdit: false }));
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
        setNodeState((prev) => ({
          ...prev,
          isLocalEdit: true,
          nodeLabel: e.target.value,
        }));
      },
      []
    );

    const handleLabelFocus = useCallback(() => {
      setNodeState((prev) => ({ ...prev, isEditing: true }));
      onFocus();
    }, [onFocus]);

    const handleLabelBlur = useCallback(() => {
      setNodeState((prev) => ({ ...prev, isEditing: false }));
      if (nodeState.isLocalEdit) {
        editNodeLabel(id, nodeState.nodeLabel);
        setNodeState((prev) => ({ ...prev, isLocalEdit: false }));
      }
      onBlur();
    }, [editNodeLabel, id, nodeState.isLocalEdit, nodeState.nodeLabel, onBlur]);

    const calculateMaxLabelContainerWidth = useCallback(() => {
      if (contentRef.current) {
        return `${contentRef.current.clientWidth - 32}px`;
      }
      return "100%";
    }, []);

    // 优化点 6: 使用 useCallback 缓存 JSON 内容同步函数
    const updateNodeContent = useCallback(
      (newValue: string) => {
        setNodes((prevNodes) =>
          prevNodes.map((node) =>
            node.id === id
              ? {
                  ...node,
                  data: { ...node.data, content: newValue },
                }
              : node
          )
        );
      },
      [id, setNodes]
    );

    // for rendering diffent logo of upper right tag
    const renderTagLogo = useCallback(() => {
      return (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="group"
        >
          <path
            d="M8 6.5V5H4V7.5V16.5V19H8V17.5H5.5V6.5H8Z"
            className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]"
          />
          <path
            d="M16 6.5V5H20V7.5V16.5V19H16V17.5H18.5V6.5H16Z"
            className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]"
          />
          <path
            d="M9 9H11V11H9V9Z"
            className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]"
          />
          <path
            d="M9 13H11V15H9V13Z"
            className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]"
          />
          <path
            d="M13 9H15V11H13V9Z"
            className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]"
          />
          <path
            d="M13 13H15V15H13V13Z"
            className="fill-[#B0A4E3] group-active:fill-[#9B7EDB]"
          />
        </svg>
      );
    }, []);

    // Validation function to check if any node has an empty value
    const hasEmptyValues = useCallback((nodes: PathNode[]): boolean => {
      for (const node of nodes) {
        if (node.value.trim() === "") {
          return true;
        }
        if (node.children.length > 0 && hasEmptyValues(node.children)) {
          return true;
        }
      }
      return false;
    }, []);

    const { handleAddIndex, handleRemoveIndex } = useIndexingUtils();

    // 辅助函数：获取用户ID
    const getUserId = useCallback(async (): Promise<string | null> => {
      if (!userId || userId.trim() === "") {
        const res = await fetchUserId();
        if (res) {
          return res;
        } else {
          return null;
        }
      }
      return userId;
    }, [userId, fetchUserId]);

    // 更新的 onRemoveIndex 方法
    const onRemoveIndex = useCallback(
      async (index: number) => {
        const itemToRemove = indexingList[index];

        if (itemToRemove && itemToRemove.type === "vector") {
          const updatedList = [...indexingList];
          (updatedList[index] as VectorIndexingItem).status = "deleting";

          setNodes((nodes) =>
            nodes.map((node) =>
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
            setVectorIndexingStatus
          );

          setNodes((nodes) =>
            nodes.map((node) =>
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
          console.error("Error removing index:", error);

          if (itemToRemove && itemToRemove.type === "vector") {
            const errorList = [...indexingList];
            (errorList[index] as VectorIndexingItem).status = "error";

            setNodes((nodes) =>
              nodes.map((node) =>
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
      [
        indexingList,
        id,
        handleRemoveIndex,
        getUserId,
        setNodes,
        setVectorIndexingStatus,
      ]
    );

    // 修改后的 onAddIndex 方法
    const onAddIndex = useCallback(
      async (newItem: IndexingItem) => {
        if (newItem.type === "vector") {
          const temporaryItem: VectorIndexingItem = {
            ...(newItem as VectorIndexingItem),
            status: "processing",
            chunks: [],
            index_name: "",
            collection_configs: {
              set_name: "",
              model: "text-embedding-ada-002",
              vdb_type: "pgvector",
              user_id: "",
              collection_name: "",
            },
          };

          const tempIndexingList = [...indexingList, temporaryItem];

          setNodes((nodes) =>
            nodes.map((node) =>
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
            setVectorIndexingStatus,
            getUserId
          );

          if (finalIndexingList) {
            const updatedListWithStatus = [...finalIndexingList];
            const lastIndex = updatedListWithStatus.length - 1;

            if (
              lastIndex >= 0 &&
              updatedListWithStatus[lastIndex].type === "vector"
            ) {
              (updatedListWithStatus[lastIndex] as VectorIndexingItem).status =
                "done";
            }

            setNodes((nodes) =>
              nodes.map((node) =>
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
              errorIndexingList[errorItemIndex].type === "vector"
            ) {
              (errorIndexingList[errorItemIndex] as VectorIndexingItem).status =
                "error";

              setNodes((nodes) =>
                nodes.map((node) =>
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
            setVectorIndexingStatus,
            getUserId
          );

          if (newIndexingList) {
            setNodes((nodes) =>
              nodes.map((node) =>
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
      [
        indexingList,
        id,
        handleAddIndex,
        setVectorIndexingStatus,
        getUserId,
        setNodes,
      ]
    );

    // 优化点 3: 延迟初始渲染时的副作用
    useEffect(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
    }, []);

    // 添加自动检测和同步状态的 useEffect
    useEffect(() => {
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
    }, [
      sourceNodes.length,
      targetNodes.length,
      isInput,
      isOutput,
      id,
      manageNodeasInput,
      manageNodeasOutput,
    ]);

    // 管理labelContainer的宽度
    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          !labelContainerRef.current?.contains(e.target as HTMLElement) &&
          !(e.target as HTMLElement).classList.contains("renameButton")
        ) {
          setNodeUneditable(id);
        }
      };

      document.addEventListener("click", handleClickOutside);
      return () => {
        document.removeEventListener("click", handleClickOutside);
      };
    }, [id, setNodeUneditable]);

    // 自动聚焦，同时需要让cursor focus 到input 的最后一位
    useEffect(() => {
      if (editable && labelRef.current) {
        labelRef.current?.focus();
        const length = labelRef.current.value.length;
        labelRef.current.setSelectionRange(length, length);
      }
    }, [editable, id]);

    // 管理 label onchange
    useEffect(() => {
      const currentLabel = getNode(id)?.data?.label as string | undefined;
      if (
        currentLabel !== undefined &&
        currentLabel !== nodeState.nodeLabel &&
        !nodeState.isLocalEdit
      ) {
        setNodeState((prev) => ({ ...prev, nodeLabel: currentLabel }));
      }
    }, [label, id, nodeState.isLocalEdit, nodeState.nodeLabel, getNode]);

    // 添加点击外部关闭菜单的逻辑
    useEffect(() => {
      if (!nodeState.showSettingMenu) return;

      const handleClickOutside = (e: MouseEvent) => {
        const targetElement = e.target as HTMLElement;
        if (
          nodeState.showSettingMenu &&
          !targetElement.closest(".indexing-menu-container")
        ) {
          setNodeState((prev) => ({ ...prev, showSettingMenu: false }));
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, [nodeState.showSettingMenu]);

    return (
      <div
        ref={componentRef}
        className={`relative w-full h-full min-w-[240px] min-h-[176px] ${
          isOnGeneratingNewNode ? "cursor-crosshair" : "cursor-default"
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Add tags for input, output and locked states */}
        <div className="absolute -top-[28px] h-[24px] left-0 z-10 flex gap-1.5">
          {isInput && (
            <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black">
              <svg
                width="16"
                height="16"
                viewBox="0 0 26 26"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="16"
                  y="7"
                  width="3"
                  height="12"
                  rx="1"
                  fill="currentColor"
                />
                <path
                  d="M5 13H14"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M10 9L14 13L10 17"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>INPUT</span>
            </div>
          )}

          {isOutput && (
            <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#FF9267] text-black">
              <svg
                width="16"
                height="16"
                viewBox="0 0 26 26"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="7"
                  y="7"
                  width="3"
                  height="12"
                  rx="1"
                  fill="currentColor"
                />
                <path
                  d="M12 13H21"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <path
                  d="M17 9L21 13L17 17"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>OUTPUT</span>
            </div>
          )}

          {locked && (
            <div className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="4"
                  y="7"
                  width="8"
                  height="6"
                  rx="1"
                  fill="currentColor"
                />
              </svg>
              <span>LOCKED</span>
            </div>
          )}
        </div>

        <div ref={contentRef} id={id} className={containerClassName}>
          {/* the top bar of a block */}
          <div
            ref={labelContainerRef}
            className={`h-[24px] w-full max-w-full rounded-[4px] flex items-center justify-between mb-2`}
          >
            {/* top-left wrapper */}
            <div
              className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
              style={{
                maxWidth: `calc(${calculateMaxLabelContainerWidth()} - 44px)`,
              }}
            >
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
            <div className="min-w-[60px] min-h-[24px] z-[100000] flex items-center justify-end gap-[8px]">
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

          {/* JSON Editor */}
          {isLoading ? (
            <SkeletonLoadingIcon />
          ) : (
            <div
              className={`flex-1 min-h-0 overflow-hidden`}
              style={{
                background: "transparent",
                boxShadow: "none",
              }}
            >
              {nodeState.useRichEditor ? (
                <RichJSONForm
                  preventParentDrag={onFocus}
                  allowParentDrag={onBlur}
                  placeholder="Create your JSON structure..."
                  value={content || ""}
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
                  value={content || ""}
                  onChange={updateNodeContent}
                  widthStyle={0}
                  heightStyle={0}
                  readonly={locked}
                />
              )}
            </div>
          )}

          <NodeResizeControl
            minWidth={240}
            minHeight={176}
            style={{
              position: "absolute",
              right: "0px",
              bottom: "0px",
              cursor: "se-resize",
              background: "transparent",
              border: "none",
            }}
          >
            <div
              style={{
                position: "absolute",
                visibility: `${
                  activatedNode?.id === id ? "visible" : "hidden"
                }`,
                right: "0px",
                bottom: "0px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: "transparent",
                zIndex: "200000",
                width: "26px",
                height: "26px",
              }}
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 26 26"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="group active:group-[]:fill-[#9B7EDB]"
              >
                <path
                  d="M10 5.99998H12V7.99998H10V5.99998Z"
                  className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]"
                />
                <path
                  d="M10 2H12V4H10V2Z"
                  className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]"
                />
                <path
                  d="M6 5.99998H8V7.99998H6V5.99998Z"
                  className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]"
                />
                <path
                  d="M6 10H8V12H6V10Z"
                  className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]"
                />
                <path
                  d="M2 10H4V12H2V10Z"
                  className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]"
                />
                <path
                  d="M10 10H12V12H10V10Z"
                  className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#9B7EDB]"
                />
              </svg>
            </div>
          </NodeResizeControl>

          <WhiteBallHandle
            id={`${id}-a`}
            type="source"
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Top}
          />
          <WhiteBallHandle
            id={`${id}-b`}
            type="source"
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}
          />
          <WhiteBallHandle
            id={`${id}-c`}
            type="source"
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Bottom}
          />
          <WhiteBallHandle
            id={`${id}-d`}
            type="source"
            sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Left}
          />

          {/* Target Handles - 优化为统一循环处理 */}
          {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(
            (pos, index) => (
              <Handle
                key={pos}
                id={`${id}-${String.fromCharCode(97 + index)}`}
                type="target"
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

// 添加 displayName 用于调试
JsonBlockNode.displayName = "JsonBlockNode";

export default JsonBlockNode;
