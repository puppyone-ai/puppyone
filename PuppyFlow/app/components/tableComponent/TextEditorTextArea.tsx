import React, { useCallback, useEffect, useRef, useState } from 'react'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils';
import { useReactFlow } from '@xyflow/react';
// import { useNodeContext } from '../../states/NodeContext';
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext';
import { setConfig } from 'next/config';

type TextEditorTextAreaProps = {
  preventParentDrag: () => void,
  allowParentDrag: () => void,
  parentId: string,
  placeholder?: string,
  widthStyle?: number,
  heightStyle?: number,
}

function TextEditorTextArea({preventParentDrag, 
  allowParentDrag,
  parentId, 
  placeholder = "",
  widthStyle = 0,
  heightStyle=0}: TextEditorTextAreaProps) {

    const {getNode, setNodes} = useReactFlow()
    const [text, setText] = useState(
      (getNode(parentId)?.data?.content as string) ?? ""
    );
    const [isEmpty, setIsEmpty] = useState(!(getNode(parentId)?.data.content as string) ? true : false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {lockZoom, freeZoom} = useManageReactFlowUtils()
  // const {searchNode, preventInactivateNode, allowInactivateNode} = useNodeContext()
  const {preventInactivateNode, allowInactivateNodeWhenClickOutside, isOnGeneratingNewNode} = useNodesPerFlowContext()
  const [isLocalEdit, setIsLocalEdit] = useState(false)
  const [scrollPosition, setScrollPosition] = useState(0);
  

  // when click sidebar panel, blur textarea and save text
  useEffect(() => {
    const handleWorkspacePanelEnter = () => {
      if (textareaRef.current) {
        textareaRef.current.blur()  // 这会自动触发onBlur事件，执行保存和allowInactivateNodeWhenClickOutside
      }
    }

    const workspacePanel = document.getElementById('workspace-manage-panel')
    
    if (workspacePanel) {
      workspacePanel.addEventListener('mouseenter', handleWorkspacePanelEnter)
    }

    return () => {
      if (workspacePanel) {
        workspacePanel.removeEventListener('mouseenter', handleWorkspacePanelEnter)
      }
    }
  }, []) // 不需要依赖text，因为onBlur会处理保存逻辑

 

  useEffect(() => {
    const content = getNode(parentId)?.data?.content
    if (content === undefined || content === null) return
    if (!isLocalEdit && text !== content) {
      setText(content as string)
      setIsEmpty(content === "")
    }
  }, [isLocalEdit, getNode(parentId)?.data?.content])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (isOnGeneratingNewNode) return
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
    if (isOnGeneratingNewNode) return
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

  // 添加保存滚动位置的函数
  const saveScrollPosition = useCallback(() => {
    if (textareaRef.current) {
      setScrollPosition(textareaRef.current.scrollTop);
    }
  }, []);

  // 添加恢复滚动位置的函数
  const restoreScrollPosition = useCallback(() => {
    if (textareaRef.current && scrollPosition > 0) {
      textareaRef.current.scrollTop = scrollPosition;
    }
  }, [scrollPosition]);

  // 在组件重新渲染后恢复滚动位置
  useEffect(() => {
    restoreScrollPosition();
  }, [restoreScrollPosition]);

  // when mouseEnter, prevent zooming in reactflow, also prevent parent drag
  const onMouseEnterActions = useCallback(() => {
    if (isOnGeneratingNewNode) return
    preventParentDrag()
    lockZoom()
    restoreScrollPosition()
  }, [isOnGeneratingNewNode, preventParentDrag, lockZoom, restoreScrollPosition])

  // when mouseLeave, absolutely can allow mouse drag node + allow pane zoom in / out freely
  const onMouseLeaveActions = useCallback(() => {
    if (isOnGeneratingNewNode) return
    allowParentDrag()
    freeZoom()
    saveScrollPosition()
  }, [isOnGeneratingNewNode, allowParentDrag, freeZoom, saveScrollPosition])


  // when focus, preventInactivateNode, but when onBlur allowInactivateNode
  return (
    <div style={{
      width: widthStyle,
      height: heightStyle,
      position: "relative",
      pointerEvents: isOnGeneratingNewNode ? 'none' : 'auto'
    }}>
      {isEmpty && (
      <div className=" absolute inset-0 flex items-start px-[4px] py-[0px] justify-start text-start text-[#6D7177] text-[14px] font-[400] leading-normal pointer-events-none font-plus-jakarta-sans break-words whitespace-pre-wrap">
        {placeholder}
      </div>
    )}
      <textarea ref={textareaRef}  className={`no-scrollbar bg-transparent text-[#CDCDCD] text-[14px] leading-[24px] font-plus-jakarta-sans border-none outline-none resize-none overflow-y-auto overflow-x-hidden w-full h-full whitespace-pre-wrap break-words`}
      value={text}
      onChange={handleChange} 
      onFocus={(e) => {
        e.preventDefault()
        e.stopPropagation()
        preventInactivateNode()
      }}
      onBlur={(e) => {
        e.preventDefault()
        e.stopPropagation()
        saveTextIntoNodeContent()
        saveScrollPosition()
        allowInactivateNodeWhenClickOutside()
      }}
      onMouseEnter={onMouseEnterActions} onMouseLeave={onMouseLeaveActions}/>
    </div>
    
  )
}

export default TextEditorTextArea