'use client'
import React, {useState, useRef, useEffect} from 'react';
// import Editor, { EditorProps, loader, OnMount, OnChange, } from "@monaco-editor/react";
import type { EditorProps, OnMount, OnChange, } from "@monaco-editor/react";
import {loader} from "@monaco-editor/react";
import dynamic from 'next/dynamic';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useReactFlow } from '@xyflow/react';
import useJsonConstructUtils from '../hooks/useJsonConstructUtils';
import {useNodesPerFlowContext} from '../states/NodesPerFlowContext';

const Editor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false
});


type JSONEditorProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    parentId: string,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
    inputvalue?:string,
    readonly?:boolean,
    synced?:boolean
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

const JSONForm = ({preventParentDrag, 
                    allowParentDrag, 
                    parentId,
                    placeholder = "",
                    widthStyle = 0,
                    heightStyle=0,
                    inputvalue="",
                    readonly=false,
                    synced=false
                  }:JSONEditorProps) => {

    // const [jsonValue, setJsonValue] = useState("");
        
    const [IsFocused, setIsFocused] = useState(false)
    const [isEmpty, setIsEmpty] = useState(true);
    const {setNodes, getNode} = useReactFlow()
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const {getSourceNodeIdWithLabel} = useJsonConstructUtils()
    const variableRef = useRef<{id: string, label: string}[]>([])
    const jsonFormRef = useRef<HTMLDivElement>(null)
    const {isOnGeneratingNewNode} = useNodesPerFlowContext()
    // const applyTheme = useMonacoTheme(JSON_FORM_THEME, jsonFormThemeData)
    useEffect(() => {
      const parent = getNode(parentId)
      if (parent && parent.data.content) {
        setIsEmpty(false)
      }
      else {
        setIsEmpty(true)
      }
    }, [getNode(parentId)?.data.content])


    // useEffect(() => {
    //   console.log("onTrigger !!")
    //   variableRef.current = getSourceNodeIdWithLabel(parentId)
 
    // }, [getSourceNodeIdWithLabel(parentId).map(item => item.label)])

  //   useEffect(() => {
  //     let disposeSemanticTokensProvider: Monaco.IDisposable | undefined;
  //     let disposeCompletionItemProvider: Monaco.IDisposable | undefined;
  
  //     const initMonaco = async () => {
  //         const monaco = await loader.init();
          
  //         // 清理之前的 provider
  //         if (disposeSemanticTokensProvider) {
  //             disposeSemanticTokensProvider.dispose();
  //         }
  //         if (disposeCompletionItemProvider) {
  //             disposeCompletionItemProvider.dispose();
  //         }
  
  //         // 注册自定义的语法高亮
  //         disposeSemanticTokensProvider = monaco.languages.registerDocumentSemanticTokensProvider('json', {
  //             getLegend: () => ({
  //                 tokenTypes: ['variable'],
  //                 tokenModifiers: []
  //             }),
  //             provideDocumentSemanticTokens: (model) => {
  //                 const tokens = [];
  //                 const text = model.getValue();
  //                 const regex = /\$no\.\d+/g;
  //                 let match;
  //                 while ((match = regex.exec(text)) !== null) {
  //                     const start = match.index;
  //                     const length = match[0].length;
  //                     const line = model.getPositionAt(start).lineNumber - 1;
  //                     const char = model.getPositionAt(start).column - 1;
  //                     tokens.push(line, char, length, 0, 0);
  //                 }
  //                 return { data: new Uint32Array(tokens) };
  //             },
  //             releaseDocumentSemanticTokens: () => {}
  //         });
  
  //         disposeCompletionItemProvider = monaco.languages.registerCompletionItemProvider('json', {
  //             provideCompletionItems: (model, position) => {
  //                 const textUntilPosition = model.getValueInRange({
  //                     startLineNumber: position.lineNumber,
  //                     startColumn: 1,
  //                     endLineNumber: position.lineNumber,
  //                     endColumn: position.column
  //                 });
  //                 const match = textUntilPosition.match(/\$$/);
  //                 if (match) {
  //                     return {
  //                         suggestions: variableRef.current.map(variable => ({
  //                             label: `$no.${variable}`,
  //                             kind: monaco.languages.CompletionItemKind.Variable,
  //                             insertText: `"\${no.${variable}}"`,
  //                             range: {
  //                                 startLineNumber: position.lineNumber,
  //                                 startColumn: position.column - 1,
  //                                 endLineNumber: position.lineNumber,
  //                                 endColumn: position.column
  //                             }
  //                         }))
  //                     };
  //                 }
  //                 return undefined;
  //             }
  //         });
  //     };
  
  //     initMonaco();
  
  //     return () => {
  //         if (disposeSemanticTokensProvider) {
  //             disposeSemanticTokensProvider.dispose();
  //         }
  //         if (disposeCompletionItemProvider) {
  //             disposeCompletionItemProvider.dispose();
  //         }
  //     };
  // }, [parentId]); // 使用 parentId 和 getSourceNodes 作为依赖项
  

    const updateNodeContent = (newValue: string) => {
      console.log("synced",synced,newValue)
      if(synced===true){
        console.log("update editor change")
        setNodes(prevNodes => (prevNodes.map(node => node.id === parentId ? {
          ...node,
          data: {...node.data, content: newValue}
        } : node)))
      }
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
        if (jsonFormRef.current) {
          jsonFormRef.current.classList.add('json-form')
        }
          
        }


      const InputFallback = (e:any):string=>{
        console.error("get error input:",e)
        return ""
      }

      
    

  return (
    <div ref={jsonFormRef} className={`relative flex flex-col border-none rounded-[8px] cursor-pointer pl-[2px] pt-[8px] bg-[#1C1D1F] ${isOnGeneratingNewNode ? 'pointer-events-none' : ''}`}
    style={{
      width: widthStyle,
      height: heightStyle,
      opacity: isOnGeneratingNewNode ? '0.7' : '1'
    }}>
    {isEmpty && (
      <div className="absolute top-0 left-0 w-full h-full flex items-start justify-start p-[8px] pl-[44px] text-[#6D7177] bg-transparent text-[14px] font-[500] leading-normal pointer-events-none z-[10] font-jetbrains-mono">
        {placeholder}
      </div>
    )}
    <Editor
      className='json-form'
      defaultLanguage="json"
      // theme={themeManager.getCurrentTheme()}
      width={widthStyle-8 }
      height={heightStyle - 12}
      onChange={handleChange}
      value={inputvalue? 
              (typeof inputvalue === 'string'? 
                inputvalue:
                InputFallback(inputvalue)
              ): 
              (typeof getNode(parentId)?.data.content ==='string'?
                getNode(parentId)?.data.content as string:
                InputFallback(inputvalue)
            )}
      options={{
        fontFamily: "'JetBrains Mono', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollbar: {
          useShadows: false,
          horizontal: 'hidden', // 隐藏水平滚动条
          horizontalScrollbarSize: 0 // 设置水平滚动条大小为0
        },
        fontSize: 14,
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
        readOnly: readonly?readonly:isOnGeneratingNewNode,
      }}
      onMount={handleEditorDidMount}
    />
    </div>
  );
};

export default JSONForm;