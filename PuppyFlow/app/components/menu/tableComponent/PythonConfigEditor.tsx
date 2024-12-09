'use client'
import React, {useState, useRef, useEffect, useCallback} from 'react';
import Editor, { EditorProps, loader, OnMount, OnChange, } from "@monaco-editor/react";
import * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useReactFlow, useStore } from '@xyflow/react';
import useJsonConstructUtils from '../../hooks/useJsonConstructUtils';


type PythonConfigEditorProps = {
    preventParentDrag: () => void,
    allowParentDrag: () => void,
    parentId: string,
    placeholder?: string,
    widthStyle?: number,
    heightStyle?: number,
    inputs: string[] // showing labels of inputs
}

const PythonConfigEditor = ({preventParentDrag, 
                    allowParentDrag, 
                    parentId,
                    placeholder = "",
                    widthStyle = 0,
                    heightStyle=0,
                    inputs=[]}:PythonConfigEditorProps) => {

    // const [jsonValue, setJsonValue] = useState("");
    // console.log(inputs, "inputs showing in editor")
    
    const [IsFocused, setIsFocused] = useState(false)
    const [isEmpty, setIsEmpty] = useState(true);
    const hoverElementRef = useRef<HTMLDivElement | null>(null)
    const TrigerWordRef = useRef<string | null>(null)
    const {setNodes, getNode, getZoom, getViewport} = useReactFlow()
    const [variableNames, setVariableNames] = useState(new Set<string>())
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
    const {getSourceNodeIdWithLabel} = useJsonConstructUtils()
    const variableRef = useRef<{id: string, label: string}[]>([])
    const pythonConfigEditorRef = useRef<HTMLDivElement>(null)
    // 添加一个 ref 来追踪编辑器是否已经初始化
    const isEditorReady = useRef(false);
    
    // 监听 inputs 变化
    useEffect(() => {

      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!editor || !model || !isEditorReady.current) return;

      const lines = model.getValue().split('\n');
      const firstLine = `def func(${generateInputsString(inputs)}):`;
      
      // 只在第一行不匹配时更新
      if (lines[0] !== firstLine) {
          const middleLines = lines.slice(1);
          const newText = [firstLine, ...middleLines].join('\n');
          
          model.pushEditOperations(
              [],
              [{
                  range: model.getFullModelRange(),
                  text: newText
              }],
              () => [new Monaco.Selection(1, firstLine.length + 1, 1, firstLine.length + 1)]
          );
      }
  }, [inputs]); // 只在 inputs 变化时触发

    // const applyTheme = useMonacoTheme(JSON_FORM_THEME, jsonFormThemeData)
    useEffect(() => {
      const parent = getNode(parentId)
      if (parent && parent.data.code) {
        setIsEmpty(false)
      }
      else {
        setIsEmpty(true)
      }
    }, [getNode(parentId)?.data.code])


    // useEffect(() => {
    //   variableRef.current = getSourceNodeIdWithLabel(parentId)
 
    // }, [getSourceNodeIdWithLabel(parentId)])



    useEffect(() => {
        let disposeCompletionItemProvider: Monaco.IDisposable | undefined;
    
        const initMonaco = async () => {
           
            const monaco = await loader.init();
            
            // 清理之前的 provider
            if (disposeCompletionItemProvider) {
                disposeCompletionItemProvider.dispose();
            }
    
            disposeCompletionItemProvider = monaco.languages.registerCompletionItemProvider('python', {
              provideCompletionItems: (model, position, context, token) => {
                const wordInfo = model.getWordUntilPosition(position);
                const range = {
                  startLineNumber: position.lineNumber,
                  endLineNumber: position.lineNumber,
                  startColumn: wordInfo.startColumn,
                  endColumn: wordInfo.endColumn
                };
                const suggestions = [
                  {
                    label: 'def',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'def ${1:func_name}(${2:params}):\n\t${3:pass}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range
                  },
                  {
                    label: 'class',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'class ${1:ClassName}:\n\tdef __init__(self):\n\t\t${2:pass}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range
                  },
                  {
                    label: 'if',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'if ${1:condition}:\n\t${2:pass}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range
                  },
                  {
                    label: 'for',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'for ${1:item} in ${2:iterable}:\n\t${3:pass}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range
                  },
                  {
                    label: 'while',
                    kind: monaco.languages.CompletionItemKind.Keyword,
                    insertText: 'while ${1:condition}:\n\t${2:pass}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range
                  },
                  {
                    label: 'try/except',
                    kind: monaco.languages.CompletionItemKind.Snippet,
                    insertText: 'try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}',
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range: range
                  },
                  // 添加更多 Python 相关的建议...
                ];

                // console.log(variableNames)
                variableNames.forEach(varName => {
                  const matches = editorRef.current?.getModel()?.findMatches(varName, false, false, true, null, true);
                  // console.log(matches)
                  if (matches && matches.length > 0) {
                    const match = matches[0];
                    suggestions.push({
                      label: varName,
                      kind: monaco.languages.CompletionItemKind.Variable,
                      insertText: varName,
                      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                      range: range
                    });
                  }
                })
            
                return { suggestions: suggestions };
              }
            });
            
            // 下面在onMount MouseMove 已经有类似的function了
            // monaco.languages.registerHoverProvider('python', {
            //   provideHover: (model, position) => {
            //     const word = model.getWordAtPosition(position);
            //     if (word) {
            //       // 这里可以添加更多 Python 内置函数或关键字的说明
            //       const hoverContent = {
            //         'print': 'print(value, ..., sep=" ", end="\\n", file=sys.stdout, flush=False)\n\nPrints the values to a stream, or to sys.stdout by default.',
            //         'def': 'Defines a function.',
            //         'class': 'Defines a class.',
            //         // 添加更多 Python 关键字的说明...
            //       }[word.word];
            
            //       if (hoverContent) {
            //         const startColumn = Math.max(1, word.startColumn - 1);
            //         const endColumn = word.endColumn;
            //         const startLineNumber = position.lineNumber;
            //         const endLineNumber = position.lineNumber;

            //         // 计算调整后的位置
            //         const {x, y, zoom} = getViewport();
            //         const adjustedStartColumn = (startColumn - 1) * zoom + x;
            //         const adjustedEndColumn = endColumn * zoom + x;
            //         const adjustedStartLineNumber = startLineNumber * zoom + y;
            //         const adjustedEndLineNumber = endLineNumber * zoom + y;
            //         return {
            //           contents: [{ value: '```python\n' + hoverContent + '\n```' }],
            //           range: {
            //             startLineNumber: adjustedStartLineNumber,
            //             endLineNumber: adjustedEndLineNumber,
            //             startColumn: adjustedStartColumn,
            //             endColumn: adjustedEndColumn
            //           }
            //         };
            //       }
            //     }
            //     return null;
            //   }
            // });
        };
    
        initMonaco();
    
        return () => {
            if (disposeCompletionItemProvider) {
                disposeCompletionItemProvider.dispose();
            }
        };
    }, [parentId, variableNames]); // 使用 parentId 和 getSourceNodes 作为依赖项

     
    

    // 添加函数来生成输入参数字符串
    const generateInputsString = (inputs: string[]) => {
      if (inputs.length === 0) return '';
      return inputs.map(input => `arg_${input}`).join(', ');
  };

  // 添加函数来更新函数定义
  const updateFunctionDefinition = useCallback(() => {
    const model = editorRef.current?.getModel();
    if (!model || !isEditorReady.current) return;

    const inputsStr = generateInputsString(inputs);
    const lines = model.getValue().split('\n');
    const newFirstLine = `def func(${inputsStr}):`;
        
      // 只在第一行不匹配时更新
      if (lines[0] !== newFirstLine) {
        const middleLines = lines.slice(1);
        const newText = [newFirstLine, ...middleLines].join('\n');
        
        model.pushEditOperations(
            [],
            [{
                range: model.getFullModelRange(),
                text: newText
            }],
            () => [new Monaco.Selection(1, newFirstLine.length + 1, 1, newFirstLine.length + 1)]
        );
    }
  }, [inputs]);




    const updateNodeContent = (newValue: string) => {
      setNodes(prevNodes => (prevNodes.map(node => node.id === parentId ? {
        ...node,
        data: {...node.data, code: newValue}
      } : node)))
    }


    const handleChange: OnChange = (newValue: string | undefined, event) => {
  
      const model = editorRef.current?.getModel();
        if (!model) return;
        
        const changes = event.changes[0];
        if (changes.range.startLineNumber === 1) {
         
           // 如果修改涉及第一行，恢复第一行内容
        const lines = model.getValue().split('\n');
        console.log(inputs, "say onChange, if inputs update?")
        const firstLine = `def func(${inputs.map(input => `arg_${input}`).join(', ')}):`;
        
        if (lines[0] !== firstLine) {
            const middleLines = lines.slice(1);
            const newText = [firstLine, ...middleLines].join('\n');
            
            model.pushEditOperations(
                [],
                [{
                    range: model.getFullModelRange(),
                    text: newText
                }],
                () => null
            );


            const isValueEmpty = !newText || newText.trim().length === 0;
            setIsEmpty(isValueEmpty);
            updateNodeContent(isValueEmpty ? "" : newText);
      
            if (editorRef.current) {
              const editorElement = editorRef.current.getContainerDomNode();
              if (isValueEmpty) {
                editorElement.classList.add('hideLineNumbers');
              } else {
                editorElement.classList.remove('hideLineNumbers');
              }
            }

            return
        }
        

        const isValueEmpty = !lines.join('\n') || lines.join('\n').trim().length === 0;
        setIsEmpty(isValueEmpty);
        updateNodeContent(isValueEmpty ? "" : lines.join('\n'));

        if (editorRef.current) {
          const editorElement = editorRef.current.getContainerDomNode();
          if (isValueEmpty) {
            editorElement.classList.add('hideLineNumbers');
          } else {
            editorElement.classList.remove('hideLineNumbers');
          }
        }
        return
        }

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
        if (pythonConfigEditorRef.current) {
          pythonConfigEditorRef.current.classList.add('python-config-editor')
        }

        const getHoverContent = (word: string, lineContent: string): string | undefined => {
                  // 首先检查完整行内容
          if (lineContent.trim().startsWith(`def func`)) {
            return 'read-only line';
          }
          // if (lineContent.trim() === 'return(arg_1)') {
          //   return 'read-only line';
          // }

          // 然后检查单个词
          const hoverContent = {
            'print': 'Prints the values to a stream, or to sys.stdout by default.',
            'def': 'Defines a function.',
            'class': 'Defines a class.',
            // 添加更多 Python 关键字的说明...
          };
        return hoverContent[word as keyof typeof hoverContent];
        };

        editorRef.current.onMouseDown((e: Monaco.editor.IEditorMouseEvent) => {
            if (e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT) {
              const position = e.target.position;
              const word = editorRef.current?.getModel()?.getWordAtPosition(position);
              const lineContent = editorRef.current?.getModel()?.getLineContent(position.lineNumber);
              
              if (word && lineContent && word.word !== TrigerWordRef.current) {
                if (TrigerWordRef.current) {
                  hoverElementRef.current?.remove()
                  TrigerWordRef.current = null
                }
                // 获取悬停内容
                const hoverContent = getHoverContent(word.word, lineContent);
                
                if (hoverContent) {
                  // 创建自定义悬停元素
                  const hoverElement = document.createElement('div');
                  hoverElement.className = 'custom-hover';
                  hoverElement.textContent = hoverContent;
                  
                  // 获取鼠标位置
              
                  // const top = editorRef.current!.getScrolledVisiblePosition(position)?.top
                  // const left = editorRef.current!.getScrolledVisiblePosition(position)?.left
                  const cursorPosition = editorRef.current!.getScrolledVisiblePosition(position);
                  const lineHeight = editorRef.current!.getOption(monaco.editor.EditorOption.lineHeight);
                
                  // 设置悬停元素位置在光标下方
                  hoverElement.style.top = `${cursorPosition!.top + lineHeight}px`;
                  hoverElement.style.left = `${cursorPosition!.left}px`;
                  
                  // 设置悬停元位置
                  // hoverElement.style.top = `${top}px`;
                  // hoverElement.style.left = `${left}px`;
                  // hoverElement.style.position = 'absolute';
                  // 添加到 DOM
                  editorRef.current!.getDomNode()?.appendChild(hoverElement);
                  hoverElementRef.current = hoverElement
                  TrigerWordRef.current = word.word
                  console.log(TrigerWordRef.current)
                  
                  // 设置定时器移除悬停元素
                  setTimeout(() => {
                    hoverElement.remove()
                    hoverElementRef.current = null
                    TrigerWordRef.current = null
                  }, 2000);
              }
            }
  
          }
        })

        editorRef.current.onDidChangeModelContent(() => {
          const text = editorRef.current!.getValue();
          const variableRegex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=/g;
          let match: RegExpExecArray | null 
          const newInputs = getSourceNodeIdWithLabel(parentId).map(node => `arg_${node.label}`)
          setVariableNames(() => {
            const newVariableNames = new Set<string>(newInputs);
            while ((match = variableRegex.exec(text)) !== null) {
              if (match[1]) {
                // console.log(match[1])
                newVariableNames.add(match[1]);
              }
            }
            return newVariableNames;
          });
          // while (match.length) {
          //   setVariableNames(prevVariableNames => new Set([...Array.from(prevVariableNames), match[1]]));
          // }
        });

          // 创建一个更简单的编辑拦截器
        const model = editor.getModel();
        if (model) {
            // 设置初始内容
            const firstLine = `def func(${getSourceNodeIdWithLabel(parentId).map(node => `arg_${node.label}`).join(",")}):`
            const initialText = model.getValue() || `def func(${getSourceNodeIdWithLabel(parentId).map(node => `arg_${node.label}`).join(",")}):\n    # write your code here\n    return`;
            const lines = initialText.split('\n')
            lines[0] = firstLine
            model.setValue(lines.join('\n'));

            // 标记编辑器已经准备好
            isEditorReady.current = true;
            
        // 初始化完成后立即更新函数定义
        // updateFunctionDefinition();

        // 添加内容变更监听器
        editor.onDidChangeModelContent((e) => {
          //   const lines = model.getValue().split('\n');
          //   const firstLine = lines[0]; 
          //   // const firstLine = lines[0];
          //   console.log(firstLine, "firstLine")
          //   // const lastLine = '    return(arg_1)';

          //   // 检查是否需要恢复内容
          //   // if (lines.length < 3 || lines[0] !== firstLine || lines[lines.length - 1] !== lastLine)  {
          //   //     let middleLines = lines.slice(1, -1);
                  
          //   //     // 如果中间没有内容，添加默认行
          //   //     if (middleLines.length === 0) {
          //   //         middleLines = [''];
          //   //     }
          //   //     const newText = [firstLine, ...middleLines, lastLine].join('\n');
          //   //     // model.setValue(newText);
          //   //     const currentPosition = editor.getPosition();
                
          //   //     // 保存当前光标位置
          //   //     model.pushEditOperations(
          //   //         [],
          //   //         [{
          //   //             range: model.getFullModelRange(),
          //   //             text: newText
          //   //         }],
          //   //         () => currentPosition ? [new monaco.Selection(
          //   //           currentPosition.lineNumber,
          //   //           currentPosition.column,
          //   //           currentPosition.lineNumber,
          //   //           currentPosition.column
          //   //       )] : null
          //   //     );
          //   // }

          //   if (lines.length < 2 || lines[0] !== firstLine )  {
          //     let middleLines = lines.slice(1);
                
          //     // 如果中间没有内容，添加默认行
          //     if (middleLines.length === 0) {
          //         middleLines = [''];
          //     }
          //     const newText = [firstLine, ...middleLines].join('\n');
          //     // model.setValue(newText);
          //     const currentPosition = editor.getPosition();
              
          //     // 保存当前光标位置
          //     model.pushEditOperations(
          //         [],
          //         [{
          //             range: model.getFullModelRange(),
          //             text: newText
          //         }],
          //         () => currentPosition ? [new monaco.Selection(
          //           currentPosition.lineNumber,
          //           currentPosition.column,
          //           currentPosition.lineNumber,
          //           currentPosition.column
          //       )] : null
              
          //     );
          // }
          
            updateDecorations()
            // updateFunctionDefinition()
        });

         // 创建更新装饰器的函数
         const updateDecorations = () => {
          editor.createDecorationsCollection([
              {
                  range: new monaco.Range(1, 1, 1, 1000),
                  options: {
                      isWholeLine: true,
                      className: 'readonly-line',
                      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                      inlineClassName: 'readonly-line-inline',
                      linesDecorationsClassName: 'readonly-line-decoration',
                      marginClassName: 'readonly-line-margin',
                      zIndex: 100
                  }
              },
              // {
              //     range: new monaco.Range(model.getLineCount(), 1, model.getLineCount(), 1000),
              //     options: {
              //         isWholeLine: true,
              //         className: 'readonly-line',
              //         stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
              //         inlineClassName: 'readonly-line-inline',
              //         linesDecorationsClassName: 'readonly-line-decoration',
              //         marginClassName: 'readonly-line-margin',
              //         zIndex: 100
              //     }
              // }
          ]);
      };

      // 初始应用装饰器
      updateDecorations();

      // 监听鼠标移动
      editor.onMouseMove((e: Monaco.editor.IEditorMouseEvent) => {
          const lineNumber = e.target.position?.lineNumber;
          if (lineNumber === 1) {
            editor.updateOptions({ 
              cursorStyle: 'line-thin',
              readOnly: true 
          })
          } else {
            editor.updateOptions({ 
              cursorStyle: 'line',
              readOnly: false 
          });
            }
        });
        }

    // 在编辑器初始化或相关设置部分添加
editor.onKeyDown((e: Monaco.IKeyboardEvent) => {
  const position = editor.getPosition();
  const model = editor.getModel();
  const selection = editor.getSelection();
  
  if (!position || !model || !selection) return;

  // 检查是否涉及第一行
  if (selection.startLineNumber === 1) {
    
    // 阻止所有涉及第一行的删除操作
    e.preventDefault();
    e.stopPropagation();
  
  }
  
  // 检查是否在第二行起始位置且按下了退格键
  if (position.lineNumber === 2 && 
      position.column === 1 && 
      (e.keyCode === monaco.KeyCode.Backspace || e.keyCode === monaco.KeyCode.Delete)) {
      
      // 如果有选区，并且选区恰好到第二行第一列，允许删除
      if (selection && 
        selection.startLineNumber === 2 && 
        selection.startColumn === 1 && 
        selection.endLineNumber >= selection.startLineNumber && selection.endColumn > selection.startColumn) {
          return; // 允许删除
      }
      e.preventDefault();
      e.stopPropagation();
      
      // 保持光标在第二行第一个字符位置
      editor.setPosition({
          lineNumber: 2,
          column: 1
      });
    }
    return
  
 
});


// 添加选择事件处理
// editor.onDidChangeCursorSelection((e: Monaco.editor.ICursorSelectionChangedEvent) => {
//   const selection = e.selection;
  
//   // 如果选区包含第一行，调整选区到第二行开始
//   if (selection.startLineNumber === 1) {
//       editor.setSelection({
//           startLineNumber: 2,
//           startColumn: 1,
//           endLineNumber: selection.endLineNumber,
//           endColumn: selection.endColumn
//       });
//   }
// });
    }
        

  return (
    <div ref={pythonConfigEditorRef} className={`relative flex flex-col border-[1px] rounded-[4px] cursor-pointer px-[9px] py-[8px] bg-black border-[#6D7177] ${IsFocused ? "outline-[#FFA73D] outline-4 -outline-offset-2 shadow-[0_0_0_1px_rgba(205,205,205)] border-[1px] border-[#CDCDCD] transition-all duration-300 ease-in-out": "" }`}
    style={{
      width: widthStyle,
      height: heightStyle
    }}>
    {isEmpty && (
      <div className="absolute top-0 left-0 w-full h-full flex items-start p-[8px] pl-[38px] justify-start text-center text-[#6D7177] text-[12px] font-[500] leading-normal pointer-events-none z-[10] font-jetbrains-mono">
        {placeholder}
      </div>
    )}
    <Editor
      className='python-config-editor'
      defaultLanguage="python"
      // theme={themeManager.getCurrentTheme()}
      width={widthStyle - 18}
      height={heightStyle - 16}
      onChange={handleChange}
      value={getNode(parentId)?.data.code as string}
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
        // 添加以下选项来启用Python格式检查
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        tabCompletion: "on",
        wordBasedSuggestions: "matchingDocuments",
        parameterHints: {
        enabled: true
        },
        suggest: {
        snippetsPreventQuickSuggestions: false
        },
        formatOnType: true,
        formatOnPaste: true,
        // 启用错误和警告标记
        renderValidationDecorations: "on",
        overviewRulerLanes: 0,  // 隐藏右侧的预览框
        lineNumbersMinChars: 2,
        glyphMargin: false,
        lineDecorationsWidth: 0, // 控制行号和正文的间距
        // ... 其他选项 ...

      // 禁用拖放功能
      dragAndDrop: false,
      // 禁用第一行和最后一行的行号点击
      lineNumbers: (lineNumber) => {
        const model = editorRef.current?.getModel();
        if (!model) return lineNumber.toString();
        return lineNumber === 1  ? '' : lineNumber.toString();
            },
          }}
      onMount={handleEditorDidMount}
      
    />
    </div>
  );
};

export default PythonConfigEditor;