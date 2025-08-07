# VS Code Style JSON Tree Editor

A React component that provides a VS Code-like tree editor for JSON data with expand/collapse functionality, inline editing, and context menus.

## Features

- **Tree Structure**: Display JSON data in an expandable/collapsible tree format
- **VS Code Styling**: Dark theme with VS Code-like colors and typography
- **Inline Editing**: Edit values directly in the tree with type selection
- **Context Menu**: Right-click to add/delete nodes or copy values
- **Type Support**: Handle strings, numbers, booleans, null, objects, and arrays
- **Keyboard Navigation**: Use Enter to save, Escape to cancel editing
- **Add/Delete Operations**: Add new properties/array items, delete nodes
- **Copy Functionality**: Copy values to clipboard

## Components

### RichJSONTreeEditor
Main editor component that handles JSON parsing and provides the tree interface.

**Props:**
- `value?: string` - JSON string to edit
- `onChange?: (value: string) => void` - Callback when JSON changes
- `readonly?: boolean` - Whether the editor is read-only
- `placeholder?: string` - Placeholder text when empty
- `widthStyle?: number` - Width (0 for 100%)
- `heightStyle?: number` - Height (0 for 100%)
- `preventParentDrag: () => void` - Callback to prevent parent drag
- `allowParentDrag: () => void` - Callback to allow parent drag

### TreeNode
Individual tree node component for recursive rendering.

### TreeValueEditor
Inline editor for primitive values with type selection.

### TreeContext
Context provider for managing tree state (expansion, selection).

## Usage

```tsx
import { RichJSONTreeEditor } from './components/tableComponent/RichJSONFormTreeStyle';

function MyComponent() {
  const [jsonData, setJsonData] = useState('{"name": "example"}');

  return (
    <RichJSONTreeEditor
      value={jsonData}
      onChange={setJsonData}
      preventParentDrag={() => {}}
      allowParentDrag={() => {}}
      placeholder="Enter JSON data..."
    />
  );
}
```

## Demo

See `demo.tsx` for a complete example with side-by-side tree editor and raw JSON view.

## Styling

The component uses VS Code's color scheme:
- Background: `#1e1e1e`
- Text: `#cccccc`
- Borders: `#3c3c3c`
- Strings: `#ce9178`
- Numbers: `#b5cea8`  
- Booleans/Keywords: `#569cd6`
- Properties: `#9cdcfe`

## Keyboard Shortcuts

- **Click**: Select node / toggle expansion / start editing
- **Right Click**: Open context menu
- **Enter**: Save edit
- **Escape**: Cancel edit
- **Arrow Keys**: Navigate tree (when focused)