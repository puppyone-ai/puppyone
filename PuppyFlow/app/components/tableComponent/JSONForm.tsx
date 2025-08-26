'use client';
import React, { useState, useRef, useEffect } from 'react';
// import Editor, { EditorProps, loader, OnMount, OnChange, } from "@monaco-editor/react";
import type { EditorProps, OnMount, OnChange } from '@monaco-editor/react';
import { loader } from '@monaco-editor/react';
import dynamic from 'next/dynamic';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { useReactFlow } from '@xyflow/react';
import { useNodesPerFlowContext } from '../states/NodesPerFlowContext';

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
});

type JSONEditorProps = {
  preventParentDrag: () => void;
  allowParentDrag: () => void;
  placeholder?: string;
  widthStyle?: number;
  heightStyle?: number;
  value?: string | object;
  readonly?: boolean;
  onChange?: (value: string) => void;
};

// 为 Monaco Editor 定义一个自定义主题
const JSON_FORM_THEME = 'customJsonFormTheme';
const jsonFormThemeData: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1C1D1F',
    // 修改缩进指南线的颜色 - 使用与行号相同的颜色
    'editorIndentGuide.background': 'rgba(109, 113, 119, 0.5)', // 普通缩进线
    'editorIndentGuide.activeBackground': 'rgba(109, 113, 119, 0.8)', // 活动缩进线（稍微深一点）
  },
};

const JSONForm = ({
  preventParentDrag,
  allowParentDrag,
  placeholder = '',
  widthStyle = 0,
  heightStyle = 0,
  value = '',
  readonly = false,
  onChange,
}: JSONEditorProps) => {
  const [IsFocused, setIsFocused] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  // 添加用于存储监听器清理函数的 ref
  const editorDisposablesRef = useRef<Monaco.IDisposable[]>([]);
  const jsonFormRef = useRef<HTMLDivElement>(null);
  const { isOnGeneratingNewNode } = useNodesPerFlowContext();

  useEffect(() => {
    // 安全地检查value是否为空
    const isEmptyValue =
      !value ||
      (typeof value === 'string' && value.trim().length === 0) ||
      (typeof value === 'object' && Object.keys(value).length === 0);
    setIsEmpty(isEmptyValue);
  }, [value]);

  // 添加一个函数来定义和应用主题
  useEffect(() => {
    const defineTheme = async () => {
      const monaco = await loader.init();
      monaco.editor.defineTheme(JSON_FORM_THEME, jsonFormThemeData);
    };
    defineTheme();
  }, []);

  const handleChange: OnChange = (newValue: string | undefined) => {
    // 安全地检查newValue是否为空
    const isValueEmpty =
      !newValue ||
      (typeof newValue === 'string' && newValue.trim().length === 0);
    setIsEmpty(isValueEmpty);

    // 调用父组件传入的 onChange 回调
    if (onChange) {
      onChange(isValueEmpty ? '' : newValue);
    }

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
    editorRef.current = editor;

    // 创建监听器并保存清理函数
    const focusDisposable = editor.onDidFocusEditorWidget(() => {
      setIsFocused(true);
      preventParentDrag();
    });

    const blurDisposable = editor.onDidBlurEditorWidget(() => {
      setIsFocused(false);
      allowParentDrag();
    });

    // 保存清理函数
    editorDisposablesRef.current = [focusDisposable, blurDisposable];

    // 初始化时检查是否为空
    const editorValue = editor.getValue();
    const isValueEmpty =
      !editorValue ||
      (typeof editorValue === 'string' && editorValue.trim().length === 0);
    setIsEmpty(isValueEmpty);

    const editorElement = editor.getContainerDomNode();
    if (isValueEmpty) {
      editorElement.classList.add('hideLineNumbers');
    }

    if (jsonFormRef.current) {
      jsonFormRef.current.classList.add('json-form');
    }
  };

  // 添加清理 useEffect
  useEffect(() => {
    return () => {
      // 清理 Monaco Editor 监听器
      editorDisposablesRef.current.forEach(disposable => {
        disposable.dispose();
      });
      editorDisposablesRef.current = [];
    };
  }, []);

  // 计算实际的宽高样式
  const actualWidth = widthStyle === 0 ? '100%' : widthStyle;
  const actualHeight = heightStyle === 0 ? '100%' : heightStyle;
  const editorWidth = widthStyle === 0 ? '100%' : widthStyle - 8;
  const editorHeight = heightStyle === 0 ? '100%' : heightStyle - 12;

  return (
    <div
      ref={jsonFormRef}
      className={`relative flex flex-col border-none rounded-[8px] cursor-pointer pl-[2px] pt-[8px] bg-[#1C1D1F] ${isOnGeneratingNewNode ? 'pointer-events-none' : ''}`}
      style={{
        width: actualWidth,
        height: actualHeight,
        opacity: isOnGeneratingNewNode ? '0.7' : '1',
      }}
    >
      {isEmpty && (
        <div className='absolute top-0 left-0 w-full h-full flex items-start justify-start p-[8px] pl-[44px] text-[#6D7177] bg-transparent text-[14px] font-[500] leading-normal pointer-events-none z-[10] font-jetbrains-mono'>
          {placeholder}
        </div>
      )}
      <Editor
        className='json-form'
        defaultLanguage='json'
        theme={JSON_FORM_THEME}
        width={editorWidth}
        height={editorHeight}
        onChange={handleChange}
        value={
          typeof value === 'object' ? JSON.stringify(value, null, 2) : value
        }
        options={{
          fontFamily: "'JetBrains Mono', monospace",
          fontLigatures: true,
          minimap: { enabled: false },
          unicodeHighlight: {
            ambiguousCharacters: false,
            invisibleCharacters: false,
            nonBasicASCII: false,
          },
          scrollbar: {
            useShadows: false,
            horizontal: 'auto',
            vertical: 'auto',
            horizontalScrollbarSize: 8,
            verticalScrollbarSize: 8,
            horizontalSliderSize: 8,
            verticalSliderSize: 8,
          },
          fontSize: 14,
          fontWeight: 'light',
          lineHeight: 28,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          fixedOverflowWidgets: true,
          acceptSuggestionOnEnter: 'on',
          overviewRulerLanes: 0, // 隐藏右侧的预览框
          lineNumbersMinChars: 3,
          glyphMargin: false,
          lineDecorationsWidth: 0, // 控制行号和正文的间距
          readOnly: readonly || isOnGeneratingNewNode,
          bracketPairColorization: {
            enabled: false, // 禁用括号对着色
          },
          folding: true,
          foldingHighlight: false,
          foldingStrategy: 'indentation',
          showFoldingControls: 'mouseover',
          foldingImportsByDefault: true,
          foldingMaximumRegions: 5000,
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};

export default JSONForm;
