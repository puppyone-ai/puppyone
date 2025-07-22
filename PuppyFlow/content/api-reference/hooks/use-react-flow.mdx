---
description:
  'This hook returns a ReactFlowInstance that can be used to update nodes and
  edges, manipulate the viewport, or query the current state of the flow.'
---

# useReactFlow()

[Source on GitHub](https://github.com/xyflow/xyflow/blob/main/packages/react/src/hooks/useReactFlow.ts)

This hook returns a [`ReactFlowInstance`](/api-reference/types/react-flow-instance) that can
be used to update nodes and edges, manipulate the viewport, or query the current
state of the flow.

```jsx
import { useCallback, useState } from 'react';
import { useReactFlow } from '@xyflow/react';

export function NodeCounter() {
  const reactFlow = useReactFlow();
  const [count, setCount] = useState(0);
  const countNodes = useCallback(() => {
    setCount(reactFlow.getNodes().length);
    // you need to pass it as a dependency if you are using it with useEffect or useCallback
    // because at the first render, it's not initialized yet and some functions might not work.
  }, [reactFlow]);

  return (
    <div>
      <button onClick={countNodes}>Update count</button>
      <p>There are {count} nodes in the flow.</p>
    </div>
  );
}
```

## Signature

<APIDocs functionName="useReactFlow" />

## TypeScript

This hook accepts a generic type argument of custom node & edge types. See this
[section in our TypeScript guide](/learn/advanced-use/typescript#nodetype-edgetype-unions) for more information.

```tsx
const reactFlow = useReactFlow<CustomNodeType, CustomEdgeType>();
```

## Notes

- This hook can only be used in a component that is a child of a
  [`<ReactFlowProvider />`](/api-reference/react-flow-provider) or a
  [`<ReactFlow />`](/api-reference/react-flow) component.
- Unlike [`useNodes`](/api-reference/hooks/use-nodes) or [`useEdges`](/api-reference/hooks/use-edges), this hook won't
  cause your component to re-render when state changes. Instead, you can query
  the state when you need it by using methods on the [`ReactFlowInstance`](/api-reference/types/react-flow-instance)
  this hook returns.
