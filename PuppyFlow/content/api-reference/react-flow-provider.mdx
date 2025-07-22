---
title: The ReactFlowProvider component
sidebarTitle: <ReactFlowProvider />
---

# \<ReactFlowProvider />

[Source on GitHub](https://github.com/xyflow/xyflow/blob/main/packages/react/src/components/ReactFlowProvider/index.tsx/#L9)

The `<ReactFlowProvider />` component is a
[context provider](https://react.dev/learn/passing-data-deeply-with-context#) that
makes it possible to access a flow's internal state outside of the
[`<ReactFlow />`](/api-reference/react-flow) component. Many of the hooks we
provide rely on this component to work.

```tsx
import { ReactFlow, ReactFlowProvider, useNodes } from '@xyflow/react'

export default function Flow() {
  return (
    <ReactFlowProvider>
      <ReactFlow nodes={...} edges={...} />
      <Sidebar />
    </ReactFlowProvider>
  )
}

function Sidebar() {
  // This hook will only work if the component it's used in is a child of a
  // <ReactFlowProvider />.
  const nodes = useNodes()

  return (
    <aside>
      {nodes.map((node) => (
        <div key={node.id}>
          Node {node.id} -
            x: {node.position.x.toFixed(2)},
            y: {node.position.y.toFixed(2)}
        </div>
      ))}
    </aside>
  )
}
```

## Props

<APIDocs componentName="ReactFlowProvider" />

## Notes

- If you're using a router and want your flow's state to persist across routes,
  it's vital that you place the `<ReactFlowProvider />` component _outside_ of
  your router.
- If you have multiple flows on the same page you will need to use a separate
  `<ReactFlowProvider />` for each flow.
