import { Handle, Position, NodeProps, Node, useReactFlow } from "@xyflow/react";
import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useNodesPerFlowContext } from "../../../states/NodesPerFlowContext";
import InputOutputDisplay from "./components/InputOutputDisplay";
import { UI_COLORS } from "@/app/utils/colors";
import useGetSourceTarget from "@/app/components/hooks/useGetSourceTarget";
import useJsonConstructUtils from "@/app/components/hooks/useJsonConstructUtils";
import { useAppSettings } from "@/app/components/states/AppSettingsContext";
import {
  runSingleEdgeNode,
  RunSingleEdgeNodeContext,
} from "./hook/runSingleEdgeNodeExecutor";

// 前端节点配置数据（原 ModifyConfigNodeData）
export type CopyNodeFrontendConfig = {
  subMenuType: string | null;
  content: string | null;
  looped: boolean | undefined;
  content_type: "list" | "dict" | null;
  extra_configs: {
    index: number | undefined;
    key: string | undefined;
    params: {
      path: (string | number)[];
    };
  };
};

// 后端 API 请求数据（原 ModifyCopyEdgeJsonType）
export type CopyOperationApiPayload = {
  type: "modify";
  data: {
    modify_type: "deep_copy" | "copy";
    content: string;
    extra_configs: {};
    inputs: { [key: string]: string };
    outputs: { [key: string]: string };
  };
};

type ModifyConfigNodeProps = NodeProps<Node<CopyNodeFrontendConfig>>;

