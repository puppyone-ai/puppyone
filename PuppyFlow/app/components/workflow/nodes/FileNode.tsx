'use client'
import { NodeProps, Node, Handle, Position, useReactFlow } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement} from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from '../nodeToolbar/NodeToolBar'
import {useNodesPerFlowContext} from '../../states/NodesPerFlowContext'

export type FileNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
  fileType?: string,
}

type FileNodeProps = NodeProps<Node<FileNodeData>>

function FileNode({data: {content, label, isLoading, locked, isInput, isOutput, editable}, type, isConnectable, id}: FileNodeProps ) {

  // const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode, preventInactivateNode, allowInactivateNode, disallowEditLabel} = useNodeContext()
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside} = useNodesPerFlowContext()
  const {getEdges, setNodes, getNode} = useReactFlow()
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false) 
  const measureSpanRef = useRef<HTMLSpanElement | null>(null) // 用于测量 labelContainer 的宽度
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")

  useEffect(() => {
    console.log(activatedNode, isOnConnect, isTargetHandleTouched, "border color")
    if (activatedNode?.id === id) {
      setBorderColor("border-main-blue");
  } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
     
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched])
 

    // 管理labelContainer的宽度
    useEffect(() => {

      const onLabelContainerBlur = () => {
        
        if (labelContainerRef.current) {
          setNodeUneditable(id)
        }
      }
  
      if (labelContainerRef.current) {
  
        document.addEventListener("click", (e: MouseEvent) => {
          if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
            onLabelContainerBlur()
          }
        })
      }
  
      return () => {
        if (labelContainerRef.current) {
          document.removeEventListener("click", (e: MouseEvent) => {
            if (!labelContainerRef.current?.contains(e.target as HTMLElement)) {
              onLabelContainerBlur()
            }
          })
        }
      }
    }, [])
    
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
      const currentLabel= getNode(id)?.data?.label as string | undefined
      if (currentLabel !== undefined && currentLabel !== nodeLabel && !isLocalEdit) {
          
          setNodeLabel(currentLabel)
          if (measureSpanRef.current) {
            measureSpanRef.current.textContent = currentLabel
          }
        }
    }, [label, id, isLocalEdit])
  

    const onFocus: () => void = () => {
      preventInactivateNode()
      const curRef = componentRef.current
      if (curRef && !curRef.classList.contains("nodrag")) {
          curRef.classList.add("nodrag")
          }
        
      }
  
      const onBlur: () => void = () => {
       
          allowInactivateNodeWhenClickOutside()  
          const curRef = componentRef.current
          if (curRef) {
              curRef.classList.remove("nodrag")
          }
          if (isLocalEdit){
            //  管理 node label onchange，只有 onBlur 的时候，才会更新 label
            // setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
            editNodeLabel(id, nodeLabel)
            setIsLocalEdit(false)
          }
      }

   // for rendering different background color of upper right tag
   const renderTagStyle = () => {
    if (locked) return "bg-[#3EDBC9] w-fit"
    else if (isInput) return "bg-[#6C98D5] w-fit"
    else if (isOutput) return "bg-[#FF9267] w-fit"
    else return "border-[#6D7177] bg-[#6D7177] w-fit"
  } 

  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    if (locked) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="12" width="12" height="7" fill="#3EDBC9"/>
      <rect x="6" y="6" width="8" height="11" rx="4" stroke="#3EDBC9" stroke-width="2"/>
      </svg>
    )
    else if (isInput) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.5 14V10L11.1667 12L8.5 14Z" fill="#6C98D5" stroke="#6C98D5"/>
      <path d="M9 11.9961L4 12.001" stroke="#6C98D5" stroke-width="2"/>
      <path d="M13.5 7H9.5V5.5H15.5V18.5H9.5V17H13.5H14V16.5V7.5V7H13.5Z" fill="#6C98D5" stroke="#6C98D5"/>
      </svg>

    )
    else if (isOutput) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12.5 14V10L15.1667 12L12.5 14Z" fill="#FF9267" stroke="#FF9267"/>
      <path d="M13 11.9961L8 12.001" stroke="#FF9267" stroke-width="2"/>
      <path d="M6.5 7H10.5V5.5H4.5V18.5H10.5V17H6.5H6V16.5V7.5V7H6.5Z" fill="#FF9267" stroke="#FF9267"/>
      </svg>
    )
    else return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M5.5 4.5H8.5V7.5H5.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
        <path d="M5.5 16.5H8.5V19.5H5.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
        <path d="M11.5 16.5H14.5V19.5H11.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
        <path d="M11.5 10.5H14.5V13.5H11.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
        <path d="M5.5 10.5H8.5V13.5H5.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
        <path d="M11.5 4.5H14.5V7.5H11.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
      </svg>
    )
  }

  const EditLabel = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (labelRef.current ) {
      setIsLocalEdit(true)
      setNodeLabel(labelRef.current.value)
    }
  }

    // 计算 measureSpanRef 的宽度，这个就是在计算input element内部内容的真实宽度，记得+4px不然所有内容无法完全的展现在input中，另外若是存在isInput, isOutput, locked，则需要考虑当整体的内容+icon width 溢出最大值时，我们必须设定 inputbox 的width = maxWidth - 21px，不然因为我们设置了 input 的 maxWidth = '100%', 他会把icon 给覆盖掉的，若是没有icon，则不需要担心，因为就算是设计他的宽度=文本宽度，但是一旦整体宽度 > maxWidth, css 会自动把文本宽度给压缩到 maxWidth 的，所以不用担心
    const calculateLabelWidth = () => {
      if (measureSpanRef.current) {
        if (isInput || isOutput || locked) {
          if (contentRef.current) {
            if (measureSpanRef.current.offsetWidth + 21 > contentRef.current.clientWidth - 32) {
              // console.log("hello")
              return `${contentRef.current.clientWidth - 53}px`
            }
        }
      }
        return `${measureSpanRef.current.offsetWidth + 4}px`;
    }
      return 'auto'
  }


    // 计算 <input> element 的宽度, input element 的宽度是根据 measureSpanRef 的宽度来决定的，分情况：若是editable，则需要拉到当前的最大width （若是前面有isInput, isOutput, locked，则需要减去53px，否则，则需要减去32px, 因为有logo），否则，则需要拉到当前的label的宽度（拖住文体即可）
    const calculateInputWidth = () => {
      if (contentRef.current) {
        if (editable) {
          if (isInput || isOutput || locked) {
            return `${contentRef.current.clientWidth - 53}px`
          }
          else {
            return `${contentRef.current.clientWidth - 32}px`
          }
        }
      }
      return calculateLabelWidth()
    }

    // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
    const calculateMaxLabelContainerWidth = () => {
      if (contentRef.current) {
        return `${contentRef.current.clientWidth - 32}px`
      }
      return '100%'
    }
  

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[208px] min-h-[208px] p-[32px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      <div id={id} ref={contentRef} 
        className={`w-full h-full ${
          content 
            ? "border-solid border-[1.5px]" 
            : "border-dashed border-[1.5px]"
        } min-w-[144px] min-h-[144px] rounded-[8px] flex justify-center ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}>
          
           
      <div ref={labelContainerRef} 
           style={{
            width: 'fit-content',
            maxWidth: calculateMaxLabelContainerWidth(),
           }}
           className={`absolute top-[40px] left-[40px] h-[24px] rounded-[4px]   px-[0px] flex items-center justify-center gap-[8px] z-[20000]`}>
           {renderTagLogo()}

            <span
            ref={measureSpanRef}
            style={{
              visibility: 'hidden',
              position: 'absolute',
              whiteSpace: 'pre',
              fontSize: '12px',
              lineHeight: '18px',
              fontWeight: '700',
              fontFamily: 'Plus Jakarta Sans'
            }}
          >
            {nodeLabel}
          </span>
           
            <input ref={labelRef}  autoFocus={editable} className={`flex items-center justify-start text-[#6D7177] font-[700] text-[12px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`}
            style={{
              boxSizing: "content-box",
              width: calculateInputWidth(),
              maxWidth: '100%',
              
            }}
            size={nodeLabel.length ?? 0}
            value={`${nodeLabel}`} readOnly={!editable} onChange={EditLabel} onMouseDownCapture={onFocus} onBlur={onBlur} />
           
          
        </div>

        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="13" viewBox="0 0 14 13" fill="none" className='fixed bottom-[40px] right-[40px]'>
          <path d="M0.5 0.5H8.87821L13.2838 12.5H0.5V0.5Z" stroke="#6D7177"/>
          <rect x="0.5" y="3.38916" width="13" height="9.11111"  stroke="#6D7177"/>
        </svg>

        <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>
        
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

export default FileNode