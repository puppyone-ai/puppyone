'use client'

import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteEditor, PartialBlock, Block } from '@blocknote/core';
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import useManageReactFlowUtils from "../../hooks/useManageReactFlowUtils";
import {useNodeContext} from "../../states/NodeContext";
import { isEqual } from "lodash";
import { useUploadThing, uploadFiles } from "../../../utils/uploadthing";


type TextEditorBlockNoteProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    parentId: string,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
}

function TextEditorBlockNote(
    {preventParentDrag, 
     allowParentDrag, 
     parentId, 
     placeholder = '[{"type": "paragraph", "content": "Text"}]', 
     widthStyle, 
     heightStyle}: TextEditorBlockNoteProps) {

    const {getNode, setNodes} = useReactFlow();
    const editorRef = useRef<HTMLDivElement>(null);
    const [content, setContent] = useState<string | undefined>(undefined);
    const [blocks, setBlocks] = useState<Block[]>([]);
    const {lockZoom, freeZoom} = useManageReactFlowUtils();
    const {preventInactivateNode, allowInactivateNode} = useNodeContext();
    const {startUpload} = useUploadThing('imageUploader')

    const editor: BlockNoteEditor = useCreateBlockNote(
      {
        uploadFile: async (file: File) => {
          const res = await startUpload([file])
          if (!res || res.length === 0) return ''
          return res[0].url
      },
    
    });

   

    useEffect(() => {
      // console.log("isLocalEdit", isLocalEdit, "parentId", getNode(parentId)?.data.content)
      
        const initialContent = getNode(parentId)?.data.content as string;
        async function loadInitialHTML(initialMarkdown: string) {
          // const blocks = await editor.tryParseMarkdownToBlocks(initialMarkdown);
          const blocks = await editor.tryParseHTMLToBlocks(initialMarkdown);
          if (!isEqual(editor.document, blocks)) {
            editor.replaceBlocks(editor.document, blocks);
          }
          
        }
        if (initialContent !== undefined) {
          loadInitialHTML(initialContent)
        }
      
    }, [getNode(parentId)?.data.content])

     // manage onWheel action on whole BlockNote editor
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault(); // 阻止默认滚动行为
    e.stopPropagation()

    // console.log(e.target, "e.target")

    if (editorRef.current) {
      const scrollContainer = editorRef.current.querySelector('.bn-container');
            if (scrollContainer) {
                // 计算新的滚动位置
                scrollContainer.scrollTop += e.deltaY;
            }
    }

  }, []);

  useEffect(() => {
    // 禁用整个页面的滚动
    document.body.style.overflow = 'hidden';
    if (editorRef.current) {
      const editorContainer = editorRef.current;
      editorContainer.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      document.body.style.overflow = 'auto';
      if (editorRef.current) {
        const editorContainer = editorRef.current;
        editorContainer.removeEventListener('wheel', handleWheel);
      }
    };
  }, [handleWheel]);

   // manage onWheel action on the dropdown menu bar with "slash"
  useEffect(() => {
    document.body.style.overflow = 'hidden';

    const handleSlashMenuScroll = (e: Event) => {
      e.stopPropagation();    // 阻止事件冒泡
      e.preventDefault();      // 阻止默认行为
      const menuElement = e.currentTarget as HTMLElement;
      menuElement.scrollTop += (e as WheelEvent).deltaY;
    }

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        const suggestionMenu = document.querySelector('.bn-suggestion-menu');
        if (suggestionMenu) {
          suggestionMenu.addEventListener('wheel', handleSlashMenuScroll);
        }
      });
    });
  
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  
    return () => {
      const suggestionMenu = document.querySelector('.bn-suggestion-menu');
      if (suggestionMenu) {
        suggestionMenu.removeEventListener('wheel', handleSlashMenuScroll);
      observer.disconnect()
      document.body.style.overflow = 'auto';
    }
  }
  }, []);

    // on content change, update the node content
    const onInputChanged = useCallback(
      async () => {
        // Whenever the current Markdown content changes, converts it to an array of
        // Block objects and replaces the editor's content with them.
        const content = editor.document;
        
        const markdown = await editor.blocksToMarkdownLossy(content);
        const html = await editor.blocksToHTMLLossy(content);
        setContent(html)
        // setContent(markdown)
        // console.log("html", html)
      },
      [editor]
    );

    const saveTextIntoNodeContent = useCallback(() => {
      return new Promise<void>((resolve) => {
        
      setNodes((nodes) => nodes.map((node) => {
            if (node.id === parentId) {
          return {...node, data: {...node.data, content: content}}
        }
        return node
      }))
      resolve()
    })
    }, [parentId, content])


      // when mouseEnter, prevent zooming in reactflow, also prevent parent drag
      const onMouseEnterActions = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        preventParentDrag()
        lockZoom()
    }, [])


    // when mouseLeave, absolutely can allow mouse drag node + allow pane zoom in / out freely
    const onMouseLeaveActions = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
        allowParentDrag()
        freeZoom()
        // if (textareaRef.current) {
        //   textareaRef.current.blur()
        // }
    }, [])

  return (
    <div 
    ref={editorRef}
    style={{width: widthStyle, height: heightStyle, overflow: 'hidden'}}
    onMouseEnter={onMouseEnterActions}
    onMouseLeave={onMouseLeaveActions}
    onFocus={() => preventInactivateNode(parentId)}
    onBlur={async () => {
      await saveTextIntoNodeContent()
      allowInactivateNode(parentId)
    }}
    >
    <BlockNoteView 
    className='w-full h-full overflow-y-scroll scroll-smooth'
    editor={editor} 
    editable={true}
    theme='dark'
    sideMenu={false}
    onSelectionChange={() => {
        const selection = editor.getSelection();

        // Get the blocks in the current selection and store on the state. If
        // the selection is empty, store the block containing the text cursor
        // instead.
        if (selection !== undefined) {
          setBlocks(selection.blocks);
        } else {
          setBlocks([editor.getTextCursorPosition().block]);
        }
      }}
      onChange={onInputChanged}
    />
    </div>
   
  )
}

export default TextEditorBlockNote