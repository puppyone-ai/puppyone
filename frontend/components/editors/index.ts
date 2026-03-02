/**
 * JSON Editors Collection
 *
 * ├── table/          - Table-based discrete editor
 * │   └── TableDiscreteEditor
 * │
 * ├── code/           - Code/text-based editors
 * │   ├── MonacoJsonEditor        - VS Code engine
 * │   └── CodeMirrorJsonEditor    - CodeMirror 6
 * │
 * └── vanilla/        - Svelte-based editor
 *     └── VanillaJsonEditor       - svelte-jsoneditor (recommended)
 */

// Table-based editor
export { TableDiscreteEditor } from './table';

// Code-based editors
export { MonacoJsonEditor, CodeMirrorJsonEditor } from './code';

// Vanilla (Svelte-based) editor
export { VanillaJsonEditor } from './vanilla';

// Editor types
export type EditorType = 'table' | 'monaco';

// Editor metadata
export const EDITOR_OPTIONS: {
  id: EditorType;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: 'table',
    label: 'Table',
    icon: '⊞',
    description: 'Structured table view',
  },
  {
    id: 'monaco',
    label: 'Raw',
    icon: '{ }',
    description: 'Raw JSON text editor (VS Code engine)',
  },
];
