'use client'
import React, {useState, useRef, useEffect} from 'react';
// import Editor, { EditorProps, loader, OnMount, OnChange, } from "@monaco-editor/react";
// import Editor, { EditorProps, loader, OnMount, OnChange } from "@monaco-editor/react";
import type { EditorProps, OnMount, OnChange, } from "@monaco-editor/react";
import {loader} from "@monaco-editor/react";
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';
import dynamic from 'next/dynamic';
// import * as loader from '@monaco-editor/loader';
// import { useMonacoTheme } from '../../hooks/useMonacoTheme';
// import { themeManager } from '../../hooks/themeManager';

// 动态导入 Monaco Editor
// const Editor = dynamic(() => import("@monaco-editor/react"), {
//   ssr: false,
//   loading: () => <div className="w-full h-full bg-black"></div>
// });


const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false
});

type JSONConfigEditorProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    parentId: string,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
}
  

// // 为 TextEditor 组件定义一个固定的主题名称
// const TEXT_EDITOR_THEME = 'customTextEditorTheme';
// const JSON_FORM_THEME = 'customJsonFormTheme';
// const jsonFormThemeData: Monaco.editor.IStandaloneThemeData = {
//   base: 'vs-dark',
//   inherit: true,
//   rules: [],
//   colors: {
//     'editor.background': '#000000',
//   }
// }

const JSONConfigEditor = ({preventParentDrag, 
                    allowParentDrag, 
                    parentId,
                    placeholder = "",
                    widthStyle = 0,
                    heightStyle=0}:JSONConfigEditorProps) => {

    // const [jsonValue, setJsonValue] = useState("");
    const [isClient, setIsClient] = useState(false)
    const [IsFocused, setIsFocused] = useState(false)
    const [isEmpty, setIsEmpty] = useState(true);
    const {setNodes, getNode} = useReactFlow()
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const {getSourceNodeIdWithLabel} = useJsonConstructUtils()
    const variableRef = useRef<{id: string, label: string}[]>([])
    const jsonConfigEditorRef = useRef<HTMLDivElement>(null)
    // const applyTheme = useMonacoTheme(JSON_FORM_THEME, jsonFormThemeData)
    
    useEffect(() => {
      setIsClient(true)
    }, [])

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

      if (!isClient) return
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
              provideDocumentSemanticTokens: (model: Monaco.editor.ITextModel) => {
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
              provideCompletionItems: (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
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
        if (jsonConfigEditorRef.current) {
          jsonConfigEditorRef.current.classList.add('json-config-editor')
        }

        
          
        }
    

  return (
    <div ref={jsonConfigEditorRef} className={`relative flex flex-col border-[1px] rounded-[4px] cursor-pointer px-[9px] py-[8px] bg-black border-[#6D7177] ${IsFocused ? "outline-[#FFA73D] outline-4 -outline-offset-2 shadow-[0_0_0_1px_rgba(205,205,205)] border-[1px] border-[#CDCDCD] transition-all duration-300 ease-in-out": "" }`}
    style={{
      width: widthStyle,
      height: heightStyle
    }}>
    {isEmpty && (
      <div className="absolute top-0 left-0 w-full h-full flex items-start justify-start p-[8px] pl-[44px] text-[#6D7177] text-[12px] font-[500] leading-normal pointer-events-none z-[10] font-jetbrains-mono break-all">
        {placeholder}
      </div>
    )}
    <Editor
      className='json-config-editor'
      defaultLanguage="json"
      // theme={themeManager.getCurrentTheme()}
      width={widthStyle - 18}
      height={heightStyle - 16}
      onChange={handleChange}
      value={getNode(parentId)?.data.content as string}
      options={{
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
        lineNumbersMinChars: 3,
        glyphMargin: false,
        lineDecorationsWidth: 0, // 控制行号和正文的间距
      }}
      onMount={handleEditorDidMount}
    />
    </div>
  );
};

export default JSONConfigEditor;
