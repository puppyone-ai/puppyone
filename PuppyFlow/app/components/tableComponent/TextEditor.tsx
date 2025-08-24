import React, { useState, useRef, useEffect } from 'react';
import Editor, {
  EditorProps,
  loader,
  OnMount,
  OnChange,
} from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
// import { useMonacoTheme } from '../../hooks/useMonacoTheme';
// import { themeManager } from '../../hooks/themeManager';

type TextEditorProps = {
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  value: string | object | any;
  onChange: (value: string) => void;
  placeholder?: string;
  widthStyle?: number;
  heightStyle?: number;
  autoHeight?: boolean;
};

// 为 TextEditor 定义一个透明背景的主题
const TEXT_EDITOR_THEME = 'customTextEditorTheme';
const textEditorThemeData: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000', // 完全透明的背景
    'editor.foreground': '#CDCDCD',
    'editorLineNumber.foreground': '#6D7177',
    'editorLineNumber.activeForeground': '#CDCDCD',
    'editor.selectionBackground': '#264F78',
    'editor.inactiveSelectionBackground': '#3A3D41',
    'editorIndentGuide.background': 'rgba(109, 113, 119, 0.3)',
    'editorIndentGuide.activeBackground': 'rgba(109, 113, 119, 0.6)',
    // 禁用单词与符号高亮的背景色
    'editor.wordHighlightBackground': '#00000000',
    'editor.wordHighlightStrongBackground': '#00000000',
    'editor.selectionHighlightBackground': '#00000000',
  },
};

