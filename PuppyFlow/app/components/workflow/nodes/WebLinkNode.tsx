'use client'
import { NodeProps, Node, Handle, Position, useReactFlow} from '@xyflow/react'
import React, { useState, useCallback, useEffect, useRef} from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from '../nodeTopRightBar/NodeTopRightBar'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'

export type WebLinkNodeData = {
    content: string,
    label: string,
    isLoading: boolean,
    locked: boolean,
    isInput: boolean,
    isOutput: boolean,
    editable: boolean,

}

type WebLinkNodeProps = NodeProps<Node<WebLinkNodeData>>

function WebLinkNode({data: {content, label, isLoading, locked, isInput, isOutput, editable}, isConnectable, id, type}: WebLinkNodeProps) {

  
  const {setNodes, getNode} = useReactFlow()
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside} = useNodesPerFlowContext()
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false)
  const measureSpanRef = useRef<HTMLSpanElement | null>(null) // 用于测量 labelContainer 的宽度
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")

  useEffect(() => {
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


    // 计算 <input> element 的宽度, input element 的宽度是根据 measureSpanRef 的宽度来决定的，分情况：若是editable，则需要拉到当前的最大width （若是前面有isInput, isOutput, locked，则需要减去53px，否则，则需要拉到当前的label的宽度（拖住文体即可）
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
      <div id={id} ref={contentRef} className={`w-full h-full min-h-[144px] min-w-[144px] border-[1.5px] rounded-[8px] px-[15px] py-[25px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-[16px] font-[400]`}  >

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

export default WebLinkNode