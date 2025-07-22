---
title: The MiniMap component
sidebarTitle: '<MiniMap />'
description:
  'The MiniMap component can be used to render an overview of your flow. It renders
  each node as an SVG element and visualizes where the current viewport is in
  relation to the rest of the flow.'
---

# \<MiniMap />

[Source on GitHub](https://github.com/xyflow/xyflow/blob/main/packages/react/src/additional-components/MiniMap/MiniMap.tsx)

The `<MiniMap />` component can be used to render an overview of your flow. It
renders each node as an SVG element and visualizes where the current viewport is
in relation to the rest of the flow.

```jsx
import { ReactFlow, MiniMap } from '@xyflow/react';

export default function Flow() {
  return (
    <ReactFlow nodes={[...]]} edges={[...]]}>
      <MiniMap nodeStrokeWidth={3} />
    </ReactFlow>
  );
}
```

## Props

For TypeScript users, the props type for the `<MiniMap />` component is exported
as `MiniMapProps`.

<APIDocs componentName="MiniMap" groupKeys="Omit<HTMLAttributes<SVGSVGElement>, 'onClick'>" />

## Examples

### Making the mini map interactive

By default, the mini map is non-interactive. To allow users to interact with the
viewport by panning or zooming the minimap, you can set either of the `zoomable`
or `pannable` (or both!) props to `true`.

```jsx
import { ReactFlow, MiniMap } from '@xyflow/react';

export default function Flow() {
  return (
    <ReactFlow nodes={[...]]} edges={[...]]}>
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
```

### Implement a custom mini map node

It is possible to pass a custom component to the `nodeComponent` prop to change
how nodes are rendered in the mini map. If you do this you **must** use only
SVG elements in your component if you want it to work correctly.

```jsx
import { ReactFlow, MiniMap } from '@xyflow/react';

export default function Flow() {
  return (
    <ReactFlow nodes={[...]]} edges={[...]]}>
      <MiniMap nodeComponent={MiniMapNode} />
    </ReactFlow>
  );
}

function MiniMapNode({ x, y }) {
  return <circle cx={x} cy={y} r="50" />;
}
```

Check out the documentation for [`MiniMapNodeProps`](/api-reference/types/mini-map-node-props)
to see what props are passed to your custom component.

### Customising mini map node color

The `nodeColor`, `nodeStrokeColor`, and `nodeClassName` props can be a function
that takes a [`Node`](/api-reference/types/node) and computes a value for the prop. This can
be used to customize the appearance of each mini map node.

This example shows how to color each mini map node based on the node's type:

```jsx
import { ReactFlow, MiniMap } from '@xyflow/react';

export default function Flow() {
  return (
    <ReactFlow nodes={[...]]} edges={[...]]}>
      <MiniMap nodeColor={nodeColor} />
    </ReactFlow>
  );
}

function nodeColor(node) {
  switch (node.type) {
    case 'input':
      return '#6ede87';
    case 'output':
      return '#6865A5';
    default:
      return '#ff0072';
  }
}
```

## TypeScript

This component accepts a generic type argument of custom node types. See this
[section in our Typescript guide](/learn/advanced-use/typescript#nodetype-edgetype-unions) for more information.

```tsx
<MiniMap<CustomNodeType> nodeColor={nodeColor} />
```
