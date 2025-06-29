'use client'
import React, { useState, useRef, useEffect, useMemo } from 'react';
import Editor, { OnMount, OnChange, loader } from "@monaco-editor/react";
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

type TextHugEditorProps = {
    value: string;
    onChange: (value: string) => void;
    preventParentDrag: () => void;
    allowParentDrag: () => void;
    placeholder?: string;
    readonly?: boolean;
    isRoot?: boolean;
}

// 为 TextHugEditor 定义主题
const TEXT_HUG_EDITOR_THEME = 'customTextHugEditorTheme';
const textHugEditorThemeData: Monaco.editor.IStandaloneThemeData = {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
        'editor.background': '#2a2a2a', // 使用与容器相同的背景色
        'editor.foreground': '#e0e0e0',
        'editorLineNumber.foreground': '#6D7177',
        'editorLineNumber.activeForeground': '#e0e0e0',
        'editor.selectionBackground': '#264F78',
        'editor.inactiveSelectionBackground': '#3A3D41',
        'editorIndentGuide.background': 'rgba(109, 113, 119, 0.3)',
        'editorIndentGuide.activeBackground': 'rgba(109, 113, 119, 0.6)',
    }
};

const TextHugEditor = ({
    value,
    onChange,
    preventParentDrag,
    allowParentDrag,
    placeholder = "Click to edit text...",
    readonly = false,
    isRoot = false
}: TextHugEditorProps) => {
    const [isEmpty, setIsEmpty] = useState(true);
    const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // 计算动态高度
    const calculatedHeight = useMemo(() => {
        if (!value) {
            return isRoot ? 100 : 40;
        }
        
        const lines = value.split('\n').length;
        const lineHeight = 24;
        const padding = 16;
        const minHeight = isRoot ? 100 : 40;
        const maxHeight = isRoot ? 400 : 300;
        
        const contentHeight = Math.max(lines * lineHeight + padding, minHeight);
        return Math.min(contentHeight, maxHeight);
    }, [value, isRoot]);

    useEffect(() => {
        setIsEmpty(!value || value.trim().length === 0);
    }, [value]);

    // 定义主题
    useEffect(() => {
        const defineTheme = async () => {
            const monaco = await loader.init();
            monaco.editor.defineTheme(TEXT_HUG_EDITOR_THEME, textHugEditorThemeData);
        };
        defineTheme();
    }, []);

    const handleChange: OnChange = (newValue: string | undefined) => {
        const isValueEmpty = !newValue || newValue.trim().length === 0;
        setIsEmpty(isValueEmpty);
        onChange(isValueEmpty ? "" : newValue || "");
    };

    const handleEditorDidMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        
        editor.onDidFocusEditorWidget(() => {
            preventParentDrag();
        });

        editor.onDidBlurEditorWidget(() => {
            allowParentDrag();
        });

        // 初始化时检查是否为空
        const isValueEmpty = !editor.getValue().trim();
        setIsEmpty(isValueEmpty);
    };

    return (
        <div 
            ref={containerRef}
            className="w-full relative"
            style={{ height: `${calculatedHeight}px` }}
        >
            {isEmpty && !readonly && (
                <div className="absolute top-3 left-3 text-[#888] text-sm italic pointer-events-none z-10">
                    {placeholder}
                </div>
            )}
            <Editor
                language="text"
                theme={TEXT_HUG_EDITOR_THEME}
                width="100%"
                height={calculatedHeight}
                value={value}
                onChange={handleChange}
                onMount={handleEditorDidMount}
                options={{
                    fontFamily: "'Plus Jakarta Sans', sans-serif",
                    fontSize: 14,
                    lineHeight: 24,
                    wordWrap: 'on',
                    wordWrapColumn: 120,
                    wrappingStrategy: 'advanced',
                    minimap: { enabled: false },
                    scrollbar: {
                        useShadows: false,
                        horizontal: 'auto',
                        vertical: 'auto',
                        horizontalScrollbarSize: 8,
                        verticalScrollbarSize: 8,
                        alwaysConsumeMouseWheel: true,
                    },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    lineNumbers: "off",
                    overviewRulerLanes: 0,
                    overviewRulerBorder: false,
                    glyphMargin: false,
                    lineDecorationsWidth: 0,
                    folding: false,
                    renderLineHighlight: 'none',
                    hideCursorInOverviewRuler: true,
                    readOnly: readonly,
                    contextmenu: !readonly,
                    unicodeHighlight: {
                        ambiguousCharacters: false,
                        invisibleCharacters: false,
                        nonBasicASCII: false
                    },
                }}
            />
        </div>
    );
};

export default TextHugEditor;