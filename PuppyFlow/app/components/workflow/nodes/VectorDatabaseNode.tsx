'use client'
import { NodeProps, Node, Handle, Position, NodeResizer } from '@xyflow/react'
import React, {useState, useCallback, useEffect, useRef} from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from '../buttonControllers/nodeToolbar/NodeToolBar'
import { useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'

export type VectorDatabaseNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
}

type VectorDatabaseNodeProps = NodeProps<Node<VectorDatabaseNodeData>>

function VectorDatabaseNode({data: {content, label, isLoading, locked, isInput, isOutput, editable}, type, isConnectable, id}: VectorDatabaseNodeProps) {

 
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside} = useNodesPerFlowContext()
  const {setNodes, getNode} = useReactFlow()
  // used for connectting target node to make it highlight
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null) // 管理label input field 的宽度
  const labelContainerRef = useRef<HTMLDivElement | null>(null) // 管理labelContainer的宽度 = possible width of label input field + left logo svg
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel
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
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="9" viewBox="0 0 8 9" fill="none">
          <rect y="4" width="8" height="5" fill="black"/>
          <rect x="1.75" y="0.75" width="4.5" height="6.5" rx="2.25" stroke="black" strokeWidth="1.5"/>
        </svg>
        )
        else if (isInput) return (
          <svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M2.5 1.5L5.5 4L2.5 6.5V1.5Z" fill="black"/>
          <path d="M3 4H0" stroke="black" strokeWidth="1.5"/>
          <path d="M4 0H8V8H4V6.5H6.5V1.5H4V0Z" fill="black"/>
        </svg>
        )
        else if (isOutput) return (
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
    <div ref={componentRef} className={`w-full h-full  min-w-[176px] min-h-[176px] p-[32px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
       <div id={id} ref={contentRef} className={`w-full h-full min-h-[112px] border-[1.5px] rounded-[8px] p-[16px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-[16px] leading-5 font-[400]`} >
       
       <div ref={labelContainerRef} 
           style={{
            width: 'fit-content',
            maxWidth: calculateMaxLabelContainerWidth(),
           }}
           className={`absolute top-[40px] left-[40px] h-[18px] rounded-[4px] ${renderTagStyle()}  py-[4px] px-[4px] flex items-center justify-center gap-[5px] z-[20000]`}>
            {renderTagLogo()}

            <span
            ref={measureSpanRef}
            style={{
              visibility: 'hidden',
              position: 'absolute',
              whiteSpace: 'pre',
              fontSize: '10px',
              lineHeight: '18px',
              fontWeight: '700',
              fontFamily: 'Plus Jakarta Sans'
            }}
          >
            {nodeLabel}
          </span>
           
            <input ref={labelRef}  autoFocus={editable} className={`flex items-center justify-start text-[#000] font-[700] text-[10px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`}
            style={{
              boxSizing: "content-box",
              width: calculateInputWidth(),
              maxWidth: '100%',
              
            }}
            size={nodeLabel.length ?? 0}
            value={`${nodeLabel}`} readOnly={!editable} onChange={EditLabel} onMouseDownCapture={onFocus} onBlur={onBlur} />
           
          
        </div>
        
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="17" fill="none" viewBox="0 0 20 17" className='fixed bottom-[40px] right-[40px]'>
            <path stroke="#6D7177" d="M18.5 7.08c0 .293-.238.681-.902 1.026-.64.333-1.557.553-2.598.553s-1.959-.22-2.598-.553c-.663-.345-.902-.733-.902-1.026 0-.293.239-.682.902-1.027C13.042 5.72 13.96 5.5 15 5.5s1.959.22 2.598.553c.664.345.902.734.902 1.027Z"/>
            <path fill="#6D7177" fillRule="evenodd" d="M11 11.932c0 1.02 1.79 1.848 4 1.848s4-.827 4-1.848h-1.018c-.042.063-.174.214-.573.399-.565.261-1.416.45-2.409.45-.993 0-1.844-.189-2.409-.45-.4-.185-.531-.336-.573-.4H11Zm0-2.31c0 1.02 1.79 1.848 4 1.848s4-.828 4-1.848h-1.018c-.042.062-.174.214-.573.399-.565.26-1.416.45-2.409.45-.993 0-1.844-.19-2.409-.45-.4-.185-.531-.337-.573-.4H11Zm.003 4.621a1.07 1.07 0 0 0-.003.086c0 1.148 1.79 2.08 4 2.08s4-.932 4-2.08a1.07 1.07 0 0 0-.003-.086H17.97a.22.22 0 0 1 .03.086c0 .012-.03.27-.633.583-.554.288-1.39.496-2.367.496-.977 0-1.813-.208-2.367-.496-.604-.314-.633-.571-.633-.583 0-.004.003-.035.03-.086h-1.027Z" clipRule="evenodd"/>
            <path stroke="#6D7177" d="M18.8 14.474V7.169m-7.6 7.305V7.169"/>
            <path fill="#6D7177" d="M5 0 3.268 3h3.464L5 0ZM0 10l3.448-.334-2.014-2.82L0 10Zm4.826-3.816L2.023 8.187l.348.488 2.803-2.002-.348-.489Z"/>
            <path stroke="#6D7177" strokeWidth="1.2" d="M5 6.428v-5m0 5-3.571 2.5"/>
            <path fill="#6D7177" d="m10 10-3.448-.334 2.014-2.82L10 10ZM5.174 6.184l2.803 2.003-.348.488-2.803-2.002.348-.489Z"/>
            <path stroke="#6D7177" strokeWidth="1.2" d="m5 6.428 3.571 2.5"/>
          </svg>

          <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>


        
        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} position={Position.Top} 
              />
            <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right} 
             />
            <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable}  position={Position.Bottom}   />
            <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} 
            position={Position.Left} 
             />
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

export default VectorDatabaseNode