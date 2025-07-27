"use client";
import {
  NodeProps,
  Node,
  Handle,
  Position,
  useReactFlow,
  NodeResizeControl,
} from "@xyflow/react";
import React, { useRef, useEffect, useState, useCallback } from "react";
import WhiteBallHandle from "../handles/WhiteBallHandle";
import NodeToolBar from "./nodeTopRightBar/NodeTopRightBar";
import TextEditor from "../../tableComponent/TextEditor";
import TextEditorTextArea from "../../tableComponent/TextEditorTextArea";
import useManageReactFlowUtils from "../../hooks/useManageReactFlowUtils";
import SkeletonLoadingIcon from "../../loadingIcon/SkeletonLoadingIcon";
import dynamic from "next/dynamic";
import { useNodesPerFlowContext } from "../../states/NodesPerFlowContext";
import useGetSourceTarget from "../../hooks/useGetSourceTarget";
export type TextBlockNodeData = {
  content: string;
  label: string;
  isLoading: boolean;
  isWaitingForFlow: boolean;
  locked: boolean;
  isInput: boolean;
  isOutput: boolean;
  editable: boolean;
  inputEdgeNodeID: string[];
  outputEdgeNodeID: string[];
};

type TextBlockNodeProps = NodeProps<Node<TextBlockNodeData>>;

const TextEditorBlockNote = dynamic(
  () => import("../../tableComponent/TextEditorBlockNote"),
  { ssr: false }
);

