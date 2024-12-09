import React, {useState, useRef, useEffect} from 'react';
import Editor, { EditorProps, loader, OnMount, OnChange, } from "@monaco-editor/react";
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';

type ChangeableEditorProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
    editorType: 'text' | 'json',
    parentId: string,
}


const jsonOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'JetBrains Mono', monospace",
  fontLigatures: true,
  minimap: { enabled: false },
  scrollbar: {
    useShadows: false,
    horizontal: 'hidden', // 隐藏水平滚动条
    horizontalScrollbarSize: 0 // 设置水平滚动条大小为0
  },
  fontSize: 12,
  fontWeight: 'normal',
  lineHeight: 20,
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  fixedOverflowWidgets: true,
  acceptSuggestionOnEnter: "on",
  overviewRulerLanes: 0,  // 隐藏右侧的预览框
  lineNumbersMinChars: 2,
  glyphMargin: false,
  lineDecorationsWidth: 0, // 控制行号和正文的间距
}

const textOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  fontFamily: "'Plus Jakarta Sans', sans-serif",
  // fontFamily: "'JetBrains Mono', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', sans-serif",
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
}

const ChangeableEditor = ({preventParentDrag, 
                    allowParentDrag, 
                    editorType,
                    parentId,
                    placeholder = "",
                    widthStyle = 0,
                    heightStyle=0}:ChangeableEditorProps) => {

    // const [jsonValue, setJsonValue] = useState("");
        
    const [IsFocused, setIsFocused] = useState(false)
    const [isEmpty, setIsEmpty] = useState(true);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const {getNode, setNodes} = useReactFlow()
    const {getSourceNodeIdWithLabel} = useJsonConstructUtils()
    const variableRef = useRef<{id: string, label: string}[]>([])
    const ChangeableConfigEditorRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      const parent = getNode(parentId)
      if (parent && parent.data.content) {
        setIsEmpty(false)
      }
      else {
        setIsEmpty(true)
      }
    }, [getNode(parentId)?.data.content])

    useEffect(() => {
      variableRef.current = getSourceNodeIdWithLabel(parentId)
 
    }, [getSourceNodeIdWithLabel(parentId)])

    useEffect(() => {
      let disposeSemanticTokensProvider: Monaco.IDisposable | undefined;
      let disposeCompletionItemProvider: Monaco.IDisposable | undefined;
  
      const initMonaco = async () => {
          const monaco = await loader.init();
          
          // 清理之前的 provider
          if (disposeSemanticTokensProvider) {
              disposeSemanticTokensProvider.dispose();
          }
          if (disposeCompletionItemProvider) {
              disposeCompletionItemProvider.dispose();
          }
  
          // 注册自定义的语法高亮
          disposeSemanticTokensProvider = monaco.languages.registerDocumentSemanticTokensProvider('json', {
              getLegend: () => ({
                  tokenTypes: ['variable'],
                  tokenModifiers: []
              }),
              provideDocumentSemanticTokens: (model) => {
                  const tokens = [];
                  const text = model.getValue();
                  const regex = /\$no\.\d+/g;
                  let match;
                  while ((match = regex.exec(text)) !== null) {
                      const start = match.index;
                      const length = match[0].length;
                      const line = model.getPositionAt(start).lineNumber - 1;
                      const char = model.getPositionAt(start).column - 1;
                      tokens.push(line, char, length, 0, 0);
                  }
                  return { data: new Uint32Array(tokens) };
              },
              releaseDocumentSemanticTokens: () => {}
          });
  
          disposeCompletionItemProvider = monaco.languages.registerCompletionItemProvider('json', {
              provideCompletionItems: (model, position) => {
                  const textUntilPosition = model.getValueInRange({
                      startLineNumber: position.lineNumber,
                      startColumn: 1,
                      endLineNumber: position.lineNumber,
                      endColumn: position.column
                  });
                  const match = textUntilPosition.match(/\$$/);
                  if (match) {
                      return {
                          suggestions: variableRef.current.map(variable => ({
                              label: `"\${${variable.label}}"`,
                              kind: monaco.languages.CompletionItemKind.Variable,
                              insertText: `"\${${variable.label}}"`,
                              range: {
                                  startLineNumber: position.lineNumber,
                                  startColumn: position.column - 1,
                                  endLineNumber: position.lineNumber,
                                  endColumn: position.column
                              }
                          }))
                      };
                  }
                  return undefined;
              }
          });
      };
  
      initMonaco();
  
      return () => {
          if (disposeSemanticTokensProvider) {
              disposeSemanticTokensProvider.dispose();
          }
          if (disposeCompletionItemProvider) {
              disposeCompletionItemProvider.dispose();
          }
      };
  }, [parentId]); // 使用 parentId 和 getSourceNodes 作为依赖项

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
        //   console.log("Editor is now focused");
        });
    
        editor.onDidBlurEditorWidget(() => {
          setIsFocused(false);
          allowParentDrag()
        //   console.log("Editor lost focus");
        });

         // 初始化时检查是否为空
         const isValueEmpty = !editor.getValue().trim();
         setIsEmpty(isValueEmpty);
     
         const editorElement = editor.getContainerDomNode();
         if (isValueEmpty) {
           editorElement.classList.add('hideLineNumbers');
         }

         //  applyTheme(monaco)
        if (ChangeableConfigEditorRef.current) {
          if (editorType === "json") {
            ChangeableConfigEditorRef.current.classList.add('json-form')
          }
          else {
            ChangeableConfigEditorRef.current.classList.add('text-editor')
          }
        }
      };

      

      // 预加载 Monaco Editor
      // loader.init().then(monaco => {
        // monaco.editor.defineTheme('monicaCustomDark', {
        //   base: 'vs-dark',
        //   inherit: true,
        //   rules: [],
        //   colors: {
        //     'editor.background': '#1C1D1F',
        //     'editor.foreground': '#D4D4D4',
        //     'editorCursor.foreground': '#FFA73D',
        //     'editor.lineHighlightBackground': '#2F3031',
        //     'editorLineNumber.foreground': '#858585',
        //     'editor.selectionBackground': '#264F78',
        //     'editor.inactiveSelectionBackground': '#3A3D41'
        //   }
        // });
   
      // });
    

  return (
    <div ref={ChangeableConfigEditorRef} className={`relative flex flex-col border-[1px] rounded-[4px] cursor-pointer px-[9px] py-[8px] bg-black border-[#6D7177] ${IsFocused ? "outline-[#FFA73D] outline-4 -outline-offset-2 shadow-[0_0_0_1px_rgba(205,205,205)] border-[1px] border-[#CDCDCD] transition-all duration-300 ease-in-out": "" }`} 
    style={{
      width: widthStyle,
      height: heightStyle
    }}>
    {isEmpty && (
      <div className={`absolute w-full h-full flex items-start justify-start text-[#6D7177] bg-transparent text-[12px] leading-normal pointer-events-none z-[10] ${editorType === "json" ? "font-jetbrains-mono p-[8px] pl-[38px] top-0 left-0 font-[500]" : "font-plus-jakarta-sans font-[700]"}`}>
        {placeholder}
      </div>
    )}
    <Editor
      defaultLanguage={editorType}
      className={editorType === "json" ? "json-form" : "text-editor"}
      width={editorType === "json" ? widthStyle - 18 : widthStyle}
      height={editorType === "json" ? heightStyle - 16 : heightStyle}
      onChange={handleChange}
      value={getNode(parentId)?.data.content as string}
      options={editorType === "json" ? jsonOptions : textOptions}
      onMount={handleEditorDidMount}
    />
    </div>
  );
};

export default ChangeableEditor;