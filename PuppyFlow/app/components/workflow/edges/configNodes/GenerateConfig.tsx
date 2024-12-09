import { Handle, Position, NodeProps, Node, } from '@xyflow/react'
import { useNodeContext } from '@/app/components/states/NodeContext'
import React, {useState} from 'react'

type GenerateConfigNodeProps = NodeProps<Node>

function GenerateConfig({isConnectable, id}: GenerateConfigNodeProps) {

    const {isOnConnect, activatedEdge} = useNodeContext()
    const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)


    return (
        <div className='p-[3px] w-[80px] h-[48px]'>
            <button className={`w-full h-full flex-shrink-0 rounded-[8px] border-[2px] border-[#CDCDCD] text-[#CDCDCD] bg-[#181818] hover:border-main-orange hover:text-main-orange flex items-center justify-center font-plus-jakarta-sans text-[12px] font-[700] ${isOnConnect && isTargetHandleTouched || activatedEdge === id ? "border-main-orange hover:border-main-orange hover:text-main-orange text-main-orange" : "border-[#CDCDCD] text-[#CDCDCD]"}`}>
                Generate
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
        </div>
        
    )
}

export default GenerateConfig