const CopyEdgeNode: React.FC<ModifyConfigNodeProps> = React.memo(
  ({ data: { subMenuType }, isConnectable, id }) => {
    const {
      isOnConnect,
      activatedEdge,
      isOnGeneratingNewNode,
      clearEdgeActivation,
      activateEdge,
      clearAll,
    } = useNodesPerFlowContext();

    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false);
    const { getNode, getInternalNode, setNodes, setEdges } = useReactFlow();
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [isRunButtonHovered, setIsRunButtonHovered] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const menuRef = useRef<HTMLUListElement>(null);
    const { getSourceNodeIdWithLabel, getTargetNodeIdWithLabel } =
      useGetSourceTarget();

    // 使用 useRef 跟踪是否已挂载
    const hasMountedRef = useRef(false);

    // 获取所有需要的依赖
    const { streamResult, reportError, resetLoadingUI } =
      useJsonConstructUtils();
    const { getAuthHeaders } = useAppSettings();

    // 创建执行上下文 - 使用 useCallback 缓存
    const createExecutionContext = useCallback(
      (): RunSingleEdgeNodeContext => ({
        getNode,
        setNodes,
        setEdges,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        streamResult,
        reportError,
        resetLoadingUI,
        getAuthHeaders,
      }),
      [
        getNode,
        setNodes,
        setEdges,
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel,
        clearAll,
        streamResult,
        reportError,
        resetLoadingUI,
        getAuthHeaders,
      ]
    );

    // 使用执行函数的 handleDataSubmit - 使用 useCallback 缓存
    const handleDataSubmit = useCallback(async () => {
      if (isLoading) return;

      setIsLoading(true);
      try {
        const context = createExecutionContext();
        await runSingleEdgeNode({
          parentId: id,
          targetNodeType: "text",
          context,
          // 可以选择不提供 constructJsonData，使用默认实现
        });
      } catch (error) {
        console.error("执行失败:", error);
      } finally {
        setIsLoading(false);
      }
    }, [id, isLoading, createExecutionContext]);

    // 停止执行函数 - 使用 useCallback 缓存
    const onStopExecution = useCallback(() => {
      console.log("Stop execution");
      setIsLoading(false);
      // 暂时可以留空，或者调用相应的停止API
    }, []);

    // UI 交互函数 - 使用 useCallback 缓存
    const onClickButton = useCallback(() => {
      setIsMenuOpen(!isMenuOpen);

      if (isOnGeneratingNewNode) return;
      if (activatedEdge === id) {
        clearEdgeActivation();
      } else {
        clearAll();
        activateEdge(id);
      }
    }, [
      isMenuOpen,
      isOnGeneratingNewNode,
      activatedEdge,
      id,
      clearEdgeActivation,
      clearAll,
      activateEdge,
    ]);

    // 初始化和清理 - 优化初始化逻辑
    useEffect(() => {
      // 只有在非生成新节点状态时才进行初始化
      if (!isOnGeneratingNewNode && !hasMountedRef.current) {
        hasMountedRef.current = true;

        console.log(getInternalNode(id));

        // 延迟初始化，避免在节点创建过程中干扰状态
        requestAnimationFrame(() => {
          clearAll();
          activateEdge(id);
        });
      }

      return () => {
        if (activatedEdge === id) {
          clearEdgeActivation();
        }
      };
    }, [isOnGeneratingNewNode]); // 添加 isOnGeneratingNewNode 作为依赖

    // 在组件顶部定义共享样式 - 使用 useMemo 缓存
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
        zIndex: !isOnConnect ? "-1" : "1",
      }),
      [isOnConnect]
    );

    // 缓存按钮样式 - 使用 useMemo 缓存
    const runButtonStyle = useMemo(
      () => ({
        backgroundColor: isRunButtonHovered
          ? isLoading
            ? "#FFA73D"
            : "#39BC66"
          : "#181818",
        borderColor: isRunButtonHovered
          ? isLoading
            ? "#FFA73D"
            : "#39BC66"
          : UI_COLORS.EDGENODE_BORDER_GREY,
        color: isRunButtonHovered ? "#000" : UI_COLORS.EDGENODE_BORDER_GREY,
      }),
      [isRunButtonHovered, isLoading]
    );

    const mainButtonStyle = useMemo(
      () => ({
        borderColor: isLoading
          ? "#FFA73D"
          : isHovered
          ? UI_COLORS.LINE_ACTIVE
          : UI_COLORS.EDGENODE_BORDER_GREY,
        color: isLoading
          ? "#FFA73D"
          : isHovered
          ? UI_COLORS.LINE_ACTIVE
          : UI_COLORS.EDGENODE_BORDER_GREY,
      }),
      [isLoading, isHovered]
    );

    // 缓存 SVG 组件 - 使用 useMemo 缓存
    const copyIcon = useMemo(
      () => (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M8 1H2C1.45 1 1 1.45 1 2V8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <rect
            x="4"
            y="4"
            width="7"
            height="7"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      ),
      []
    );

    const playIcon = useMemo(
      () => (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="6"
          height="8"
          viewBox="0 0 8 10"
          fill="none"
        >
          <path d="M8 5L0 10V0L8 5Z" fill="currentColor" />
        </svg>
      ),
      []
    );

    const stopIcon = useMemo(
      () => (
        <svg width="6" height="6" viewBox="0 0 6 6" fill="none">
          <rect width="6" height="6" fill="currentColor" />
        </svg>
      ),
      []
    );

    const loadingSpinner = useMemo(
      () => (
        <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      ),
      []
    );

    const menuLoadingSpinner = useMemo(
      () => (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 714 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      ),
      []
    );

    const menuPlayIcon = useMemo(
      () => (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="8"
          height="10"
          viewBox="0 0 8 10"
          fill="none"
        >
          <path d="M8 5L0 10V0L8 5Z" fill="black" />
        </svg>
      ),
      []
    );

    const menuCopyIcon = useMemo(
      () => (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M8 1H2C1.45 1 1 1.45 1 2V8"
            stroke="#CDCDCD"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <rect
            x="4"
            y="4"
            width="7"
            height="7"
            rx="1"
            stroke="#CDCDCD"
            strokeWidth="1.5"
          />
        </svg>
      ),
      []
    );

    return (
      <div className="p-[3px] w-[80px] h-[48px] relative">
        {/* Invisible hover area between node and run button */}
        <div
          className="absolute -top-[40px] left-0 w-full h-[40px]"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        />

        {/* Run button positioned above the node - show when node or run button is hovered */}
        <button
          className={`absolute -top-[40px] left-1/2 transform -translate-x-1/2 w-[57px] h-[24px] rounded-[6px] border-[1px] text-[10px] font-[600] font-plus-jakarta-sans flex flex-row items-center justify-center gap-[4px] transition-all duration-200 ${
            isHovered || isRunButtonHovered ? "opacity-100" : "opacity-0"
          }`}
          style={runButtonStyle}
          onClick={isLoading ? onStopExecution : handleDataSubmit}
          disabled={false}
          onMouseEnter={() => setIsRunButtonHovered(true)}
          onMouseLeave={() => setIsRunButtonHovered(false)}
        >
          <span>{isLoading ? stopIcon : playIcon}</span>
          <span>{isLoading ? "Stop" : "Run"}</span>
        </button>

        {/* Main node button */}
        <button
          onClick={onClickButton}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] bg-[#181818] flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[600] edge-node transition-colors gap-[4px]`}
          style={mainButtonStyle}
          title="Copy Node"
        >
          {/* Copy SVG icon */}
          {copyIcon}
          Copy
          {/* Source handles */}
          <Handle
            id={`${id}-a`}
            className="edgeSrcHandle handle-with-icon handle-top"
            type="source"
            position={Position.Top}
          />
          <Handle
            id={`${id}-b`}
            className="edgeSrcHandle handle-with-icon handle-right"
            type="source"
            position={Position.Right}
          />
          <Handle
            id={`${id}-c`}
            className="edgeSrcHandle handle-with-icon handle-bottom"
            type="source"
            position={Position.Bottom}
          />
          <Handle
            id={`${id}-d`}
            className="edgeSrcHandle handle-with-icon handle-left"
            type="source"
            position={Position.Left}
          />
          {/* Target handles */}
          <Handle
            id={`${id}-a`}
            type="target"
            position={Position.Top}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
          <Handle
            id={`${id}-b`}
            type="target"
            position={Position.Right}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
          <Handle
            id={`${id}-c`}
            type="target"
            position={Position.Bottom}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
          <Handle
            id={`${id}-d`}
            type="target"
            position={Position.Left}
            style={handleStyle}
            isConnectable={isConnectable}
            onMouseEnter={() => setIsTargetHandleTouched(true)}
            onMouseLeave={() => setIsTargetHandleTouched(false)}
          />
        </button>

        {/* Configuration Menu (integrated directly) */}
        {isMenuOpen && (
          <ul
            ref={menuRef}
            className="absolute top-[64px] text-white w-[320px] rounded-[16px] border-[1px] bg-[#1A1A1A] p-[12px] font-plus-jakarta-sans flex flex-col gap-[16px] border-box shadow-lg"
            style={{
              borderColor: UI_COLORS.EDGENODE_BORDER_GREY,
            }}
          >
            {/* Title and Run button section */}
            <li className="flex h-[28px] gap-1 items-center justify-between font-plus-jakarta-sans">
              <div className="flex flex-row gap-[12px]">
                <div className="flex flex-row gap-[8px] justify-center items-center">
                  <div className="w-[24px] h-[24px] border-[1px] border-main-grey bg-main-black-theme rounded-[8px] flex items-center justify-center">
                    {menuCopyIcon}
                  </div>
                  <div className="flex items-center justify-center text-[14px] font-semibold text-main-grey font-plus-jakarta-sans leading-normal">
                    Copy
                  </div>
                </div>
              </div>
              <div className="w-[57px] h-[26px]">
                <button
                  className="w-full h-full rounded-[8px] text-[#000] text-[12px] font-semibold font-plus-jakarta-sans flex flex-row items-center justify-center gap-[7px]"
                  style={{
                    backgroundColor: isLoading ? "#FFA73D" : "#39BC66",
                  }}
                  onClick={isLoading ? onStopExecution : handleDataSubmit}
                  disabled={false}
                >
                  <span>{isLoading ? menuLoadingSpinner : menuPlayIcon}</span>
                  <span>{isLoading ? "Stop" : "Run"}</span>
                </button>
              </div>
            </li>

            {/* Input/Output display */}
            <li>
              <InputOutputDisplay
                parentId={id}
                getNode={getNode}
                getSourceNodeIdWithLabel={getSourceNodeIdWithLabel}
                getTargetNodeIdWithLabel={getTargetNodeIdWithLabel}
                supportedInputTypes={["text", "structured"]}
                supportedOutputTypes={["text", "structured"]}
                inputNodeCategory="blocknode"
                outputNodeCategory="blocknode"
              />
            </li>
          </ul>
        )}
      </div>
    );
  }
);

CopyEdgeNode.displayName = "CopyEdgeNode";
export default CopyEdgeNode;