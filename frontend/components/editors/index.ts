/**
 * JSON Editors Collection
 *
 * ├── tree/           - Tree-based editors with visual hierarchy
 * │   ├── JsonEditorComponent     - Original jsoneditor library
 * │   └── TreeLineVirtualEditor   - Virtual scrolling (high performance)
 * │
 * ├── code/           - Code/text-based editors
 * │   ├── MonacoJsonEditor        - VS Code engine
 * │   └── CodeMirrorJsonEditor    - CodeMirror 6
 * │
 * └── vanilla/        - Svelte-based editor
 *     └── VanillaJsonEditor       - svelte-jsoneditor (recommended)
 *
 * Performance comparison (10,000 nodes):
 * - VanillaJsonEditor: ⚡⚡⚡⚡⚡ (best, virtual scrolling built-in)
 * - TreeLineVirtualEditor: ⚡⚡⚡⚡ (virtual scrolling)
 * - MonacoJsonEditor: ⚡⚡⚡ (text-based, handles large files)
 * - JsonEditorComponent: ⚡⚡ (original jsoneditor)
 * - CodeMirrorJsonEditor: ⚡⚡⚡ (text-based)
 */

// Tree-based editors
export { JsonEditorComponent, TreeLineDiscreteEditor as TreeLineVirtualEditor } from './tree';

// Code-based editors
export { MonacoJsonEditor, CodeMirrorJsonEditor } from './code';

// Vanilla (Svelte-based) editor
export { VanillaJsonEditor } from './vanilla';

// Editor types (simplified - only 3 main editors)
export type EditorType = 'treeline-virtual' | 'vanilla' | 'monaco';

// Editor metadata
export const EDITOR_OPTIONS: {
  id: EditorType;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    id: 'treeline-virtual',
    label: 'Tree',
    icon: '├─',
    description: 'Tree view with connection lines (virtual scrolling)',
  },
  {
    id: 'vanilla',
    label: 'Pro',
    icon: '⚡',
    description: 'Full-featured editor (svelte-jsoneditor)',
  },
  {
    id: 'monaco',
    label: 'Raw',
    icon: '{ }',
    description: 'Raw JSON text editor (VS Code engine)',
  },
];
