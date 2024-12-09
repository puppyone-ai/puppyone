'use client'
import { Handle, Position, NodeProps, Node, useOnViewportChange, Viewport} from '@xyflow/react'
import { useNodeContext } from '@/app/components/states/NodeContext'
import React, {useState, useEffect, useRef} from 'react'
import ChooseConfigMenu from '@/app/components/menu/configMenu/ChooseConfigMenu'
import { nodeSmallProps } from '@/app/components/menu/nodeMenu/NodeMenu'
import { useReactFlow } from '@xyflow/react'

export type ChooseConfigNodeData = {
    looped?: boolean | undefined,
    content: string | null,
    switch?: string | undefined,
    resultNodes: string[] | null,
    ON?: string[] | undefined,
    OFF?: string[] | undefined
}

type ChooseConfigNodeProps = NodeProps<Node<ChooseConfigNodeData>>

function ChooseConfig({isConnectable, id, data}: ChooseConfigNodeProps) {

    // const {isOnConnect, searchNode} = useNodeContext()
    // const [activated, setActivated] = useState(false)
    // const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)

    const {isOnConnect, activateEdgeNode, activatedEdge, clear} = useNodeContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
    const {getNode} = useReactFlow()
   
    const onClickButton = () => {
        
        if (activatedEdge === id) {
            clear()
        }
        else {
            clear()
            activateEdgeNode(id)
        }
    }

    

    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
         <button className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[10px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"} group`} onClick={onClickButton} >
                Choose
                <Handle className='edgeSrcHandle' type='source' position={Position.Bottom} />
                <Handle
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
        </button>
        <ChooseConfigMenu show={activatedEdge === id ? true : false} parentId={id} />
        </div>
        
    )
}

export default ChooseConfig
