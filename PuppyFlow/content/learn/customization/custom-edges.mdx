---
sidebarTitle: Edges
description:
  Like custom nodes, parts of a custom edge in React Flow are just React components.
  This guide shows you how to implement a custom edge with some additional controls.
---

import { Callout, Steps } from 'nextra/components';
import { Image } from 'xy-shared';
import { RemoteCodeViewer } from 'xy-shared/server';

# Custom Edges

Like [custom nodes](/learn/customization/custom-nodes), parts of a custom edge
in React Flow are just React components. That means you can render anything you
want along an edge! This guide shows you how to implement a custom edge with
some additional controls. For a comprehensive reference of props available for
custom edges, see the [Edge](/api-reference/types/edge-props) reference.

## A basic custom edge

An edge isn't much use to us if it doesn't render a path between two connected
nodes. These paths are always SVG-based and are typically rendered using the
[`<BaseEdge />`](/api-reference/components/base-edge) component. To calculate
the actual SVG path to render, React Flow comes with some handy utility functions:

- [`getBezierPath`](/api-reference/utils/get-bezier-path)
- [`getSimpleBezierPath`](/api-reference/utils/get-simple-bezier-path)
- [`getSmoothStepPath`](/api-reference/utils/get-smooth-step-path)
- [`getStraightPath`](/api-reference/utils/get-straight-path)

To kickstart our custom edge, we'll just render a straight path between the
source and target.

<Steps>

### Create the component

We start by creating a new React component called `CustomEdge`. Then we render
the [`<BaseEdge />`](/api-reference/components/base-edge) component with the
calculated path. This gives us a straight edge that behaves the same as the
built-in default [edge version](/api-reference/types/edge#default-edge-types)
`"straight"`.

```jsx
import { BaseEdge, getStraightPath } from '@xyflow/react';

export function CustomEdge({ id, sourceX, sourceY, targetX, targetY }) {
  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
    </>
  );
}
```

### Create `edgeTypes`

Outside of our component, we define an `edgeTypes` object.
We name our new edge type `"custom-edge"` and assign the `CustomEdge` component
we just created to it.

```jsx
const edgeTypes = {
  'custom-edge': CustomEdge,
};
```

### Pass the `edgeTypes` prop

To use it, we also need to update the
[`edgeTypes`](/api-reference/react-flow#edge-types) prop on the
`<ReactFlow />` component.

```jsx "edgeTypes={edgeTypes}"
export function Flow() {
  return <ReactFlow edgeTypes={edgeTypes} />;
}
```

### Use the new edge type

After defining the `edgeTypes` object, we can use our new custom edge by setting
the `type` field of an edge to `"custom-edge"`.

```jsx {6}
const initialEdges = [
  {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    type: 'custom-edge',
  },
];
```

### Flow with a custom edge

<RemoteCodeViewer route="learn/custom-edge" framework="react" />

</Steps>

## Custom SVG edge paths

As discussed previously, if you want to make a custom edge in React Flow, you
have to use either of the four path creation functions discussed above
(e.g [`getBezierPath`](/api-reference/utils/get-bezier-path)). However if you
want to make some other path shape like a Sinusoidal edge or some other edge
type then you will have to make the edge path yourself.

The edge path we get from functions like
[`getBezierPath`](/api-reference/utils/get-bezier-path) is just a path string
which we pass into the `path` prop of the `<BaseEdge />` component. It contains
the necessary information needed in order to draw that path, like where it
should start from, where it should curve, where it should end, etc. A simple
straight path string between two points `(x1, y1)` to `(x2, y2)` would look like:

```jsx
M x1 y1 L x2 y2
```

An SVG path is a concatenated list of commands like `M`, `L`, `Q`, etc, along
with their values. Some of these commands are listed below, along with their
supported values.

- `M x1 y1` is the Move To command which moves the current point to the x1, y1
  coordinate.
- `L x1 y1` is the Line To command which draws a line from the current point to
  x1, y1 coordinate.
- `Q x1 y1 x2 y2` is the Quadratic Bezier Curve command which draws a bezier
  curve from the current point to the x2, y2 coordinate. x1, y1 is the control
  point of the curve which determines the curviness of the curve.

Whenever we want to start a path for our custom edge, we use the `M` command to
move our current point to `sourceX, sourceY` which we get as props in the custom
edge component. Then based on the shape we want, we will use other commands like
`L`(to make lines), `Q`(to make curves) and then finally end our path at
`targetX, targetY` which we get as props in the custom edge component.

If you want to learn more about SVG paths, you can check out
[SVG-Path-Editor](https://yqnn.github.io/svg-path-editor/). You can paste any
SVG path there and analyze individual path commands via an intuitive UI.

Here is an example with two types of custom edge paths, a Step edge and a
Sinusoidal edge. You should look at the Step edge first to get your hands dirty
with custom SVG paths since it's simple, and then look at how the Sinusoidal
edge is made. After going through this example, you will have the necessary
knowledge to make custom SVG paths for your custom edges.

<RemoteCodeViewer route="learn/custom-edge-path" framework="react" />
