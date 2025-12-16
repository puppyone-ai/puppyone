# JSON Editors

This folder contains all JSON editor implementations used in the application.

## 📁 Structure

```
editors/
├── tree/                    # Tree-based visual editors
│   ├── JsonEditorComponent.tsx    # Original jsoneditor library wrapper
│   ├── TreeLineVirtualEditor.tsx  # Virtual scrolling with ├─ └─ lines (high performance)
│   └── index.ts
│
├── code/                    # Code/text-based editors
│   ├── MonacoJsonEditor.tsx       # Monaco Editor (VS Code engine)
│   ├── CodeMirrorJsonEditor.tsx   # CodeMirror 6
│   └── index.ts
│
├── vanilla/                 # Svelte-based editor
│   ├── VanillaJsonEditor.tsx      # svelte-jsoneditor wrapper
│   └── index.ts
│
├── index.ts                 # Main exports
└── README.md
```

## ⚡ Performance Comparison

| Editor | 100 nodes | 1K nodes | 10K nodes | 100K nodes |
|--------|-----------|----------|-----------|------------|
| VanillaJsonEditor | ✅ | ✅ | ✅ | ✅ |
| TreeLineVirtualEditor | ✅ | ✅ | ✅ | ✅ |
| MonacoJsonEditor | ✅ | ✅ | ✅ | 🟡 |
| CodeMirrorJsonEditor | ✅ | ✅ | 🟡 | 🟡 |
| JsonEditorComponent | ✅ | ✅ | 🟡 | 🔴 |

## 🎨 Features Comparison

| Editor | Tree View | Connection Lines | Virtual Scroll | Edit | Search | Undo/Redo |
|--------|-----------|------------------|----------------|------|--------|-----------|
| VanillaJsonEditor | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| TreeLineVirtualEditor | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| JsonEditorComponent | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| MonacoJsonEditor | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |
| CodeMirrorJsonEditor | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ |

## 📖 Usage

```tsx
import dynamic from 'next/dynamic'

// Dynamic import (recommended for SSR)
const VanillaJsonEditor = dynamic(
  () => import('./editors/vanilla/VanillaJsonEditor'),
  { ssr: false }
)

// In component
<VanillaJsonEditor
  json={data}
  onChange={(newJson) => setData(newJson)}
  onPathChange={(path) => console.log('Selected:', path)}
/>
```

## 🔧 Adding a New Editor

1. Create a new folder or add to existing category
2. Implement the standard interface:
   ```tsx
   interface EditorProps {
     json: object
     onChange?: (json: object) => void
     onPathChange?: (path: string | null) => void
   }
   ```
3. Export from the category's `index.ts`
4. Add to main `editors/index.ts`
5. Update `ProjectWorkspaceView.tsx` with dynamic import
6. Add to `ProjectsHeader.tsx` editor options

