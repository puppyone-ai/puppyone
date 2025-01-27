'use client'
import { NodeProps, Node, Handle, Position, useReactFlow, NodeResizeControl } from '@xyflow/react'
import React, { useRef, useEffect, useState } from 'react'
import WhiteBallHandle from '../handles/WhiteBallHandle'
import NodeToolBar from './nodeTopRightBar/NodeTopRightBar'
import TextEditor from '../../tableComponent/TextEditor'
import TextEditorTextArea from '../../tableComponent/TextEditorTextArea'
import TextEditorTipTap from '../../tableComponent/TextEditorTipTap'
import useManageReactFlowUtils from '../../hooks/useManageReactFlowUtils'
import SkeletonLoadingIcon from '../../loadingIcon/SkeletonLoadingIcon'
import dynamic from 'next/dynamic'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'

export type TextBlockNodeData = {
  content: string,
  label: string,
  isLoading: boolean,
  locked: boolean,
  isInput: boolean,
  isOutput: boolean,
  editable: boolean,

}

type TextBlockNodeProps = NodeProps<Node<TextBlockNodeData>>

const TextEditorBlockNote = dynamic(() => import('../../tableComponent/TextEditorBlockNote'), { ssr: false })

function TextBlockNode({ isConnectable, id, type, data: { content, label, isLoading, locked, isInput, isOutput, editable } }: TextBlockNodeProps) {


  // const { addNode, deleteNode, activateNode, nodes, searchNode, inactivateNode, clear, isOnConnect, allowActivateNode, preventInactivateNode, allowInactivateNode, disallowEditLabel} = useNodeContext()
  const { getNode } = useReactFlow()
  const { activatedNode, isOnConnect, isOnGeneratingNewNode, setNodeUneditable, editNodeLabel, preventInactivateNode, allowInactivateNodeWhenClickOutside } = useNodesPerFlowContext()
  // const [isActivated, setIsActivated] = useState(false)
  const [isTargetHandleTouched, setIsTargetHandleTouched] = useState(false)
  const componentRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 })
  // const [self, setSelf] = useState<nodeState | null>(searchNode(id))
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




  // useEffect(() => {
  //   const addNodeAndSetFlag = async () => {
  //     // console.log(isAdd, id)
  //     // console.log(`I am waiting to add you node ${id}`)
  //     await addNode(id); // 假设 addNode 返回一个 Promise
  //     setIsAdd(true);
  //   };

  //   if (!isAdd) {
  //     const findnode = searchNode(id)
  //     if (findnode) {
  //       // console.log("have already create. no need to recreate")
  //       setIsAdd(true)
  //       allowActivateNode()
  //       return
  //     }
  //     addNodeAndSetFlag();
  //     allowActivateNode()
  //   }

  //   if (isAdd){
  //     setSelf(searchNode(id))
  //   }

  // }, [isAdd, id]);


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
    const currentLabel = getNode(id)?.data?.label as string | undefined
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
    if (isLocalEdit) {
      //  管理 node label onchange，只有 onBlur 的时候，才会更新 label
      // setNodes(nodes => nodes.map(node => node.id === id ? { ...node, data: { ...node.data, label: nodeLabel } } : node))
      editNodeLabel(id, nodeLabel)
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


  // for rendering diffent logo of upper right tag
  const renderTagLogo = () => {
    if (locked) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="12" width="12" height="7" fill="#3EDBC9" />
        <rect x="6" y="6" width="8" height="11" rx="4" stroke="#3EDBC9" stroke-width="2" />
      </svg>
    )
    else if (isInput) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.5 14V10L11.1667 12L8.5 14Z" fill="#6C98D5" stroke="#6C98D5" />
        <path d="M9 11.9961L4 12.001" stroke="#6C98D5" stroke-width="2" />
        <path d="M13.5 7H9.5V5.5H15.5V18.5H9.5V17H13.5H14V16.5V7.5V7H13.5Z" fill="#6C98D5" stroke="#6C98D5" />
      </svg>

    )
    else if (isOutput) return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 14V10L15.1667 12L12.5 14Z" fill="#FF9267" stroke="#FF9267" />
        <path d="M13 11.9961L8 12.001" stroke="#FF9267" stroke-width="2" />
        <path d="M6.5 7H10.5V5.5H4.5V18.5H10.5V17H6.5H6V16.5V7.5V7H6.5Z" fill="#FF9267" stroke="#FF9267" />
      </svg>
    )
    else return (
      <svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="group">
        <path d="M5.5 4.5H8.5V7.5H5.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M5.5 16.5H8.5V19.5H5.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M11.5 16.5H14.5V19.5H11.5V16.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M11.5 10.5H14.5V13.5H11.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M5.5 10.5H8.5V13.5H5.5V10.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
        <path d="M11.5 4.5H14.5V7.5H11.5V4.5Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
      </svg>
    )
  }

  // 计算 labelContainer 的 最大宽度，最大宽度是由外部的container 的宽度决定的，同时需要减去 32px, 因为右边有一个menuIcon, 需要 - 他的宽度和右边的padding
  const calculateMaxLabelContainerWidth = () => {
    if (contentRef.current) {
      return `${contentRef.current.clientWidth - 48}px`
    }
    return '100%'
  }


  return (
    <div ref={componentRef} className={`relative w-full h-full min-w-[240px] min-h-[176px] ${isOnGeneratingNewNode ? 'cursor-crosshair' : 'cursor-default'}`}>
      <div ref={contentRef} id={id} className={`w-full h-full border-[1.5px] min-w-[240px] min-h-[176px] rounded-[16px] px-[8px] pt-[8px] pb-[4px] ${borderColor} text-[#CDCDCD] bg-main-black-theme break-words font-plus-jakarta-sans text-base leading-5 font-[400] overflow-hidden flex flex-col`}>

        {/* the top bar of a block */}
        <div ref={labelContainerRef}
          className={`h-[24px] w-full rounded-[4px]  flex items-center justify-between mb-2`}>

          {/* top-left wrapper */}
          <div className="flex items-center gap-[8px] hover:cursor-grab active:cursor-grabbing group"
            style={{
              maxWidth: calculateMaxLabelContainerWidth(),
            }}>
            <div className="min-w-[20px] min-h-[24px] flex items-center justify-center group-hover:text-[#CDCDCD] group-active:text-[#4599DF]">
              {renderTagLogo()}
            </div>

            {/* measure label width span */}
            <span
              ref={measureSpanRef}
              style={{
                visibility: 'hidden',
                position: 'absolute',
                whiteSpace: 'pre',
                fontSize: '12px',
                lineHeight: '18px',
                fontWeight: '700',
                fontFamily: 'Plus Jakarta Sans',
              }}>
              {nodeLabel}
            </span>

            {editable ? (
              <input 
                ref={labelRef}
                autoFocus={editable}
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans bg-transparent h-[18px] 
                  focus:outline-none truncate w-full
                  ${locked ? 'text-[#3EDBC9] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]' : 'text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'}
                `}
                value={nodeLabel}
                readOnly={!editable}
                onChange={(e) => {
                  setIsLocalEdit(true);
                  setNodeLabel(e.target.value);
                }}
                onMouseDownCapture={onFocus}
                onBlur={onBlur}
              />
            ) : (
              <span 
                className={`
                  flex items-center justify-start 
                  font-[600] text-[12px] leading-[18px] 
                  font-plus-jakarta-sans truncate w-fit
                  ${locked ? 'text-[#3EDBC9] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]' : 'text-[#6D7177] group-hover:text-[#CDCDCD] group-active:text-[#4599DF]'}
                `}
              >
                {nodeLabel}
              </span>
            )}
          </div>

          {/* top-right toolbar */}
          <div className="min-w-[24px] min-h-[24px] flex items-center justify-center">
            <NodeToolBar Parentnodeid={id} ParentNodetype={type} />
          </div>
        </div>

        {/* the plain text editor */}
        <div className="px-[8px] flex-1">
          {isLoading ? <SkeletonLoadingIcon /> :
            <TextEditorTextArea
              preventParentDrag={preventNodeDrag}
              allowParentDrag={allowNodeDrag}
              widthStyle={contentSize.width - 16} // 减去左右padding (16px)
              heightStyle={contentSize.height - 32}
              placeholder='Text'
              parentId={id}
            />
          }
        </div>


        {/* <TextEditorTipTap preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='Text' parentId={id} /> */}

        {/* Rich text editor */}
        {/* <TextEditorBlockNote preventParentDrag={preventNodeDrag} allowParentDrag={allowNodeDrag}
          widthStyle={contentSize.width} heightStyle={contentSize.height}
          placeholder='[{"type": "paragraph", "content": "Text"}]' parentId={id} /> */}





        {/* the resizer in the bottom right corner */}
        <NodeResizeControl
          minWidth={240}
          minHeight={176}
          style={{
            position: 'absolute', right: "0px", bottom: "0px", cursor: 'se-resize',
            background: 'transparent',
            border: 'none'
          }}
        >
          <div
            style={{
              position: "absolute",
              visibility: `${activatedNode?.id === id ? "visible" : "hidden"}`,
              right: "0px",
              bottom: "0px",
              display: "flex",
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'transparent',
              zIndex: "200000",
              width: "26px",
              height: "26px",
            }}
          >
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="group active:group-[]:fill-[#4599DF]">
              <path d="M10 5.99998H12V7.99998H10V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M10 2H12V4H10V2Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M6 5.99998H8V7.99998H6V5.99998Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M6 10H8V12H6V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M2 10H4V12H2V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
              <path d="M10 10H12V12H10V10Z" className="fill-[#6D7177] group-hover:fill-[#CDCDCD] group-active:fill-[#4599DF]" />
            </svg>
          </div>
        </NodeResizeControl>

        <WhiteBallHandle id={`${id}-a`} type="source" sourceNodeId={id}
          isConnectable={isConnectable} position={Position.Top} />
        <WhiteBallHandle id={`${id}-b`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Right} />
        <WhiteBallHandle id={`${id}-c`} type="source" sourceNodeId={id} isConnectable={isConnectable} position={Position.Bottom} />
        <WhiteBallHandle id={`${id}-d`} type="source" sourceNodeId={id}
          isConnectable={isConnectable}
          position={Position.Left} />
        {/* <Handle
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
        />   */}
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

export default TextBlockNode