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

// const TEXT_EDITOR_THEME = 'textEditorTheme'
// const textEditorThemeData: Monaco.editor.IStandaloneThemeData = {
//   base: 'vs-dark',
//   inherit: true,
//   rules: [],
//   colors: {
//     'editor.background': '#1C1D1F',
//    'editor.foreground': '#CDCDCD',
//    'editorCursor.foreground': '#CDCDCD',
//    'editor.lineHighlightBackground': '#1C1D1F', // 确保行高亮背景色一致
//    'editorLineNumber.foreground': '#1C1D1F',
//    'editor.selectionBackground': '#1C1D1F',
//    'scrollbar.shadow': '#1C1D1F',
//    'editor.inactiveSelectionBackground': '#1C1D1F',
//    'editorLineNumber.activeForeground': '#1C1D1F', // 确保活动行号颜色一致
//    'editorGutter.background': '#1C1D1F', // 确保行号区域背景色一致
//    'editor.lineHighlightBorder': '#1C1D1F', // 确保行高亮边框颜色一致
//    'editorWidget.border': '#1C1D1F', // 确保编辑器小部件边框颜色一致
//    'editorWidget.background': '#1C1D1F', // 确保编辑器小部件背景色一致
//    'editorSuggestWidget.background': '#1C1D1F', // 确保建议小部件背景色一致
//    'editorSuggestWidget.border': '#1C1D1F', // 确保建议小部件边框颜色一致
//    'editorHoverWidget.background': '#1C1D1F', // 确保悬停小部件背景色一致
//    'editorHoverWidget.border': '#1C1D1F', // 确保悬停小部件边框颜色一致
//   }
// }

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


          // 定义并应用自定义主题
          // monaco.editor.defineTheme('textEditorTheme', {
          //   base: 'vs-dark',
          //   inherit: true,
          //   rules: [],
          //   colors: {
          //     'editor.background': '#1C1D1F',
          //    'editor.foreground': '#CDCDCD',
          //    'editorCursor.foreground': '#CDCDCD',
          //    'editor.lineHighlightBackground': '#1C1D1F', // 确保行高亮背景色一致
          //    'editorLineNumber.foreground': '#1C1D1F',
          //    'editor.selectionBackground': '#1C1D1F',
          //    'scrollbar.shadow': '#1C1D1F',
          //    'editor.inactiveSelectionBackground': '#1C1D1F',
          //    'editorLineNumber.activeForeground': '#1C1D1F', // 确保活动行号颜色一致
          //    'editorGutter.background': '#1C1D1F', // 确保行号区域背景色一致
          //    'editor.lineHighlightBorder': '#1C1D1F', // 确保行高亮边框颜色一致
          //    'editorWidget.border': '#1C1D1F', // 确保编辑器小部件边框颜色一致
          //    'editorWidget.background': '#1C1D1F', // 确保编辑器小部件背景色一致
          //    'editorSuggestWidget.background': '#1C1D1F', // 确保建议小部件背景色一致
          //    'editorSuggestWidget.border': '#1C1D1F', // 确保建议小部件边框颜色一致
          //    'editorHoverWidget.background': '#1C1D1F', // 确保悬停小部件背景色一致
          //    'editorHoverWidget.border': '#1C1D1F', // 确保悬停小部件边框颜色一致
          //   }
          // });
          // monaco.editor.setTheme('textEditorTheme');
          // applyTheme(monaco)


      };

      const InputFallback = (e:any):string=>{
        console.error("get error input",e)
        return ""
      }

      


    

  return (
    <div ref={textEditorRef} className={`relative flex  justify-center items-center rounded-[4px] cursor-pointer  bg-[#1C1D1F] `}
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
          horizontal: 'hidden', // 隐藏水平滚动条
          vertical: 'hidden', // 隐藏垂直滚动条
          horizontalScrollbarSize: 0, // 设置水平滚动条大小为0
          verticalScrollbarSize: 0, // 设置垂直滚动条大小为0
        },
        fontSize: 12,
        lineHeight: 20,
        letterSpacing:0,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        lineNumbers: "off",
        overviewRulerLanes: 0,  // 隐藏右侧的预览框
        overviewRulerBorder: false, // 隐藏概览标尺的边框
        fixedOverflowWidgets: true, // 固定溢出小部件
        lineNumbersMinChars: 2,
        glyphMargin: false,
        lineDecorationsWidth: 0, // 控制行号和正文的间距
        folding: false,
        renderLineHighlight: 'none', // 隐藏行高亮
        hideCursorInOverviewRuler: true, // 隐藏光标在概览标尺中的显示
      }}
      onMount={handleEditorDidMount}
    />
    </div>
  );
};

export default TextEditor;