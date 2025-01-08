'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React,{useRef, useEffect, useState, ReactElement} from 'react'
// import { nodeState, useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import JSONForm from '../../menu/tableComponent/JSONForm'
import NodeToolBar from '../buttonControllers/nodeToolbar/NodeToolBar'
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon'
import { json } from 'stream/consumers'


type methodNames = "cosine"
type modelNames = "text-embedding-ada-002"
type vdb_typeNames = "pgvector"

export type JsonNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,
  // embedding configurations
  model?: modelNames | undefined,
  method?: methodNames | undefined,
  vdb_type?: vdb_typeNames | undefined,
  index_name?: string | undefined, // 用于存储embedding 的index_name
}


type JsonBlockNodeProps = NodeProps<Node<JsonNodeData>>

function JsonBlockNode({isConnectable, id, type, data: {content, label, isLoading, locked, isInput, isOutput, editable, index_name}}: JsonBlockNodeProps ) {

  // selectHandle = 1: TOP, 2: RIGHT, 3: BOTTOM, 4: LEFT. 
  // Initialization: 0
  // const [selectedHandle, setSelectedHandle] = useState<Position | null>(null)
  const {activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside} = useNodesPerFlowContext()
  const {getNode} = useReactFlow()
  // for linking to handle bar, it will be highlighed.
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  const labelContainerRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLInputElement | null>(null)
  const [nodeLabel, setNodeLabel] = useState(label ?? id)
  const [isLocalEdit, setIsLocalEdit] = useState(false); //使用 isLocalEdit 标志来区分本地编辑和外部更新。只有内部编辑：才能触发 更新 data.label, 只有外部更新才能触发 更新 nodeLabel
  const measureSpanRef = useRef<HTMLSpanElement | null>(null) // 用于测量 labelContainer 的宽度
  const [borderColor, setBorderColor] = useState("border-main-deep-grey")
  const [buttonText, setButtonText] = useState("input view"); // State for button text


  useEffect(() => {
    // console.log(activatedNode, isOnConnect, isTargetHandleTouched, "border color")
    if (activatedNode?.id === id) {
      setBorderColor("border-main-blue");
  } else {
      setBorderColor(isOnConnect && isTargetHandleTouched ? "border-main-orange" : "border-main-deep-grey");
     
    }
  }, [activatedNode, isOnConnect, isTargetHandleTouched])
  

  useEffect(() => {
    if (!contentRef.current) return;

    const resizeObserver = new ResizeObserver(entries => {
      // Prevent unnecessary updates by checking if size actually changed
      const { width, height } = entries[0].contentRect;
      
      // Only update if the size is different from current state
      setContentSize(prevSize => {
        if (prevSize.width !== width || prevSize.height !== height) {
          return { width, height };
        }
        return prevSize;
      });
    });

    resizeObserver.observe(contentRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // 管理labelContainer的宽度
  useEffect(() => {
    // const onLabelContainerFocus = () => {
    //   if (labelContainerRef.current) {
    //     if (contentRef.current) {
    //       labelContainerRef.current.style.width = `${contentRef.current.clientWidth - 16}px`
    //     }
    //   }
    // }

    const onLabelContainerBlur = () => {
      
      // if (isLocalEdit){
      //   console.log("rename label!!")
      //   console.log(isLocalEdit)
      //   setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
      //   setIsLocalEdit(false)
      // }
      if (labelContainerRef.current) {
        // labelContainerRef.current.style.width = `60px`
        // labelContainerRef.current.style.width = `fit-content`
        // if (contentRef.current) {
        //   labelContainerRef.current.style.maxWidth = `${contentRef.current.clientWidth - 32}px`
        // }
        setNodeUneditable(id)
      }

      // if (labelRef.current) {
      //   // labelContainerRef.current.style.width = `60px`
      //   // labelContainerRef.current.style.width = `fit-content`
      //   if (contentRef.current) {
      //     labelRef.current.style.maxWidth = `${contentRef.current.clientWidth - 55}px`
      //   }
      //   disallowEditLabel(id)
      // }
    }

    if (labelContainerRef.current) {
      // labelContainerRef.current.addEventListener("click", onLabelContainerFocus)
      // labelRef.current.addEventListener("blur", onLabelBlur)
      // document.addEventListener("click", (e: MouseEvent) => {
      //   if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
      //     onLabelContainerBlur()
      //   }
      // })

      document.addEventListener("click", (e: MouseEvent) => {
        if (!labelContainerRef.current?.contains(e.target as HTMLElement) && !(e.target as HTMLElement).classList.contains("renameButton")) {
          onLabelContainerBlur()
        }
      })
    }

    return () => {
      if (labelContainerRef.current) {
        // labelContainerRef.current.removeEventListener("click", onLabelContainerFocus)
        // labelRef.current.removeEventListener("blur", onLabelBlur)
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

  // height by default: 304px, inner-box: 240px, resize-control: 304px, without embedding
  // height with embedding: 336px, inner-box: 272px, resize-control: 336px


  // TODO Auto resize of content box
  // TODO dialogue selection of content atttribute(key onl y, no index) 
  // embeding view switch button
  const handleButtonClick = () => {
    setButtonText(prevText => prevText === "embedding view" ? "input view" : "embedding view"); // Toggle button text
  };

  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[240px] p-[32px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>

    
    <div ref={contentRef} id={id} className={`w-full h-full min-w-[176px] min-h-[176px] border-[1.5px] rounded-[8px] px-[8px] pt-[40px] pb-[8px]  ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden`}  >
          {
            buttonText=="embedding view"?
            <div style={{
              width: 'fit-content',
              maxWidth: calculateMaxLabelContainerWidth(),
            }}>
            {
              getNode(id)?.data?.chunks? JSON.stringify((getNode(id)?.data?.chunks)):<></>
            }
            </div>
            :
          <div className='w-full h-full'>
                {isLoading ? <SkeletonLoadingIcon /> : 
                            <JSONForm preventParentDrag={onFocus} allowParentDrag={onBlur} widthStyle={contentSize.width}
                            placeholder='["JSON"]'
                                    parentId={id}
                                    heightStyle={contentSize.height-1} />
                }
          </div>
          }
          


         
         <div ref={labelContainerRef} 
           style={{
            width: 'fit-content',
            maxWidth: calculateMaxLabelContainerWidth(),
           }}

            className={`absolute top-[40px] left-[40px] h-[24px] rounded-[4px]   px-[0px] flex items-center justify-center gap-[8px] z-[20000]`}>
<svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
             <path d="M5.5 4.5H8.5V7.5H5.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
             <path d="M5.5 16.5H8.5V19.5H5.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
             <path d="M11.5 16.5H14.5V19.5H11.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
             <path d="M11.5 10.5H14.5V13.5H11.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
             <path d="M5.5 10.5H8.5V13.5H5.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
             <path d="M11.5 4.5H14.5V7.5H11.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
           </svg>
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
           
          <input ref={labelRef}  autoFocus={editable} className={`flex items-center justify-start text-[#6D7177] font-[600] text-[12px] leading-[18px] font-plus-jakarta-sans bg-transparent h-[18px] focus:outline-none`}
            style={{
              boxSizing: "content-box",
              width: calculateInputWidth(),
              maxWidth: '100%',
              
            }}
            size={nodeLabel.length ?? 0}
            value={`${nodeLabel}`} readOnly={!editable} onChange={EditLabel} onMouseDownCapture={onFocus} onBlur={onBlur} />
           
          
            <button 
              onClick={handleButtonClick} 
              className="border border-main-deep-grey hover:border-main-blue hover:bg-gray-600 transition duration-200"
            >
              {buttonText}
            </button>
        </div>

        <NodeToolBar Parentnodeid={id} ParentNodetype={type}/>
      
        <NodeResizeControl 
          minWidth={240} 
          minHeight={240}
          style={{ position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize', 
            background: 'transparent',
            border: 'none' }}
        >
          <div 
            style={{
              position: "absolute",
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
              right: "36px",
              bottom: "36px",
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width:"26px",
              height:"26px",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#4599DF]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
              <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]"/>
            </svg>
          </div>
        </NodeResizeControl>

        
        {index_name && 
        <div className='absolute bottom-[40px] left-[40px] h-[16px] font-plus-jakarta-sans px-[4px] py-[3px] flex items-center justify-center rounded-[4px] border-[0.5px] border-solid border-[#3E3E41] bg-gradient-to-r from-[#E55D87] to-[#5FC3E4]
         text-main-black-theme text-[8px] font-bold'>Embedded</div>
        }
        
        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
            isConnectable={isConnectable} position={Position.Top}  />
            <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
            isConnectable={isConnectable}
            position={Position.Right}  />
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

export default JsonBlockNode