function TextBlockNode({
  isConnectable,
  id,
  type,
  data: {
    content,
    label,
    isLoading,
    isWaitingForFlow,
    locked,
    inputEdgeNodeID,
    outputEdgeNodeID,
    editable,
    isInput,
    isOutput,
  },
}: TextBlockNodeProps) {
  // const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode, preventInactivateNode, allowInactivateNode, disallowEditLabel} = useNodeContext()
  const { getNode, setNodes } = useReactFlow();
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
    manageNodeasLocked,
    activateNode,
    inactivateNode,
  } = useNodesPerFlowContext();
  const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
    useGetSourceTarget();
  // const [isActivated, setIsActivated] = useState(false)
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false);
  const componentRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // 移除 contentSize 状态
  // const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  // const [self, setSelf] = useState<nodeState | null>(searchNode(id))
  const labelRef = useRef<HTMLInputElement | null>(null); // 管理label input field 的宽度
  const labelContainerRef = useRef<HTMLDivElement | null>(null); // 管理labelContainer的宽度 = possible width of label input field + left logo svg
  const [nodeLabel, setNodeLabel] = useState(label ?? id);
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel
  const measureSpanRef = useRef<HTMLSpanElement | null>(null); // 用于测量 labelContainer 的宽度
  const [isHovered, setIsHovered] = useState(false); // 添加 hover 状态

  // Get connected nodes
  const sourceNodes = getSourceNodeIdWithLabel(id);
  const targetNodes = getTargetNodeIdWithLabel(id);

  // 使用已从 ReactFlow 加载的 isInput, isOutput 状态
  // 不再使用动态计算的方式：
  // const isInput = sourceNodes.length === 0 && targetNodes.length > 0
  // const isOutput = targetNodes.length === 0 && sourceNodes.length > 0

  // 监听连接变化，自动设置节点状态
  useEffect(() => {
    const isAutoDetectInput =
      sourceNodes.length === 0 && targetNodes.length > 0;
    const isAutoDetectOutput =
      targetNodes.length === 0 && sourceNodes.length > 0;

    // 仅当当前状态与自动检测不一致时更新状态
    if (isAutoDetectInput && !isInput) {
      manageNodeasInput(id);
    } else if (isAutoDetectOutput && !isOutput) {
      manageNodeasOutput(id);
    } else if (
      !isAutoDetectInput &&
      !isAutoDetectOutput &&
      (isInput || isOutput)
    ) {
      // 如果既不是输入也不是输出，但当前有一个标记，则移除标记
      if (isInput) manageNodeasInput(id);
      if (isOutput) manageNodeasOutput(id);
    }
  }, [sourceNodes.length, targetNodes.length, isInput, isOutput, id]);

  const displaySourceNodeLabels = () => {
    const sourceNodeIdWithLabelGroup = getSourceNodeIdWithLabel(id);
    return sourceNodeIdWithLabelGroup.map(
      (node: { id: string; label: string }) => {
        // Get the node type from the node data
        const nodeInfo = getNode(node.id);
        const nodeType = nodeInfo?.type || "text"; // Default to text if type not found

        // Simplified version - using basic styling
        return (
          <button
            key={`${node.id}-${id}`}
            onClick={() => {
              // Simple copy to clipboard functionality
              navigator.clipboard.writeText(`{{${node.label}}}`);
            }}
            className="flex items-center gap-2 px-2 py-1 rounded 
                         border border-gray-400 text-xs bg-gray-800 text-gray-200
                         hover:bg-gray-700 transition-colors"
          >
            {/* Simple text indicator of node type */}
            <span className="text-xs">{nodeType}</span>

            <span className="truncate max-w-[100px]">
              {`{{${node.label}}}`}
            </span>
          </button>
        );
      }
    );
  };

  const displayTargetNodeLabels = () => {
    const targetNodeIdWithLabelGroup = getTargetNodeIdWithLabel(id);
    return targetNodeIdWithLabelGroup.map(
      (node: { id: string; label: string }) => {
        // Get the node type from the node data
        const nodeInfo = getNode(node.id);
        const nodeType = nodeInfo?.type || "text"; // Default to text if type not found

        // Simplified version - using basic styling
        return (
          <button
            key={`${node.id}-${id}`}
            onClick={() => {
              // Simple copy to clipboard functionality
              navigator.clipboard.writeText(`{{${node.label}}}`);
            }}
            className="flex items-center gap-2 px-2 py-1 rounded 
                       border border-gray-400 text-xs bg-gray-800 text-gray-200
                       hover:bg-gray-700 transition-colors"
          >
            {/* Simple text indicator of node type */}
            <span className="text-xs">{nodeType}</span>

            <span className="truncate max-w-[100px]">
              {`{{${node.label}}}`}
            </span>
          </button>
        );
      }
    );
  };

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
  }, [id]); // 添加 id 作为依赖

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
    const currentLabel = getNode(id)?.data?.label as string | undefined;
    if (
      currentLabel !== undefined &&
      currentLabel !== nodeLabel &&
      !isLocalEdit
    ) {
      setNodeLabel(currentLabel);
      if (measureSpanRef.current) {
        measureSpanRef.current.textContent = currentLabel;
      }
    }
  }, [label, id, isLocalEdit]);

  const onFocus: () => void = () => {
    preventInactivateNode();
    const curRef = componentRef.current;
    if (curRef && !curRef.classList.contains("nodrag")) {
      curRef.classList.add("nodrag");
    }
  };

  const onBlur: () => void = () => {
    allowInactivateNodeWhenClickOutside();
    const curRef = componentRef.current;
    if (curRef) {
      curRef.classList.remove("nodrag");
    }
    if (isLocalEdit) {
      //  管理 node label onchange，只有 onBlur 的时候，才会更新 label
      // setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
      editNodeLabel(id, nodeLabel);
      setIsLocalEdit(false);
    }
  };

  const preventNodeDrag = () => {
    const curRef = componentRef.current;
    if (curRef && !curRef.classList.contains("nodrag")) {
      curRef.classList.add("nodrag");
    }
  };

  const allowNodeDrag = () => {
    const curRef = componentRef.current;
    if (curRef) {
      curRef.classList.remove("nodrag");
    }
  };

  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    // Always return the text icon regardless of isInput, isOutput, or locked
    return (
      <svg
        width="20"
        height="24"
        viewBox="0 0 20 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="group"
      >
        <path
          d="M3 8H17"
          className="stroke-[#A4C8F0] group-active:stroke-[#4599DF]"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M3 12H15"
          className="stroke-[#A4C8F0] group-active:stroke-[#4599DF]"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M3 16H13"
          className="stroke-[#A4C8F0] group-active:stroke-[#4599DF]"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  };

  // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
  const calculateMaxLabelContainerWidth = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth - 48}px`;
    }
    return "100%";
  };

  // 添加切换节点状态的功能
  const toggleNodeInput = () => {
    manageNodeasInput(id);
  };

  const toggleNodeOutput = () => {
    manageNodeasOutput(id);
  };

  const toggleNodeLocked = () => {
    manageNodeasLocked(id);
  };

  // 添加 updateNodeContent 函数
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

  // 添加一个纯函数来计算边框颜色
  const getBorderColor = () => {
    if (isLoading) return "border-[#FFA500]";
    if (isWaitingForFlow) return "border-[#39bc66]";
    if (activatedNode?.id === id) return "border-main-blue";
    if (isHovered) return "border-main-blue";
    return isOnConnect && isTargetHandleTouched
      ? "border-main-orange"
      : "border-main-deep-grey";
  };

  return (
    <div
      ref={componentRef}
      className={`relative w-full h-full min-w-[240px] min-h-[176px] ${
        isOnGeneratingNewNode ? "cursor-crosshair" : "cursor-default"
      }`}
      onMouseEnter={() => {
        setIsHovered(true);
        activateNode(id);
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
    >
      {/* Add tags for input, output and locked states */}
      <div className="absolute -top-[28px] h-[24px]  left-0 z-10 flex gap-1.5">
        {isInput && (
          <div
            className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#84EB89] text-black cursor-pointer"
            onClick={toggleNodeInput}
          >
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
          <div
            className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#FF9267] text-black cursor-pointer"
            onClick={toggleNodeOutput}
          >
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
          <div
            className="px-2 py-0.5 rounded-[8px] flex items-center gap-1 text-[10px] font-bold bg-[#3EDBC9] text-black cursor-pointer"
            onClick={toggleNodeLocked}
          >
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

      <div
        ref={contentRef}
        id={id}
        className={`w-full h-full border-[1.5px] min-w-[240px] min-h-[176px] rounded-[16px] px-[8px] pt-[8px] pb-[4px] ${getBorderColor()} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden flex flex-col text-block-node`}
      >
        {/* the top bar of a block */}
        <div
          ref={labelContainerRef}
          className={`h-[24px] w-full rounded-[4px]  flex items-center justify-between mb-2`}
        >
          {/* top-left wrapper */}
          <div
            className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
            style={{
              maxWidth: calculateMaxLabelContainerWidth(),
            }}
          >
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#4599DF]">
              {renderTagLogo()}
            </div>

            {/* measure label width span */}
            <span
              ref={measureSpanRef}
              style={{
                visibility: "hidden",
                position: "absolute",
                whiteSpace: "pre",
                fontSize: "12px",
                lineHeight: "18px",
                fontWeight: "700",
                fontFamily: "Plus Jakarta Sans",
              }}
            >
              {nodeLabel}
            </span>

            {editable ? (
              <input
                ref={labelRef}
                autoFocus={editable}
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate w-full text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]
                `}
                value={nodeLabel}
                readOnly={!editable}
                onChange={(e) => {
                  setIsLocalEdit(true);
                  setNodeLabel(e.target.value);
                }}
                onMouseDownCapture={onFocus}
                onBlur={onBlur}
              />
            ) : (
              <span
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate w-fit
                  text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]
                `}
              >
                {nodeLabel}
              </span>
            )}
          </div>

          {/* top-right toolbar */}
          <div className="min-w-[24px] min-h-[24px] flex items-center justify-center">
            <NodeToolBar Parentnodeid={id} ParentNodetype={type} />
          </div>
        </div>

        {/* the plain text editor */}
        <div className="pl-[8px] flex-1 relative">
          {isLoading ? (
            <SkeletonLoadingIcon />
          ) : (
            <TextEditor
              preventParentDrag={preventNodeDrag}
              allowParentDrag={allowNodeDrag}
              widthStyle={0} // 0 表示使用 100%
              heightStyle={0} // 0 表示使用 100%
              placeholder="Text"
              value={content || ""}
              onChange={updateNodeContent}
            />
          )}
        </div>

        {/* <TextEditorTipTap preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='Text' parentId={id} /> */}

        {/* Rich text editor */}
        {/* <TextEditorBlockNote preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='[{"type": "paragraph", "content": "Text"}]' parentId={id} /> */}

        {/* the resizer in the bottom right corner */}
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
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
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
              className="group active:group-[]:fill-[#4599DF]"
            >
              <path
                d="M10 5.99998H12V7.99998H10V5.99998Z"
                className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"
              />
              <path
                d="M10 2H12V4H10V2Z"
                className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"
              />
              <path
                d="M6 5.99998H8V7.99998H6V5.99998Z"
                className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"
              />
              <path
                d="M6 10H8V12H6V10Z"
                className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"
              />
              <path
                d="M2 10H4V12H2V10Z"
                className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"
              />
              <path
                d="M10 10H12V12H10V10Z"
                className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"
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
      {/* the panel of source nodes and target nodes */}
      {/* <div className="absolute left-0 -bottom-[2px] transform translate-y-full w-full flex gap-2 z-10"
        {displaySourceNodeLabels().length > 0 && (
          <div className="w-[48%] bg-[#101010] rounded-lg border border-[#333333] p-1.5 shadow-lg">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Source Nodes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {sourceNodes.map(node => (
                <button
                  key={`${node.id}-${id}-simple`}
                  onClick={() => {
                    navigator.clipboard.writeText(`{{${node.label}}}`);
                  }}
                  className="px-1.5 py-0.5 rounded text-[11px] bg-[#1A1A1A] border border-[#333333] 
                           text-gray-300 hover:bg-[#252525] hover:text-white transition-colors"
                >
                  {node.label}
                </button>
              ))}
            </div>
          </div>
        ))}

        {displayTargetNodeLabels().length > 0 && (
          <div className="w-[48%] ml-auto bg-[#101010] rounded-lg border border-[#333333] p-1.5 shadow-lg">
            <div className="text-xs text-[#A4C8F0] font-semibold pb-1 mb-1">
              Target Nodes
            </div>
            <div className="flex flex-wrap gap-1.5">
              {targetNodes.map(node => (
                <button
                  key={`${node.id}-${id}-simple`}
                  onClick={() => {
                    navigator.clipboard.writeText(`{{${node.label}}}`);
                  }}
                  className="px-1.5 py-0.5 rounded text-[11px] bg-[#1A1A1A] border border-[#333333] 
                           text-gray-300 hover:bg-[#252525] hover:text-white transition-colors"
                >
                  {node.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div> 
      */}
    </div>
  );
}

export default TextBlockNode;
