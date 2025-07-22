---
description:
  'In some cases, you might need to access the store directly. This hook returns
  the store object which can be used on demand to access the state or dispatch
  actions.'
---

# useStoreApi()

[Source on GitHub](https://github.com/xyflow/xyflow/blob/main/packages/react/src/hooks/useStore.ts)

In some cases, you might need to access the store directly. This hook returns the store object which can be used on demand to access the state or dispatch actions.

> [!NOTE]
>
> This hook should only be used if there is no other way to access the internal
> state. For many of the common use cases, there are dedicated hooks available
> such as [`useReactFlow`](/api-reference/hooks/use-react-flow),
> [`useViewport`](/api-reference/hooks/use-viewport), etc.


```tsx
import { useState, useCallback } from 'react';
import { ReactFlow, useStoreApi } from '@xyflow/react';

const NodesLengthDisplay = () => {
  const [nodesLength, setNodesLength] = useState(0);
  const store = useStoreApi();

  const onClick = useCallback(() => {
    const { nodes } = store.getState();
    const length = nodes.length || 0;

    setNodesLength(length);
  }, [store]);

  return (
    <div>
      <p>The current number of nodes is: {nodesLength}</p>
      <button onClick={onClick}>Update node length.</button>
    </div>
  );
};

function Flow() {
  return (
    <ReactFlow nodes={nodes}>
      <NodesLengthLogger />
    </ReactFlow>
  );
}
```

This example computes the number of nodes in the flow _on-demand_. This is in
contrast to the example in the [`useStore`](/api-reference/hooks/use-store) hook that re-renders
the component whenever the number of nodes changes.

Choosing whether to calculate values on-demand or to subscribe to changes as they
happen is a bit of a balancing act. On the one hand, putting too many heavy
calculations in an event handler can make your app feel sluggish or unresponsive.
On the other hand, computing values eagerly can lead to slow or unnecessary
re-renders.

We make both this hook and [`useStore`](/api-reference/hooks/use-store) available so that you can
choose the approach that works best for your use-case.

## Signature

<APIDocs functionName="useStoreApi" />

## TypeScript

This hook accepts a generic type argument of custom node & edge types. See this
[section in our TypeScript guide](/learn/advanced-use/typescript#nodetype-edgetype-unions) for more information.

```tsx
const store = useStoreApi<CustomNodeType, CustomEdgeType>();
```
