'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement, useMemo} from 'react'
import { nodeState, useNodeContext } from '../../states/NodeContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import JSONForm from '../../menu/tableComponent/JSONForm'
import NodeToolBar from '../buttonControllers/nodeToolbar/NodeToolBar'
import TextEditor from '../../menu/tableComponent/TextEditor'
import TextEditorTextArea from '../../menu/tableComponent/TextEditorTextArea'
import TextEditorTipTap from '../../menu/tableComponent/TextEditorTipTap'
import useManageReactFlowUtils from '../../hooks/useManageReactFlowUtils'
import dynamic from 'next/dynamic'


type TextBlockNodeProps = NodeProps<Node<{ content: string, label:string }>>

const TextEditorBlockNote = dynamic(() => import('../../menu/tableComponent/TextEditorBlockNote'), { ssr: false })

function TextBlockNode({isConnectable, id, type, data: {content, label}}: TextBlockNodeProps ) {

  
  // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const [isAdd, setIsAdd] = useState(false)
  const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode, preventInactivateNode, allowInactivateNode, disallowEditLabel} = useNodeContext()
  const {getEdges, screenToFlowPosition, setNodes, getNode} = useReactFlow()
  const [isActivated, setIsActivated] = useState(false)
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const [self, setSelf] = useState<nodeState | null>(searchNode(id))
  const labelRef = useRef<HTMLInputElement | null>(null) // 管理label input field 的宽度
  const labelContainerRef = useRef<HTMLDivElement | null>(null) // 管理labelContainer的宽度 = possible width of label input field + left logo svg
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel

  
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

  useEffect(() => {
    if (!contentRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        setContentSize({ width, height });
      }
    });

    resizeObserver.observe(contentRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);



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
      
      // if (isLocalEdit){
      //   console.log("rename label!!")
      //   console.log(isLocalEdit)
      //   setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
      //   setIsLocalEdit(false)
      // }
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

    const preventNodeDrag = () => {
      const curRef = componentRef.current
    if (curRef && !curRef.classList.contains("nodrag")) {
        curRef.classList.add("nodrag")
        }
    }

    const allowNodeDrag = () => {
      const curRef = componentRef.current
        if (curRef) {
            curRef.classList.remove("nodrag")
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
    <div ref={componentRef} className="relative w-full h-full min-w-[240px] min-h-[304px] p-[32px]">
      <div ref={contentRef} id={id} className={`w-full h-full border-[1.5px] min-h-[240px] rounded-[8px] px-[16px] pt-[40px] pb-[16px] ${getBorderColor()} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}  >
           {/* <TextEditor preventParentDrag={onFocus} allowParentDrag={onBlur}
          widthStyle={contentSize.width - 6} heightStyle={contentSize.height}
          placeholder='Text' parentId={id} /> */}

          {/* plain text editor */}
          <TextEditorTextArea preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='Text' parentId={id} />


          {/* <TextEditorTipTap preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='Text' parentId={id} /> */}

          {/* Rich text editor */}
          {/* <TextEditorBlockNote preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='[{"type": "paragraph", "content": "Text"}]' parentId={id} /> */}
           
           <div ref={labelContainerRef} style={{
            width: `${calculateLabelWidth()}px`
          }} className={`absolute top-[40px] left-[40px] h-[18px] rounded-[4px]  ${renderTagStyle()} py-[4px] px-[8px] flex items-center justify-center gap-[5px] z-[20000]`}>
            {renderTagLogo()}
          <input ref={labelRef}  autoFocus={searchNode(id)?.editable} className={`flex items-center justify-center text-[#000] font-[700] text-[10px] w-full leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`} value={`${nodeLabel}`} readOnly={!searchNode(id)?.editable} onChange={EditLabel} onMouseDownCapture={onFocus} onBlur={onBlur} />
        </div>

        <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>
        
        <NodeResizeControl 
          minWidth={240} 
          minHeight={304}
          style={{ position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize', 
            background: 'transparent',
            border: 'none' }}
        >
          <div 
            style={{
              position: "absolute",
              visibility: `${searchNode(id)?.activated ? "visible" : "hidden"}`,
              right: "34px",
              bottom: "34px",
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width:"14px",
              height:"14px",
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="6" height="7" viewBox="0 0 6 7" fill="none">
            <path fillRule="evenodd" clipRule="evenodd" d="M3.98944 0C3.981 0.450097 3.96581 0.830004 3.93852 1.16404C3.8805 1.87412 3.7779 2.19904 3.67302 2.40488C3.3854 2.96937 2.92646 3.42831 2.36197 3.71593C2.15613 3.82082 1.83121 3.92342 1.12113 3.98143C0.797759 4.00785 0.431405 4.02293 0 4.03153V6.03187C1.53922 6.0024 2.49203 5.89432 3.26995 5.49795C4.21076 5.01858 4.97567 4.25368 5.45503 3.31287C5.85508 2.52773 5.96146 1.56447 5.98975 0H3.98944Z" fill="#6D7177"/>
            </svg>
          </div>
        </NodeResizeControl>

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
              border: "1px solid transparent",
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

export default TextBlockNode