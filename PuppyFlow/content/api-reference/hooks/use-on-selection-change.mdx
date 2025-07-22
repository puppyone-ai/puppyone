---
description:
  'This hook lets you listen for changes to both node and edge selection. As the
  name implies, the callback you provide will be called whenever the selection of
  either nodes or edges changes.'
---

# useOnSelectionChange()

[Source on GitHub](https://github.com/xyflow/xyflow/blob/main/packages/react/src/hooks/useOnSelectionChange.ts)

This hook lets you listen for changes to both node and edge selection. As the
name implies, the callback you provide will be called whenever the selection of
_either_ nodes or edges changes.

> [!WARNING]
>
> You need to memoize the passed `onChange` handler, otherwise the hook will not
> work correctly.

```jsx
import { useState } from 'react';
import { ReactFlow, useOnSelectionChange } from '@xyflow/react';

function SelectionDisplay() {
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [selectedEdges, setSelectedEdges] = useState([]);

  // the passed handler has to be memoized, otherwise the hook will not work correctly
  const onChange = useCallback(({ nodes, edges }) => {
    setSelectedNodes(nodes.map((node) => node.id));
    setSelectedEdges(edges.map((edge) => edge.id));
  }, []);

  useOnSelectionChange({
    onChange,
  });

  return (
    <div>
      <p>Selected nodes: {selectedNodes.join(', ')}</p>
      <p>Selected edges: {selectedEdges.join(', ')}</p>
    </div>
  );
}
```

## Signature

<APIDocs functionName="useOnSelectionChange" />

## Notes

- This hook can only be used in a component that is a child of a
  [`<ReactFlowProvider />`](/api-reference/react-flow-provider) or a
  [`<ReactFlow />`](/api-reference/react-flow) component.
