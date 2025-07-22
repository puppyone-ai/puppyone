---
description: Strategies to optimize React Flow performance for large graphs.
---

# Performance

When dealing with a large number of nodes or complex components, managing performance can
be challenging. Here are a few effective strategies to optimize the performance of React
Flow.

## Use memoization

One of the main reasons for performance issues in React Flow is unnecessary re-renders.
Since node movements trigger frequent state updates, this can lead to performance
bottlenecks, especially in larger diagrams.

### Memoize components

Components provided as props to the `<ReactFlow>` component, including custom node and
edge components, should either be memoized using `React.memo` or declared outside the
parent component. This ensures that React does not create a new reference for the
component on every render, which would otherwise trigger unnecessary re-renders.

```tsx
const NodeComponent = memo(() => {
  return <div>{data.label}</div>;
});
```

### Memoize functions

Similarly, functions passed as props to `<ReactFlow>` should be memoized using
`useCallback`. This prevents React from creating a new function reference on every render,
which could also trigger unnecessary re-renders. Additionally, arrays and objects like
`defaultEdgeOptions` or `snapGrid` should be memoized using `useMemo` to prevent
unnecessary re-renders.

```tsx
import React, { useCallback } from 'react';

const MyDiagram = () => {
  const onNodeClick = useCallback((event, node) => {
    console.log('Node clicked:', node);
  }, []);

  return <ReactFlow onNodeClick={onNodeClick} />;
};

export default MyDiagram;
```

## Avoid accessing nodes in components

One of the most common performance pitfalls in React Flow is directly accessing
the `nodes` or `edges` in the components or the viewport. These objects change frequently
during operations like dragging, panning, or zooming, which can cause unnecessary
re-renders of components that depend on them.

For example, if you fetch the entire `nodes` array from the store and filter it to display
selected node IDs, this approach can lead to performance degradation. Every update to
the `nodes` array triggers a re-render of all dependent components, even if the change is
unrelated to the selected nodes.

### Inefficient example

```tsx
const SelectedNodeIds = () => {
  // ❌ This will cause unnecessary re-renders!

  const nodes = useStore((state) => state.nodes);

  const selectedNodeIds = nodes.filter((node) => node.selected).map((node) => node.id);

  return (
    <div>
      {selectedNodeIds.map((id) => (
        <div key={id}>{id}</div>
      ))}
    </div>
  );
};
```

In this example, every update to the `nodes` array causes the `SelectedNodeIds` component
to re-render, even if the selection hasn’t changed.

### Optimized solution

To avoid unnecessary re-renders, store the selected nodes in a separate field in your
state (using Zustand, Redux, or any other state management solution). This ensures that
the component only re-renders when the selection changes.

```tsx
const SelectedNodeIds = () => {
  const selectedNodeIds = useStore((state) => state.selectedNodeIds);

  return (
    <div>
      {selectedNodeIds.map((id) => (
        <div key={id}>{id}</div>
      ))}
    </div>
  );
};
```

By decoupling the selected nodes from the `nodes` array, you prevent unnecessary updates
and improve performance. For more information, view our
[State Management guide](/learn/advanced-use/state-management).

## Collapse large node trees

If your node tree is deeply nested, rendering all nodes at once can be inefficient.
Instead, show only a limited number of nodes and allow users to expand them as needed. You
can do this by modifying the node’s `hidden` property dynamically to toggle visibility.

```tsx
const handleNodeClick = (targetNode) => {
  if (targetNode.data.children) {
    setNodes((prevNodes) =>
      prevNodes.map((node) =>
        targetNode.data.children.includes(node.id)
          ? { ...node, hidden: !node.hidden }
          : node,
      ),
    );
  }
};
```

By hiding nodes initially and rendering them only when expanded, we optimize performance
while maintaining usability.

## Simplify node and edge styles

If you've optimized performance in every other way, and you are still finding performance
issues with large numbers of nodes, complex CSS styles, particularly those involving
animations, shadows, or gradients, can significantly impact performance. Consider reducing
complexity on your node styles in these cases.

## Additional resources

Here are a few helpful resources on performance in React Flow that you can check out:

- [Guide to Optimize React Flow Project Performance](https://www.synergycodes.com/blog/guide-to-optimize-react-flow-project-performance)
- [Tuning Edge Animations ReactFlow Optimal Performance](https://liambx.com/blog/tuning-edge-animations-reactflow-optimal-performance)
- [5 Ways to Optimize React Flow in 10 minutes](https://www.youtube.com/watch?v=8M2qZ69iM20)
