import { Handle, Position, NodeProps, Node, useOnViewportChange, Viewport} from '@xyflow/react'
// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, {useState, useEffect, useRef} from 'react'
import LLMConfigMenu from '@/app/components/workflow/edgesNode/edgeNodeConfig/LLMConfigMenu'
import { useReactFlow } from '@xyflow/react'
export type LLMConfigNodeData = {
    looped: boolean | undefined,
    content: string | null,
    model: "gpt-4o" | "gpt-4" | "gpt-4o-mini" | undefined,
    structured_output: boolean | undefined,
    base_url: string | undefined,
    resultNode: string | null
}

type LLMConfigNodeProps = NodeProps<Node<LLMConfigNodeData>>

function LLMConfig({isConnectable, id}: LLMConfigNodeProps) {

    // const {isOnConnect, searchNode} = useNodeContext()
    // const [activated, setActivated] = useState(false)
    // const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)

    // const {isOnConnect, activateEdgeNode, activatedEdge, clear} = useNodeContext()
    const {isOnConnect, activatedEdge, clearEdgeActivation, activateEdge, clearAll, isOnGeneratingNewNode} = useNodesPerFlowContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const {getNode} = useReactFlow()

    // 添加组件挂载时自动展开菜单的效果
    useEffect(() => {
        // 组件挂载时自动激活边缘
        if (!isOnGeneratingNewNode) {
            clearAll()
            activateEdge(id)
        }
        
        // 组件卸载时清除激活状态
        return () => {
            if (activatedEdge === id) {
                clearEdgeActivation()
            }
        }
    }, []) // 空依赖数组确保只在挂载时执行一次
   
    const onClickButton = () => {
        if (isOnGeneratingNewNode) return
        if (activatedEdge === id) {
            clearEdgeActivation()
        }
        else {
            clearAll()
            activateEdge(id)
        }
    }


    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
         <button className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`} onClick={onClickButton} >
                LLM
                <Handle id={`${id}-a`} className='edgeSrcHandle handle-with-icon handle-top' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle handle-with-icon handle-right' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle handle-with-icon handle-bottom' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle handle-with-icon handle-left' type='source' position={Position.Left} />
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
        </button>
        <LLMConfigMenu show={activatedEdge === id ? true : false} parentId={id} />
        </div>
        
    )
}

export default LLMConfig