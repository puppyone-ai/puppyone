import { Handle, Position, NodeProps, Node, useOnViewportChange, Viewport} from '@xyflow/react'
// import { useNodeContext } from '@/app/components/states/NodeContext'
import { useNodesPerFlowContext } from '@/app/components/states/NodesPerFlowContext'
import React, {useState, useEffect, useRef} from 'react'
import LLMConfigMenu from '@/app/components/menu/configMenu/LLMConfigMenu'
import { nodeSmallProps } from '@/app/components/menu/nodeMenu/NodeMenu'
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

    // useEffect(() => {
    //     console.log(activatedEdge)
    // }, [activatedEdge])
   
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

    const renderLoopIcon = () => {
        if (getNode(id)?.data?.looped) {
            return (<div className={`w-[16px] h-[16px] rounded-[5px] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "bg-main-orange " : 
            "bg-[#CDCDCD] group-hover:bg-main-orange"} flex items-center justify-center absolute left-[84px]`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="8" viewBox="0 0 14 8" fill="none">
                <path d="M3 -8.86917e-05L5.02073 3.49991H0.979274L3 -8.86917e-05ZM2.65 4V3.14991H3.35V4H2.65Z" fill="black"/>
                <path d="M6.2002 1.45499V1.45499C7.88035 1.45499 8.72043 1.45499 9.36217 1.78197C9.92665 2.06959 10.3856 2.52853 10.6732 3.09302C11.0002 3.73475 11.0002 4.57483 11.0002 6.25499V6.5459" stroke="black" strokeWidth="1.3"/>
                <path d="M7.7998 6.54599V6.54599C6.11965 6.54599 5.27957 6.54599 4.63783 6.21901C4.07335 5.93139 3.61441 5.47244 3.32678 4.90796C2.9998 4.26622 2.9998 3.42614 2.9998 1.74599V1.45508" stroke="black" strokeWidth="1.3"/>
                <path d="M11 8L13.0207 4.5L8.97927 4.5L11 8ZM10.65 4L10.65 4.85L11.35 4.85L11.35 4L10.65 4Z" fill="black"/>
                </svg>
                </div>)
        }
        else {
            return (<></>)
        }
    }

    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
         <button className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group ${isOnGeneratingNewNode ? "pointer-events-none" : ""}`} onClick={onClickButton} >
                LLM
                {renderLoopIcon()}
                <Handle id={`${id}-a`} className='edgeSrcHandle' type='source' position={Position.Top} />
                <Handle id={`${id}-b`} className='edgeSrcHandle' type='source' position={Position.Right} />
                <Handle id={`${id}-c`} className='edgeSrcHandle' type='source' position={Position.Bottom} />
                <Handle id={`${id}-d`} className='edgeSrcHandle' type='source' position={Position.Left} />
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