const TextEditor = ({
  preventParentDrag,
  allowParentDrag,
  value,
  onChange,
  placeholder = '',
  widthStyle = 0,
  heightStyle = 0,
  autoHeight = false,
}: TextEditorProps) => {
  // const [jsonValue, setJsonValue] = useState("");

  const [IsFocused, setIsFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const [editorHeight, setEditorHeight] = useState(heightStyle || 32);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const textEditorRef = useRef<HTMLDivElement>(null);
  // const applyTheme = useMonacoTheme(TEXT_EDITOR_THEME, textEditorThemeData)

  useEffect(() => {
    try {
      // 处理不同类型的值
      if (value === null || value === undefined) {
        setIsEmpty(true);
        return;
      }

      if (typeof value === 'string') {
        setIsEmpty(!value || value.trim().length === 0);
      } else if (typeof value === 'object') {
        // 对于对象，检查是否为空对象
        setIsEmpty(Object.keys(value).length === 0);
      } else {
        // 对于其他类型，转换为字符串后检查
        setIsEmpty(!value || String(value).trim().length === 0);
      }
    } catch (error) {
      console.error('isEmpty 检查失败:', error);
      console.log('出错时的 value:', value);
      console.log('出错时的 typeof value:', typeof value);

      // 降级处理
      setIsEmpty(!value || String(value).trim().length === 0);
    }
  }, [value]);

  // 添加主题定义
  useEffect(() => {
    const defineTheme = async () => {
      const monaco = await loader.init();
      monaco.editor.defineTheme(TEXT_EDITOR_THEME, textEditorThemeData);
    };
    defineTheme();
  }, []);

  // 自动调整高度的函数
  const updateEditorHeight = () => {
    if (autoHeight && editorRef.current) {
      const editor = editorRef.current;
      const contentHeight = editor.getContentHeight();
      const minHeight = 24;
      const maxHeight = 600; // 设置最大高度避免过高
      const newHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);

      if (newHeight !== editorHeight) {
        setEditorHeight(newHeight);
        // 需要在下一个 tick 中调整布局
        setTimeout(() => {
          editor.layout();
        }, 0);
      }
    }
  };

  const handleChange: OnChange = (newValue: string | undefined) => {
    const isValueEmpty = !newValue || newValue.trim().length === 0;
    setIsEmpty(isValueEmpty);
    onChange(isValueEmpty ? '' : newValue);

    if (editorRef.current) {
      const editorElement = editorRef.current.getContainerDomNode();
      if (isValueEmpty) {
        editorElement.classList.add('hideLineNumbers');
      } else {
        editorElement.classList.remove('hideLineNumbers');
      }
    }

    // 自动调整高度
    if (autoHeight) {
      setTimeout(updateEditorHeight, 0);
    }
  };

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.onDidFocusEditorWidget(() => {
      setIsFocused(true);
      preventParentDrag();
    });

    editor.onDidBlurEditorWidget(() => {
      setIsFocused(false);
      allowParentDrag();
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

    // 如果启用自动高度，监听内容变化
    if (autoHeight) {
      editor.onDidContentSizeChange(updateEditorHeight);
      // 初始化时调整高度
      setTimeout(updateEditorHeight, 100);
    }
  };

  const InputFallback = (e: any): string => {
    // 处理不同类型的值
    if (e === null || e === undefined) {
      return '';
    }

    if (typeof e === 'object') {
      try {
        // 尝试使用 JSON.stringify 格式化对象
        return JSON.stringify(e, null, 2);
      } catch (error) {
        console.error('JSON.stringify 失败:', error);
        // 如果 JSON.stringify 失败，使用 toString 方法
        return e.toString();
      }
    }

    // 对于其他类型，直接转换为字符串
    return String(e);
  };

  // 计算实际的宽高样式 - 类似 JSONForm 的处理
  const actualWidth = widthStyle === 0 ? '100%' : widthStyle;
  const actualHeight = autoHeight
    ? editorHeight
    : heightStyle === 0
      ? '100%'
      : heightStyle;

  return (
    <div
      ref={textEditorRef}
      className={`relative flex justify-start items-center rounded-[4px] cursor-pointer`}
      style={{ width: actualWidth, height: actualHeight }}
    >
      {isEmpty && (
        <div className='absolute w-full h-full flex items-start justify-start text-center text-[#6D7177] text-[12px] italic leading-normal pointer-events-none z-[10] font-plus-jakarta-sans'>
          {placeholder}
        </div>
      )}
      <Editor
        className='text-editor'
        defaultLanguage='text'
        theme={TEXT_EDITOR_THEME}
        width={actualWidth}
        height={actualHeight}
        onChange={handleChange}
        value={typeof value === 'string' ? value : InputFallback(value)}
        options={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          unicodeHighlight: {
            ambiguousCharacters: false,
            invisibleCharacters: false,
            nonBasicASCII: false,
          },
          fontLigatures: true,
          minimap: { enabled: false },
          scrollbar: {
            useShadows: false,
            horizontal: 'auto',
            vertical: autoHeight ? 'hidden' : 'auto', // 自动高度时隐藏垂直滚动条
            horizontalScrollbarSize: 8,
            verticalScrollbarSize: 8,
            horizontalSliderSize: 8,
            verticalSliderSize: 8,
            alwaysConsumeMouseWheel: true,
            arrowSize: 0,
            verticalHasArrows: false,
            horizontalHasArrows: false,
          },
          // 1) 关闭联想/自动补全
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          wordBasedSuggestions: 'off',
          acceptSuggestionOnEnter: 'off',
          parameterHints: { enabled: false },
          tabCompletion: 'off',
          fontSize: 14,
          lineHeight: 28,
          letterSpacing: 0,
          wordWrap: 'on',
          wordWrapColumn: 120,
          wrappingStrategy: 'advanced',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          lineNumbers: 'off',
          overviewRulerLanes: 0,
          overviewRulerBorder: false,
          fixedOverflowWidgets: true,
          lineNumbersMinChars: 2,
          glyphMargin: false,
          lineDecorationsWidth: 0,
          folding: false,
          renderLineHighlight: 'none',
          hideCursorInOverviewRuler: true,
          // 2) 关闭相同词语的灰色高亮
          occurrencesHighlight: 'off',
          selectionHighlight: false,
          // 3) 关闭缩进行
          guides: { indentation: false, highlightActiveIndentation: false },
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};

export default TextEditor;
