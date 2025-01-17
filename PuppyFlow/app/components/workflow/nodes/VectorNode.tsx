'use client'
import { NodeProps, Node, Handle, Position, useReactFlow } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement} from 'react'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeSettingsController from '../nodeToolbar/NodeSettingsController'

export type VectorNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
}

type VectorNodeProps = NodeProps<Node<VectorNodeData>>

function VectorNode({data: {content, label, isLoading, locked, isInput, isOutput, editable}, isConnectable, id}: VectorNodeProps ) {

 
  
  const {getEdges} = useReactFlow()
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside} = useNodesPerFlowContext()
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")

  useEffect(() => {
    if (activatedNode?.id === id) {
      setBorderColor("border-main-blue");
  } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
     
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched])
  


  
  

  return (
    <div ref={componentRef} className={`h-full min-w-[176px] min-h-[176px] p-[32px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      <div id={id} className={`w-full h-full min-h-[112px] border-[2px] rounded-[8px] px-[15px] py-[25px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-[16px] font-[400]`}  >
            
      <div className={`absolute top-[6px] left-[32px] h-[18px] rounded-[6px] ${locked ?  "bg-main-blue w-[53px]" : "border-[3px] border-[#6D7177] bg-[#6D7177] w-[41px]"}  flex items-center justify-center gap-[7px]`}>
          <div className={`${locked ? "" : "hidden"}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
              <rect y="4" width="8" height="5" fill="black"/>
              <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="black" strokeWidth="1.5"/>
            </svg>
          </div>
          <div className='flex items-center justify-center text-[#000] font-[700] text-[12px] tracking-[0.84px] font-plus-jakarta-sans ' >
          no.{id}
          </div>
        </div>

        <div className={`absolute top-[8px] right-[32px] ${activatedNode?.id === id ? "": "hidden"}`}>
          <NodeSettingsController nodeid={id}/>
        </div>

        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none" className='fixed bottom-[40px] right-[40px]'>
        <path d="M7 0L4.6906 4L9.3094 4L7 0Z" fill="#6D7177"/>
        <path d="M0 14L4.59725 13.5543L1.91262 9.79581L0 14ZM6.7675 8.67451L2.69695 11.582L3.16194 12.233L7.2325 9.32549L6.7675 8.67451Z" fill="#6D7177"/>
        <path d="M7 9V2" stroke="#6D7177" strokeWidth="1.5"/>
        <path d="M7 9L2 12.5" stroke="#6D7177" strokeWidth="1.5"/>
        <path d="M14 14L9.40275 13.5543L12.0874 9.79581L14 14ZM7.2325 8.67451L11.3031 11.582L10.8381 12.233L6.7675 9.32549L7.2325 8.67451Z" fill="#6D7177"/>
        <path d="M7 9L12 12.5" stroke="#6D7177" strokeWidth="1.5"/>
      </svg>
        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} position={Position.Top}  />
            <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}  />
            <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable}  position={Position.Bottom}  />
            <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} 
            position={Position.Left}  />
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
    </div>
      

  )
}

export default VectorNode