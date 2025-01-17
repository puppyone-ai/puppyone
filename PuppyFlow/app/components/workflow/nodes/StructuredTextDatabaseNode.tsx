'use client'
import { NodeProps, Node, Handle, Position, NodeResizer } from '@xyflow/react'
import React, {useState, useCallback, useEffect, useRef} from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from '../nodeToolbar/NodeToolBar'
import { useReactFlow } from '@xyflow/react'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'

export type StructuredTextDatabaseNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
}

type StructuredTextDatabaseNodeProps = NodeProps<Node<StructuredTextDatabaseNodeData>>

function StructuredTextDatabaseNode({data: {content, label, isLoading, locked, isInput, isOutput, editable}, isConnectable, id, type}: StructuredTextDatabaseNodeProps) {

   
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
       <div ref={contentRef} id={id} className={`w-full h-full  min-h-[112px] border-[1.5px] rounded-[8px] px-[8px] pt-[32px] pb-[8px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-[16px] font-[400]`} >
            
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
        
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="22" fill="none" viewBox="0 0 24 22" className='fixed bottom-[40px] right-[40px]'>
            <path stroke="#6D7177" d="M22.5 12.08c0 .293-.238.681-.902 1.027-.64.332-1.557.552-2.598.552s-1.959-.22-2.598-.553c-.664-.345-.902-.733-.902-1.026 0-.293.239-.682.902-1.027.64-.333 1.557-.553 2.598-.553s1.959.22 2.598.553c.664.345.902.733.902 1.027Z"/>
            <path fill="#6D7177" fillRule="evenodd" d="M15 16.932c0 1.02 1.79 1.848 4 1.848s4-.828 4-1.848h-1.018c-.042.063-.174.214-.573.399-.565.261-1.416.45-2.409.45-.993 0-1.844-.189-2.409-.45-.4-.185-.531-.337-.573-.4H15Zm0-2.31c0 1.02 1.79 1.848 4 1.848s4-.827 4-1.848h-1.018c-.042.063-.174.214-.573.399-.565.26-1.416.45-2.409.45-.993 0-1.844-.19-2.409-.45-.4-.185-.531-.337-.573-.4H15Zm.003 4.621a1.07 1.07 0 0 0-.003.086c0 1.148 1.79 2.08 4 2.08s4-.932 4-2.08a1.07 1.07 0 0 0-.003-.086H21.97a.22.22 0 0 1 .03.086c0 .012-.03.27-.633.583-.554.288-1.39.496-2.367.496-.977 0-1.813-.208-2.367-.496-.604-.314-.633-.571-.633-.583 0-.004.003-.035.03-.086h-1.027Z" clipRule="evenodd"/>
            <path stroke="#6D7177" d="M22.8 19.474v-7.305m-7.6 7.305v-7.305"/>
            <path fill="#6D7177" d="M1.96 10.02c0 .4.103.686.306.855.203.172.425.272.668.3v.458c-.464-.047-.848-.184-1.153-.41-.302-.224-.453-.594-.453-1.11V9.31c0-.284-.044-.508-.133-.672-.161-.3-.471-.474-.93-.524v-.445c.462-.055.771-.225.93-.512.089-.159.133-.386.133-.683v-.637c0-.49.106-.878.317-1.164.213-.287.643-.457 1.289-.512v.445c-.42.037-.704.222-.852.555-.08.182-.121.435-.121.758v.437c0 .391-.048.69-.145.899-.174.378-.513.59-1.015.637.5.044.838.263 1.015.656.097.216.145.51.145.883v.59Zm4.7-2.372-.87-2.535-.927 2.535H6.66ZM5.383 4.262h.879L8.344 10h-.852L6.91 8.281H4.64L4.02 10h-.797l2.16-5.738Zm4.113 4.625c0 .203.074.363.223.48a.826.826 0 0 0 .527.176c.247 0 .487-.057.719-.172.39-.19.586-.501.586-.934v-.566c-.086.055-.197.1-.332.137a2.833 2.833 0 0 1-.399.078l-.425.055c-.256.033-.447.087-.575.16-.216.122-.324.317-.324.586ZM11.2 7.465c.162-.021.27-.089.324-.203a.617.617 0 0 0 .047-.27c0-.24-.086-.413-.258-.52-.169-.109-.412-.163-.73-.163-.367 0-.628.099-.781.296-.086.11-.142.273-.168.489h-.656c.013-.516.18-.874.5-1.074a2.06 2.06 0 0 1 1.12-.305c.493 0 .893.094 1.2.281.305.188.457.48.457.875v2.41c0 .073.014.132.043.176.031.044.095.066.191.066a1.6 1.6 0 0 0 .106-.003l.125-.02v.52c-.11.03-.193.05-.25.058a1.831 1.831 0 0 1-.235.012c-.242 0-.418-.086-.527-.258a.996.996 0 0 1-.121-.387c-.143.188-.349.35-.617.489a1.91 1.91 0 0 1-.887.207c-.388 0-.706-.118-.953-.352a1.184 1.184 0 0 1-.367-.887c0-.388.12-.688.363-.902.242-.214.56-.345.953-.395l1.121-.14Zm3.989.426c-.5-.047-.838-.258-1.012-.633-.097-.209-.145-.51-.145-.903v-.437c0-.344-.04-.604-.12-.781-.147-.318-.43-.495-.852-.532V4.16c.671.055 1.127.263 1.367.625.156.232.234.582.234 1.05v.638c0 .291.044.518.133.68.161.294.473.465.934.515v.445c-.459.047-.77.223-.934.528-.089.166-.133.389-.133.668v.804c0 .526-.152.899-.457 1.117-.302.22-.683.353-1.144.403v-.457c.278-.037.51-.149.695-.336.185-.185.277-.458.277-.82v-.59c0-.375.048-.67.145-.883.177-.393.514-.612 1.011-.656Z"/>
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

export default StructuredTextDatabaseNode