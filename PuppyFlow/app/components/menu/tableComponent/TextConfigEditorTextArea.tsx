import React, { useCallback, useEffect, useRef, useState } from 'react'
import useManageReactFlowUtils from '../../hooks/useManageReactFlowUtils';
import { useReactFlow } from '@xyflow/react';
import { useNodeContext } from '../../states/NodeContext';

type TextConfigEditorTextAreaProps = {
  preventParentDrag: () => void,
  allowParentDrag: () => void,
  parentId: string,
  placeholder?: string,
  widthStyle?: number,
  heightStyle?: number,
}

function TextConfigEditorTextArea({preventParentDrag, 
  allowParentDrag,
  parentId, 
  placeholder = "",
  widthStyle = 0,
  heightStyle=0}: TextConfigEditorTextAreaProps) {

    const {getNode, setNodes} = useReactFlow()
    const [text, setText] = useState(
      (getNode(parentId)?.data?.content as string) ?? ""
    );
    const [isEmpty, setIsEmpty] = useState(!(getNode(parentId)?.data.content as string) ? true : false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {lockZoom, freeZoom} = useManageReactFlowUtils()
  const {searchNode, preventInactivateNode, allowInactivateNode} = useNodeContext()
  const [isLocalEdit, setIsLocalEdit] = useState(false)
  
 

  useEffect(() => {
    const content = getNode(parentId)?.data?.content
    if (content === undefined || content === null) return
    if (!isLocalEdit && text !== content) {
      setText(content as string)
      setIsEmpty(content === "")
    }
  }, [isLocalEdit, getNode(parentId)?.data?.content])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (textareaRef.current) {
      setIsLocalEdit(true)
      const curTextVal = textareaRef.current.value
      const isValueEmpty = !curTextVal || curTextVal.trim().length === 0;
      setIsEmpty(isValueEmpty);
      setText(isValueEmpty ? "" : curTextVal);
    }
    
  };

  const saveTextIntoNodeContent = () => {
    if (isLocalEdit){
      setNodes(prevNodes => prevNodes.map(
        (node) => {
          if (node.id === parentId) {
            return {...node, data: {...node.data, content: text}}
          }
          return node
        }
      ))
      setIsLocalEdit(false)
    }
  }

  // manage onWheel action
  const handleWheel = (e: WheelEvent) => {
    e.preventDefault(); // 阻止默认滚动行为
    e.stopPropagation()

    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const lineHeight = parseInt(getComputedStyle(textarea).lineHeight);
      const scrollAmount = e.deltaY > 0 ? lineHeight : -lineHeight;

      textarea.scrollTop += scrollAmount;
    }

  };

  useEffect(() => {
    // 禁用整个页面的滚动
    document.body.style.overflow = 'hidden';
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      document.body.style.overflow = 'auto';
      if (textareaRef.current) {
        const textarea = textareaRef.current;
        textarea.removeEventListener('wheel', handleWheel);
      }
    };
  }, []);

  // when mouseEnter, prevent zooming in reactflow, also prevent parent drag
  const onMouseEnterActions = useCallback(() => {
    preventParentDrag()
    lockZoom()
  }, [])

  // when mouseLeave, absolutely can allow mouse drag node + allow pane zoom in / out freely
  const onMouseLeaveActions = useCallback(() => {
    allowParentDrag()
    freeZoom()
    // if (textareaRef.current) {
    //   textareaRef.current.blur()
    // }
  }, [])


  // when focus, preventInactivateNode, but when onBlur allowInactivateNode
  return (
    <div style={{
      width: widthStyle,
      height: heightStyle,
      border: "1px solid #6D7177",
      borderRadius: "4px",
      backgroundColor: "#000000",
      padding: "16px",
      position: "relative"
    }}>
      {isEmpty && (
      <div className=" absolute p-[16px] inset-0 flex items-start justify-start text-start text-[#6D7177] text-[12px] font-[700] leading-normal pointer-events-none font-plus-jakarta-sans break-words whitespace-pre-wrap">
        {placeholder}
      </div>
    )}
      <textarea ref={textareaRef}  className='no-scrollbar bg-transparent text-[#CDCDCD] text-[12px] font-plus-jakarta-sans border-none outline-none resize-none overflow-y-auto overflow-x-hidden w-full h-full whitespace-pre-wrap break-words ' 
      value={text}
      onChange={handleChange} 
      onFocus={() => preventInactivateNode(parentId)}
      onBlur={() => {
        saveTextIntoNodeContent()
        allowInactivateNode(parentId)
      }}
      onMouseEnter={onMouseEnterActions} onMouseLeave={onMouseLeaveActions}/>
    </div>
    
  )
}

export default TextConfigEditorTextArea