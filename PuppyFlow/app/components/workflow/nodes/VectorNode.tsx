'use client'
import { NodeProps, Node, Handle, Position, useReactFlow } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement} from 'react'
import { nodeState, useNodeContext } from '../../states/NodeContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeSettingsController from '../buttonControllers/nodeToolbar/NodeSettingsController'



type VectorNodeProps = NodeProps<Node<{ content: string }>>

function VectorNode({data: {content}, isConnectable, id}: VectorNodeProps ) {

  // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const [isAdd, setIsAdd] = useState(false)
  const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode} = useNodeContext()
  const {getEdges} = useReactFlow()
  const [isActivated, setIsActivated] = useState(false)
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const [self, setSelf] = useState<nodeState | null>(searchNode(id))
  

  
  useEffect(() => {
    const addNodeAndSetFlag = async () => {
      // console.log(isAdd, id)
      // console.log(`I am waiting to add you node ${id}`)
      await addNode(id); // 假设 addNode 返回一个 Promise
      setIsAdd(true);
    };
    
    if (!isAdd) {
      const findnode = searchNode(id)
      if (findnode) {
        // console.log("have already create. no need to recreate")
        setIsAdd(true)
        allowActivateNode()
        return
      }
      addNodeAndSetFlag();
      allowActivateNode()
    }

    if (isAdd){
      setSelf(searchNode(id))
    }

  }, [isAdd, id]);
  

  // useEffect(() => {
  //   if (isOnConnect) {
  //     console.log(isOnConnect)
  //     return
  //   }
  //   if (!searchNode(id)?.activated) setSelectedHandle(null)
  // }, [searchNode(id)?.activated, isOnConnect])


  // useEffect(()=>{
    
  //   const mouseClick = async (event: MouseEvent) => {
  //     // console.log(event.target, id, nodes)
      
  //     event.preventDefault()
  //     event.stopPropagation()
  //     const target = event.target as unknown as HTMLElement
  //     // console.log(target.hasAttribute('data-nodeid'))
  //     // console.log(event.target, event.target.getAttribute('data-nodeid'), id, "hi")
  //     console.log(target)
      
  //     if (target === null || !target || !target.hasAttribute('data-nodeid')) {
  //       // console.log(nodes, searchNode(id))
  //       clear()
  //       setIsActivated(false)
  //       allowActivateNode()
  //       // console.log(`${id} should be inactivated`)
  //     }
  //     // else if (target && target.hasAttribute('data-nodeid') && target.getAttribute('data-nodeid') !== id) {
  //     //     // console.log(searchNode(id), id)
  //     //     // const newId = target.getAttribute('data-nodeid')
  //     //     // inactivateNode(id)
  //     //     // if (newId) activateNode(newId)
  //     //     // setIsActivated(false)
  //     //     // console.log(`${id} should be inactivated`)
  //     //   }
  //     // else {
  //     //   // console.log(target, id)
  //     //   // await activateNode(id)
  //     //   setIsActivated(true)
  //     //   // console.log(`${id} should be activated`)
  //     // }
  //     }

  //   const onMouseEnter = (event: MouseEvent) => {
  //     event.preventDefault()
  //     event.stopPropagation()
  //     activateNode(id)
  //     setIsActivated(true)
  //   }
  
  //   const onMouseLeave = (event: MouseEvent) => {
  //     event.preventDefault()
  //     event.stopPropagation()
  //     inactivateNode(id)
  //     setIsActivated(false)
  //   }

  //   const currentRef = componentRef.current

  //   if (currentRef && isAdd) {
  //     document.addEventListener('click', mouseClick)
  //     currentRef.addEventListener('mouseenter', onMouseEnter)
  //     currentRef.addEventListener('mouseleave', onMouseLeave)
  //   }
    
  //   return () => {
  //     if (currentRef) {
  //       document.removeEventListener('click', mouseClick)
  //       currentRef.removeEventListener('mouseenter', onMouseEnter)
  //       currentRef.removeEventListener('mouseleave', onMouseLeave)
  //     }
  //     // document.removeEventListener('click', mouseClick)
      
  //   }
  // }, [isAdd])
  

  const getBorderColor  = () => {
    if (searchNode(id)?.activated){
      return "border-main-blue"
    }
    else {
      if (isOnConnect && isTargetHandleTouched) return "border-main-orange" 
      return "border-main-deep-grey"
    }
  }
  

  return (
    <div ref={componentRef} className="h-full min-w-[176px] min-h-[176px] p-[32px]">
      <div id={id} className={`w-full h-full min-h-[112px] border-[2px] rounded-[8px] px-[15px] py-[25px]  ${getBorderColor()} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-[16px] font-[400]`}  >
            
      <div className={`absolute top-[6px] left-[32px] h-[18px] rounded-[6px] ${searchNode(id)?.locked ?  "bg-main-blue w-[53px]" : "border-[3px] border-[#6D7177] bg-[#6D7177] w-[41px]"}  flex items-center justify-center gap-[7px]`}>
          <div className={`${searchNode(id)?.locked ? "" : "hidden"}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
              <rect y="4" width="8" height="5" fill="black"/>
              <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="black" strokeWidth="1.5"/>
            </svg>
          </div>
          <div className='flex items-center justify-center text-[#000] font-[700] text-[12px] tracking-[0.84px] font-plus-jakarta-sans ' >
          no.{id}
          </div>
        </div>

        <div className={`absolute top-[8px] right-[32px] ${searchNode(id)?.activated ? "": "hidden"}`}>
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
            
      </div>
    </div>
      

  )
}

export default VectorNode