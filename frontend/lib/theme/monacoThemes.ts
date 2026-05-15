type MonacoLike = {
  editor: {
    defineTheme: (name: string, theme: Record<string, unknown>) => void;
  };
};

const CODE_DARK = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: '', foreground: 'd4d4d4', background: '0e0e0e' },
    { token: 'comment', foreground: '6b7280', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'f97316' },
    { token: 'string', foreground: '86efac' },
    { token: 'number', foreground: '7dd3fc' },
    { token: 'delimiter', foreground: '737373' },
    { token: 'type', foreground: 'a5b4fc' },
  ],
  colors: {
    'editor.background': '#0e0e0e',
    'editor.foreground': '#d4d4d4',
    'editor.lineHighlightBackground': '#141414',
    'editor.selectionBackground': '#3f3f46',
    'editor.inactiveSelectionBackground': '#3f3f4655',
    'editorLineNumber.foreground': '#404040',
    'editorLineNumber.activeForeground': '#737373',
    'editorCursor.foreground': '#d4d4d4',
    'editor.selectionHighlightBackground': '#52525b33',
    'editorIndentGuide.background': '#1a1a1a',
    'editorIndentGuide.activeBackground': '#262626',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#40404055',
    'scrollbarSlider.hoverBackground': '#52525b88',
    'scrollbarSlider.activeBackground': '#52525b88',
  },
};

const CODE_LIGHT = {
  base: 'vs' as const,
  inherit: true,
  rules: [
    { token: '', foreground: '2f2a23', background: 'fbf6ed' },
    { token: 'comment', foreground: '8a8175', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cf222e' },
    { token: 'string', foreground: '116329' },
    { token: 'number', foreground: '0550ae' },
    { token: 'delimiter', foreground: '9a9084' },
    { token: 'type', foreground: '8250df' },
  ],
  colors: {
    'editor.background': '#fbf6ed',
    'editor.foreground': '#2f2a23',
    'editor.lineHighlightBackground': '#efe7db',
    'editor.selectionBackground': '#b6d6ff',
    'editor.inactiveSelectionBackground': '#dbeafeaa',
    'editorLineNumber.foreground': '#aaa197',
    'editorLineNumber.activeForeground': '#70685e',
    'editorCursor.foreground': '#2f2a23',
    'editor.selectionHighlightBackground': '#0969da22',
    'editorIndentGuide.background': '#e1d8cb',
    'editorIndentGuide.activeBackground': '#c8bdaf',
    'scrollbar.shadow': '#00000000',
    'scrollbarSlider.background': '#8c959f44',
    'scrollbarSlider.hoverBackground': '#6e778166',
    'scrollbarSlider.activeBackground': '#6e778188',
  },
};

const JSON_DARK = {
  ...CODE_DARK,
  rules: [
    ...CODE_DARK.rules,
    { token: 'string.key.json', foreground: 'a5b4fc' },
    { token: 'string.value.json', foreground: '86efac' },
  ],
};

const JSON_LIGHT = {
  ...CODE_LIGHT,
  rules: [
    ...CODE_LIGHT.rules,
    { token: 'string.key.json', foreground: '0550ae' },
    { token: 'string.value.json', foreground: '116329' },
  ],
};

const MARKDOWN_DARK = {
  ...CODE_DARK,
  rules: [
    ...CODE_DARK.rules,
    { token: 'markup.heading', foreground: 'f9fafb', fontStyle: 'bold' },
    { token: 'markup.bold', fontStyle: 'bold' },
    { token: 'markup.italic', fontStyle: 'italic' },
    { token: 'markup.inline.raw', foreground: '86efac' },
    { token: 'markup.quote', foreground: '6b7280' },
    { token: 'markup.list', foreground: 'f97316' },
  ],
};

const MARKDOWN_LIGHT = {
  ...CODE_LIGHT,
  rules: [
    ...CODE_LIGHT.rules,
    { token: 'markup.heading', foreground: '111827', fontStyle: 'bold' },
    { token: 'markup.bold', fontStyle: 'bold' },
    { token: 'markup.italic', fontStyle: 'italic' },
    { token: 'markup.inline.raw', foreground: '116329' },
    { token: 'markup.quote', foreground: '6e7781' },
    { token: 'markup.list', foreground: 'cf222e' },
  ],
};

export function definePuppyoneMonacoThemes(monaco: MonacoLike) {
  monaco.editor.defineTheme('po-code-dark', CODE_DARK);
  monaco.editor.defineTheme('po-code-light', CODE_LIGHT);
  monaco.editor.defineTheme('po-json-dark', JSON_DARK);
  monaco.editor.defineTheme('po-json-light', JSON_LIGHT);
  monaco.editor.defineTheme('po-markdown-dark', MARKDOWN_DARK);
  monaco.editor.defineTheme('po-markdown-light', MARKDOWN_LIGHT);
}

export function getPuppyoneMonacoTheme(kind: 'code' | 'json' | 'markdown', resolvedTheme?: string) {
  return `po-${kind}-${resolvedTheme === 'light' ? 'light' : 'dark'}`;
}
