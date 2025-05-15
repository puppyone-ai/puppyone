import React, {useState, useRef, useEffect} from 'react';
import Editor, { EditorProps, loader, OnMount, OnChange, } from "@monaco-editor/react";
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useReactFlow } from '@xyflow/react';
// import { useMonacoTheme } from '../../hooks/useMonacoTheme';
// import { themeManager } from '../../hooks/themeManager';
type TextEditorProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    parentId: string,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
}


const TextEditor = ({preventParentDrag, 
                    allowParentDrag,
                    parentId, 
                    placeholder = "",
                    widthStyle = 0,
                    heightStyle=0}:TextEditorProps) => {

    // const [jsonValue, setJsonValue] = useState("");
        
    const [IsFocused, setIsFocused] = useState(false)
    const [isEmpty, setIsEmpty] = useState(true);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const {getNode, setNodes} = useReactFlow()
    const textEditorRef = useRef<HTMLDivElement>(null)
    // const applyTheme = useMonacoTheme(TEXT_EDITOR_THEME, textEditorThemeData)


    useEffect(() => {
      const parent = getNode(parentId)
      if (parent && parent.data.content) {
        setIsEmpty(false)
      }
      else {
        setIsEmpty(true)
      }
    }, [getNode(parentId)?.data.content])

  


    const updateNodeContent = (newValue: string) => {
      setNodes(prevNodes => (prevNodes.map(node => node.id === parentId ? {
        ...node,
        data: {...node.data, content: newValue}
      } : node)))
    }
   

    const handleChange: OnChange = (newValue: string | undefined) => {
      const isValueEmpty = !newValue || newValue.trim().length === 0;
      setIsEmpty(isValueEmpty);
      updateNodeContent(isValueEmpty ? "" : newValue);

      if (editorRef.current) {
        const editorElement = editorRef.current.getContainerDomNode();
        if (isValueEmpty) {
          editorElement.classList.add('hideLineNumbers');
        } else {
          editorElement.classList.remove('hideLineNumbers');
        }
      }
    };

      const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor
        editor.onDidFocusEditorWidget(() => {
          setIsFocused(true);
          preventParentDrag()
          
        });
    
        editor.onDidBlurEditorWidget(() => {
          setIsFocused(false);
          allowParentDrag()
      
        });


         // 初始化时检查是否为空
         const isValueEmpty = !editor.getValue().trim();
         setIsEmpty(isValueEmpty);
     
         const editorElement = editor.getContainerDomNode();
         if (isValueEmpty) {
           editorElement.classList.add('hideLineNumbers');
         }


         if (textEditorRef.current) {
          textEditorRef.current.classList.add('text-editor');
        }

      };

      const InputFallback = (e:any):string=>{
        console.error("get error input",e)
        return ""
      }

      


    

  return (
    <div ref={textEditorRef} className={`relative flex justify-start items-center rounded-[4px] cursor-pointer`}
    style={{width: widthStyle, height: heightStyle}}>
    {isEmpty && (
      <div className="absolute w-full h-full flex items-start justify-start text-center text-[#6D7177] text-[12px] font-[700] leading-normal pointer-events-none z-[10] font-plus-jakarta-sans">
        {placeholder}
      </div>
    )}
    <Editor
      className='text-editor'
      defaultLanguage="text"
      // theme={themeManager.getCurrentTheme()}
      width={widthStyle}
      height={heightStyle}
      onChange={handleChange}
      value= {typeof getNode(parentId)?.data.content === 'string' ? getNode(parentId)?.data.content as string: InputFallback(getNode(parentId)?.data.content)}
      options={{
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        unicodeHighlight: {
          ambiguousCharacters: false,
          invisibleCharacters: false,
          nonBasicASCII: false
        },
        fontLigatures: true,
        minimap: { enabled: false },
        scrollbar: {
          useShadows: false,
          horizontal: 'auto',
          vertical: 'auto',
          horizontalScrollbarSize: 8,
          verticalScrollbarSize: 8,
          horizontalSliderSize: 8,
          verticalSliderSize: 8,
          alwaysConsumeMouseWheel: true,
          arrowSize: 0,
          verticalHasArrows: false,
          horizontalHasArrows: false,
        },
        fontSize: 14,
        lineHeight: 24,
        letterSpacing:0,
        wordWrap: 'on',
        wordWrapColumn: 120,
        wrappingStrategy: 'advanced',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        lineNumbers: "off",
        overviewRulerLanes: 0,
        overviewRulerBorder: false,
        fixedOverflowWidgets: true,
        lineNumbersMinChars: 2,
        glyphMargin: false,
        lineDecorationsWidth: 0,
        folding: false,
        renderLineHighlight: 'none',
        hideCursorInOverviewRuler: true,
      }}
      onMount={handleEditorDidMount}
    />
    </div>
  );
};

export default TextEditor;