'use client'
import { NodeProps, Node, Handle, Position, useReactFlow} from '@xyflow/react'
import React, { useState, useCallback, useEffect, useRef} from 'react'
import { useNodeContext } from '../../states/NodeContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from '../buttonControllers/nodeToolbar/NodeToolBar'


// 后期需要设计内容为editor！！用户可以自己编辑的！！
type WebLinkNodeProps = NodeProps<Node<{ content: string, label: string }>>

function WebLinkNode({data: {content, label}, isConnectable, id, type}: WebLinkNodeProps) {

    // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  // const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const [isAdd, setIsAdd] = useState(false)
  const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode, preventInactivateNode, allowInactivateNode, disallowEditLabel} = useNodeContext()
  const {setNodes, getNode} = useReactFlow()
  const [isActivated, setIsActivated] = useState(false)
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false) 

  
  useEffect(() => {
    const addNodeAndSetFlag = async () => {
      await addNode(id); // 假设 addNode 返回一个 Promise
      setIsAdd(true);
    };
    
    if (!isAdd) {
      const findnode = searchNode(id)
      if (findnode) {
        console.log("have already create. no need to recreate")
        setIsAdd(true)
        allowActivateNode()
        return
      }
      addNodeAndSetFlag();
      allowActivateNode()
    }


  }, [isAdd, id]);

  // 管理labelContainer的宽度
  useEffect(() => {
    const onLabelContainerFocus = () => {
      if (labelContainerRef.current) {
        if (contentRef.current) {
          labelContainerRef.current.style.width = `${contentRef.current.clientWidth - 16}px`
        }
      }
    }

    const onLabelContainerBlur = () => {
      if (labelContainerRef.current) {
        labelContainerRef.current.style.width = `60px`
        disallowEditLabel(id)
      }
    }

    if (labelContainerRef.current) {
      labelContainerRef.current.addEventListener("click", onLabelContainerFocus)
      // labelRef.current.addEventListener("blur", onLabelBlur)
      document.addEventListener("click", (e: MouseEvent) => {
        if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
          onLabelContainerBlur()
        }
      })
    }

    return () => {
      if (labelContainerRef.current) {
        labelContainerRef.current.removeEventListener("click", onLabelContainerFocus)
        // labelRef.current.removeEventListener("blur", onLabelBlur)
        document.removeEventListener("click", (e: MouseEvent) => {
          if (!labelContainerRef.current?.contains(e.target as HTMLElement)) {
            onLabelContainerBlur()
          }
        })
      }
    }
  }, [])
  
  // 自动聚焦
  useEffect(() => {
    if (searchNode(id)?.editable && labelRef.current) {
      labelRef.current?.focus();
    }
  }, [searchNode(id)?.editable, id]);

  // 管理 label onchange， 注意：若是当前的workflow中已经存在同样的id，那么不回重新对于这个node进行initialized，那么此时label就是改变了也不会rendering 最新的值，所以我们必须要通过这个useEffect来确保label的值是最新的
  useEffect(() => {
    const currentLabel= getNode(id)?.data?.label as string | undefined
    if (currentLabel !== undefined && currentLabel !== nodeLabel && !isLocalEdit) {
        setNodeLabel(currentLabel)
      }
  }, [label, id, isLocalEdit])
  
  

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
  //     //     const newId = target.getAttribute('data-nodeid')
  //     //     inactivateNode(id)
  //     //     if (newId) activateNode(newId)
  //     //     setIsActivated(false)
  //     //     // console.log(`${id} should be inactivated`)
  //     //   }
  //     // else {
  //     //   // console.log(target, id)
  //     //   await activateNode(id)
  //     //   setIsActivated(true)
  //     //   // console.log(`${id} should be activated`)
  //     // }
  //     }


  //   const onMouseEnter = (event: MouseEvent) => {
  //     event.preventDefault()
  //     event.stopPropagation()
  //     console.log(`${id} is ${isOnConnect ? "prevented to connect": "allowed to connect"}`)
  //     if (isOnConnect) return
  //     activateNode(id)
  //     setIsActivated(true)
  //   }
  
  //   const onMouseLeave = (event: MouseEvent) => {
  //     event.preventDefault()
  //     event.stopPropagation()
  //     if (isOnConnect) return
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
  

  // const onHandleClick = (position: Position) => {
  //   setSelectedHandle(prevState => prevState === position ? null : position);
  // };

  const getBorderColor  = () => {
    if (searchNode(id)?.activated){
      return "border-main-blue"
    }
    else {
      if (isOnConnect && isTargetHandleTouched) return "border-main-orange" 
      return "border-main-deep-grey"
    }
  }

  const onFocus: () => void = () => {
    preventInactivateNode(id)
  const curRef = componentRef.current
  if (curRef && !curRef.classList.contains("nodrag")) {
      curRef.classList.add("nodrag")
      }
  }

  const onBlur: () => void = () => {
      allowInactivateNode(id)
      const curRef = componentRef.current
      if (curRef) {
          curRef.classList.remove("nodrag")
      }
      if (isLocalEdit){
        //  管理 node label onchange，只有 onBlur 的时候，才会更新 label
        setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
        setIsLocalEdit(false)
      }
  }

   // for rendering different background color of upper right tag
   const renderTagStyle = () => {
    if (searchNode(id)?.locked) return "bg-[#3EDBC9] w-[53px]"
    else if (searchNode(id)?.isInput) return "bg-[#6C98D5] w-[53px]"
    else if (searchNode(id)?.isOutput) return "bg-[#FF9267] w-[53px]"
    else return "border-[#6D7177] bg-[#6D7177] w-[41px]"
  } 

  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    if (searchNode(id)?.locked) return (
      <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
      <rect y="4" width="8" height="5" fill="black"/>
      <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="black" strokeWidth="1.5"/>
    </svg>
    )
    else if (searchNode(id)?.isInput) return (
      <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
      <path d="M2.5 1.5L5.5 4L2.5 6.5V1.5Z" fill="black"/>
      <path d="M3 4H0" stroke="black" strokeWidth="1.5"/>
      <path d="M4 0H8V8H4V6.5H6.5V1.5H4V0Z" fill="black"/>
    </svg>
    )
    else if (searchNode(id)?.isOutput) return (
      <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
      <path d="M5.5 2L8 4L5.5 6V2Z" fill="black"/>
      <path d="M6 4H3" stroke="black" strokeWidth="1.5"/>
      <path d="M0 0H4V1.5H1.5V6.5H4V8H0V0Z" fill="black"/>
    </svg>
    )
    else return (
      <></>
    )
  }

  const EditLabel = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (labelRef.current ) {
      setIsLocalEdit(true)
      setNodeLabel(labelRef.current.value)
    }
  }

  const calculateLabelWidth = () => {
    if (contentRef.current) {
      return searchNode(id)?.editable ? 
      contentRef.current.clientWidth - 16 : 60
    }
    return 60
  }
  



  return (
    <div ref={componentRef} className='relative w-full h-full min-w-[176px] min-h-[176px] p-[32px]'>
      <div id={id} ref={contentRef} className={`w-full h-full min-h-[112px] border-[1.5px] rounded-[8px] px-[15px] py-[25px]  ${getBorderColor()} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-[16px] font-[400]`}  >

      <div ref={labelContainerRef} style={{
            width: `${calculateLabelWidth()}px`
          }} className={`absolute top-[40px] left-[40px] h-[18px] rounded-[6px]  ${renderTagStyle()} py-[4px] px-[8px] flex items-center justify-center gap-[5px] z-[20000]`}>
            {renderTagLogo()}
          <input ref={labelRef}  autoFocus={searchNode(id)?.editable} className={`flex items-center justify-center text-[#000] font-[700] text-[12px] w-full tracking-[0.84px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`} value={`${nodeLabel}`} readOnly={!searchNode(id)?.editable} onChange={EditLabel} onMouseDownCapture={onFocus} onBlur={onBlur} />
        </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none" className='fixed bottom-[40px] right-[40px]'>
          <path fillRule="evenodd" clipRule="evenodd" d="M8.36816 6.12566C8.27388 5.98507 8.16393 5.85168 8.03831 5.72788C7.03122 4.73542 5.3984 4.73542 4.3913 5.72788L1.8234 8.25849C0.816308 9.25096 0.816308 10.8601 1.8234 11.8525C2.83049 12.845 4.46332 12.845 5.47041 11.8525L7.1442 10.203L6.43194 9.50113L4.75815 11.1506C4.14443 11.7554 3.14938 11.7554 2.53566 11.1506C1.92194 10.5458 1.92194 9.56522 2.53566 8.96041L5.10356 6.4298C5.71729 5.82499 6.71233 5.82499 7.32605 6.4298C7.45456 6.55644 7.55616 6.69956 7.63086 6.85226L8.36816 6.12566Z" fill="#6D7177"/>
          <path fillRule="evenodd" clipRule="evenodd" d="M5.49365 7.52376C5.58793 7.66435 5.69788 7.79774 5.8235 7.92153C6.8306 8.914 8.46342 8.914 9.47051 7.92153L12.0384 5.39092C13.0455 4.39846 13.0455 2.78935 12.0384 1.79688C11.0313 0.804417 9.3985 0.804418 8.39141 1.79688L6.71761 3.44637L7.42987 4.14829L9.10367 2.4988C9.71739 1.89399 10.7124 1.89399 11.3262 2.4988C11.9399 3.10361 11.9399 4.0842 11.3262 4.68901L8.75825 7.21962C8.14453 7.82443 7.14949 7.82443 6.53576 7.21962C6.40725 7.09297 6.30565 6.94985 6.23096 6.79716L5.49365 7.52376Z" fill="#6D7177"/>
          </svg>

          <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>
            <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} position={Position.Top}  />
            <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right} />
            <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable}  position={Position.Bottom} />
            <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} 
            position={Position.Left}  />
            <Handle
            type="target"
            position={Position.Top}
            style={{
              position: "absolute",
              width: "calc(100% + 12px)",
              height: "calc(100% + 12px)",
              top: "0",
              left: "0",
              borderRadius: "0",
              transform: "translate(-6px, -6px)",
              background: "transparent",
              border: "none",
              zIndex: !isOnConnect ? "-1" : "1",
            }}
          isConnectable={isConnectable}
          onMouseEnter={() => setIsTargetHandleTouched(true)}
          onMouseLeave={() => setIsTargetHandleTouched(false)}
        />
             
    </div>
    </div>
      

    
  )
}

export default WebLinkNode