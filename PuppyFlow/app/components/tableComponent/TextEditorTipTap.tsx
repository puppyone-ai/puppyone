'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import Heading from '@tiptap/extension-heading'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import { TipTapMenuBar } from './TipTapMenuBar'
import { SlashCommands } from './SlashCommands'
import useManageReactFlowUtils from '../hooks/useManageReactFlowUtils';
import { useReactFlow } from '@xyflow/react';
// import { useNodeContext } from '../../states/NodeContext';
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext';
import React,{ useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import RichEditorSideBarMenuController from './RichEditorSideBarMenuController';
import { ReactNodeViewRenderer } from '@tiptap/react';

type TextEditorTipTapProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    parentId: string,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
}

const TextEditorTipTap = ({preventParentDrag, 
        allowParentDrag,
        parentId, 
        placeholder = "",
        widthStyle = 0,
        heightStyle=0}: TextEditorTipTapProps) => {

        const {getNode, setNodes} = useReactFlow()
        const [text, setText] = useState(
            (getNode(parentId)?.data?.content as string) ?? ""
        );
        const editorContainerRef = useRef<HTMLDivElement>(null)
        const [isEmpty, setIsEmpty] = useState(!(getNode(parentId)?.data.content as string) ? true : false);
        const {lockZoom, freeZoom} = useManageReactFlowUtils()
        // const {searchNode, preventInactivateNode, allowInactivateNode} = useNodeContext()
        const {preventInactivateNode, allowInactivateNodeWhenClickOutside, isOnGeneratingNewNode} = useNodesPerFlowContext()
        const [isLocalEdit, setIsLocalEdit] = useState(false)
        const [isZoomLocked, setIsZoomLocked] = useState(false)



  useEffect(() => {
    const content = getNode(parentId)?.data?.content
    console.log("isLocalEdit", isLocalEdit, "text", text, "content", content)
    
    if (content === undefined || content === null) return
    if (!isLocalEdit && text !== content) {
      console.log("content", content, "text", text)
      
      setText(content as string)
      setIsEmpty(content === "")
      // setTimeout(() => {
      //   // 将最新loading内容更新到editor中，然后focus到editor的最后
        
      // }, 0)
      editor?.commands.setContent(content as string)
      editor?.commands.focus('end')
    
    }
  }, [isLocalEdit, getNode(parentId)?.data?.content])

  useEffect(() => {
    if (isLocalEdit) {
      console.log("isLocalEdit", isLocalEdit, "text", text, "!!!! important")
      setNodes(prevNodes => prevNodes.map(
        (node) => {
          if (node.id === parentId) {
            return {...node, data: {...node.data, content: text}}
          }
          return node
        }
      ))
    }
  }, [text, isLocalEdit])

  const handleChange = (event: any) => {
    if (editor) {
      setIsLocalEdit(true)
      const curTextVal = (event.target as HTMLElement).innerHTML
      const isValueEmpty = !curTextVal || curTextVal.trim().length === 0;
      setIsEmpty(isValueEmpty);
      setText(isValueEmpty ? "" : curTextVal);
    }
    
  };

  // const saveTextIntoNodeContent = () => {
  //   if (isLocalEdit){
  //     setNodes(prevNodes => prevNodes.map(
  //       (node) => {
  //         if (node.id === parentId) {
  //           return {...node, data: {...node.data, content: text}}
  //         }
  //         return node
  //       }
  //     ))
  //     setIsLocalEdit(false)
  //   }
  // }

  useEffect(() => {
    if (isZoomLocked) {
      lockZoom();
    } else {
      freeZoom();
    }
  }, [isZoomLocked]);

  // manage onWheel action
//   const handleWheel = (e: WheelEvent) => {
//     e.preventDefault(); // 阻止默认滚动行为
//     e.stopPropagation()

//     if (editorContainerRef.current) {
//       const editorContainer = editorContainerRef.current;
//       const lineHeight = parseInt(getComputedStyle(editorContainer).lineHeight);
//       const scrollAmount = e.deltaY > 0 ? lineHeight : -lineHeight;

//       editorContainer.scrollTop += scrollAmount;
//     }

//   };

//   useEffect(() => {
//     // 禁用整个页面的滚动
//     document.body.style.overflow = 'hidden';
//     if (editorContainerRef.current) {
//       editorContainerRef.current.addEventListener('wheel', handleWheel, { passive: false });
//     }
//     return () => {
//       document.body.style.overflow = 'auto';
//       if (editorContainerRef.current) {
//         editorContainerRef.current.removeEventListener('wheel', handleWheel);
//       }
//     };
//   }, []);

  // when mouseEnter, prevent zooming in reactflow, also prevent parent drag
  const onMouseEnterActions = useCallback(() => {
    console.log("onMouseEnter!!")
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

  // 首先创建一个通用的 NodeView 渲染器
const createBlockNodeView = (setIsLocalEdit: any, preventParentDrag: any, allowParentDrag: any) => {
  return ReactNodeViewRenderer((props) => (
    <RichEditorSideBarMenuController 
      setIsLocalEdit={setIsLocalEdit}
      preventParentDrag={preventParentDrag} 
      allowParentDrag={allowParentDrag} 
      {...props} 
    />
  ))
}

  const editor = useEditor({
    content: text,
    injectCSS: false,
    extensions: [
      StarterKit,
      SlashCommands,
      Document.extend({
        content: 'block+',
      }),
      Paragraph.extend({
        addNodeView() {
          return createBlockNodeView(setIsLocalEdit, preventParentDrag, allowParentDrag)
        }
      }),
      Text,
      Heading.configure({
        levels: [1, 2, 3],
      }),
      // Heading.configure({
      //   levels: [1, 2, 3],
      // }),
      Placeholder.configure({
        placeholder: 'Text',
        showOnlyWhenEditable: true,
        emptyEditorClass: 'is-editor-empty',
        emptyNodeClass: 'is-empty',
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      // TaskList.extend({
      //   addNodeView() {
      //     return createBlockNodeView(setIsLocalEdit, preventParentDrag, allowParentDrag)
      //   }
      // }),
      Highlight,
    ],
    onUpdate: ({editor}) => {
       
        setIsLocalEdit(true)
        const curTextVal = editor.getHTML()
        const isValueEmpty = !curTextVal || curTextVal.trim().length === 0;
        setIsEmpty(isValueEmpty);
        setText(isValueEmpty ? "" : curTextVal);
        // editor.commands.focus('end')
    },
    editorProps: {
      attributes: {
        class: 'font-plus-jakarta-sans mx-auto focus:outline-none cursor-text',
      },
      
        handleDOMEvents: {
            // wheel: (view, event) => {
            //     event.preventDefault();
            //     event.stopPropagation();
            
                
            //     if (editorContainerRef.current) {
            //     const editorContainer = editorContainerRef.current;
            //     const lineHeight = parseInt(getComputedStyle(editorContainer).lineHeight);
            //     const scrollAmount = event.deltaY > 0 ? lineHeight : -lineHeight;
            //     editorContainer.scrollTop += scrollAmount;
            //     }
                
            // return false
            // },
        }
    
  },
  autofocus: 'end',
  editable: true,
  immediatelyRender: false
  })

  if (!editor) return null

  return (
    <div ref={editorContainerRef} className="notion-editor" style={{
      width: widthStyle,
      height: heightStyle,
      position: "relative",
      overflow: "hidden auto",
    }}
    >
      <TipTapMenuBar editor={editor} />
      {/* <div className="editor-wrapper" style={{
        height: 'calc(100% - 40px)', // 减去菜单栏的高度
        overflow: 'auto',
        opacity: 0,
      }} /> */}
      <EditorContent
        className='no-scrollbar bg-transparent text-[#CDCDCD] text-[12px] font-plus-jakarta-sans border-none outline-none resize-none  w-full h-full whitespace-pre-wrap break-words cursor-text overflow-x-hidden overflow-y-scroll '
        value={text}
       editor={editor} 
       onFocus={(e) => {
        e.preventDefault()
        e.stopPropagation()
        preventInactivateNode()
       }}
       onBlur={(e) => {
        e.preventDefault()
        e.stopPropagation()
        //  saveTextIntoNodeContent()
         allowInactivateNodeWhenClickOutside()
       }}
    />
       
    </div>
  )
}

export default TextEditorTipTap
