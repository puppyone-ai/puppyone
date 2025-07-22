---
description: Troubleshooting and fixes for common issues with React Flow.
---

# Common Errors

import { Callout } from 'nextra/components';

This guide contains warnings and errors that can occur when using React Flow. We are also
adding common questions and pitfalls that we collect from our
[Discord Server](https://discord.gg/RVmnytFmGW),
[Github Issues](https://github.com/xyflow/xyflow/issues) and
[Github Discussions](https://github.com/xyflow/xyflow/discussions).

<div id="001" />
### Warning: Seems like you have not used zustand provider as an ancestor.

This usually happens when:

**A:** You have two different versions of @reactflow/core installed.<br /> **B:** You are
trying to access the internal React Flow state outside of the React Flow context.

#### Solution for A

Update reactflow and @reactflow/node-resizer (in case you are using it), remove
node_modules and package-lock.json and reinstall the dependencies.

#### Solution for B

A possible solution is to wrap your component with a
[`<ReactFlowProvider />`](/api-reference/react-flow-provider) or move the code that is
accessing the state inside a child of your React Flow instance.

<Callout type="error">This will cause an error:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

function FlowWithoutProvider(props) {
  // cannot access the state here
  const reactFlowInstance = useReactFlow();

  return <ReactFlow {...props} />;
}

export default FlowWithoutProvider;
```

<Callout type="error">This will cause an error, too:</Callout>

```jsx
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

function Flow(props) {
  // still cannot access the state here
  // only child components of this component can access the state
  const reactFlowInstance = useReactFlow();

  return (
    <ReactFlowProvider>
      <ReactFlow {...props} />
    </ReactFlowProvider>
  );
}

export default FlowWithProvider;
```

<Callout type="info">This works:</Callout>

As soon as you want to access the internal state of React Flow (for example by using the
`useReactFlow` hook), you need to wrap your component with a `<ReactFlowProvider />`. Here
the wrapping is done outside of the component:

```jsx
import { ReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

function Flow(props) {
  // you can access the internal state here
  const reactFlowInstance = useReactFlow();

  return <ReactFlow {...props} />;
}

// wrapping with ReactFlowProvider is done outside of the component
function FlowWithProvider(props) {
  return (
    <ReactFlowProvider>
      <Flow {...props} />
    </ReactFlowProvider>
  );
}

export default FlowWithProvider;
```

<div id="002" />
### It looks like you have created a new nodeTypes or edgeTypes object.

If this wasn't on purpose please define the nodeTypes/edgeTypes outside of the component
or memoize them.

This warning appears when the `nodeTypes` or `edgeTypes` properties change after the
initial render. The `nodeTypes` or `edgeTypes` should only be changed dynamically in very
rare cases. Usually, they are defined once, along with all the types you use in your
application. It can happen easily that you are defining the nodeTypes or edgeTypes object
inside of your component render function, which will cause React Flow to re-render every
time your component re-renders.

<Callout type="error">Causes a warning:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MyCustomNode from './MyCustomNode';

function Flow(props) {
  // new object being created on every render
  // causing unnecessary re-renders
  const nodeTypes = {
    myCustomNode: MyCustomNode,
  };

  return <ReactFlow nodeTypes={nodeTypes} />;
}

export default Flow;
```

<Callout type="info">Recommended implementation:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import MyCustomNode from './MyCustomNode';

// defined outside of the component
const nodeTypes = {
  myCustomNode: MyCustomNode,
};

function Flow(props) {
  return <ReactFlow nodeTypes={nodeTypes} />;
}

export default Flow;
```

<Callout type="info">Alternative implementation:</Callout>

You can use this if you want to change your nodeTypes dynamically without causing
unnecessary re-renders.

```jsx
import { useMemo } from 'react';
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MyCustomNode from './MyCustomNode';

function Flow(props) {
  const nodeTypes = useMemo(
    () => ({
      myCustomNode: MyCustomNode,
    }),
    [],
  );

  return <ReactFlow nodeTypes={nodeTypes} />;
}

export default Flow;
```

<div id="003" />
### Node type not found. Using fallback type "default".

This usually happens when you specify a custom node type for one of your nodes but do not
pass the correct nodeTypes property to React Flow. The string for the type option of your
custom node needs to be exactly the same as the key of the nodeTypes object.

<Callout type="error">Doesn't work:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MyCustomNode from './MyCustomNode';

const nodes = [
  {
    id: 'mycustomnode',
    type: 'custom',
    // ...
  },
];

function Flow(props) {
  // nodeTypes property is missing, so React Flow cannot find the custom node component to render
  return <ReactFlow nodes={nodes} />;
}
```

<Callout type="error">Doesn't work either:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MyCustomNode from './MyCustomNode';

const nodes = [
  {
    id: 'mycustomnode',
    type: 'custom',
    // ...
  },
];

const nodeTypes = {
  Custom: MyCustomNode,
};

function Flow(props) {
  // node.type and key in nodeTypes object are not exactly the same (capitalized)
  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} />;
}
```

<Callout type="info">This does work:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import MyCustomNode from './MyCustomNode';

const nodes = [
  {
    id: 'mycustomnode',
    type: 'custom',
    // ...
  },
];

const nodeTypes = {
  custom: MyCustomNode,
};

function Flow(props) {
  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} />;
}
```

<div id="004" />
### The React Flow parent container needs a width and a height to render the graph.

Under the hood, React Flow measures the parent DOM element to adjust the renderer. If you
try to render React Flow in a regular div without a height, we cannot display the graph.
If you encounter this warning, you need to make sure that your wrapper component has some
CSS attached to it so that it gets a fixed height or inherits the height of its parent.

<Callout type="error">This will cause the warning:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

function Flow(props) {
  return (
    <div>
      <ReactFlow {...props} />
    </div>
  );
}
```

<Callout type="info">Working example:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';

function Flow(props) {
  return (
    <div style={{ height: 800 }}>
      <ReactFlow {...props} />
    </div>
  );
}
```

<div id="005" />
### Only child nodes can use a parent extent.

This warning appears when you are trying to add the `extent` option to a node that does
not have a parent node. Depending on what you are trying to do, you can remove the
`extent` option or specify a `parentNode`.

<Callout type="error">Does show a warning:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const nodes = [
  {
    id: 'mycustomnode',
    extent: 'parent',
    // ...
  },
];

function Flow(props) {
  return <ReactFlow nodes={nodes} />;
}
```

<Callout type="info">Warning resolved:</Callout>

```jsx import { ReactFlow } from '@xyflow/react';
const nodes = [
  {
    id: 'mycustomnode',
    parentNode: 'someothernode',
    extent: 'parent',
    // ...
  },
];

function Flow(props) {
  return <ReactFlow nodes={nodes} />;
}
```

<div id="006" />
### Can't create edge. An edge needs a source and a target.

This happens when you do not pass a `source` and a `target` option to the edge object.
Without the source and target, the edge cannot be rendered.

<Callout type="error">Will show a warning:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const nodes = [
  /* ... */
];

const edges = [
  {
    nosource: '1',
    notarget: '2',
  },
];

function Flow(props) {
  return <ReactFlow nodes={nodes} edges={edges} />;
}
```

<Callout type="info">This works:</Callout>

```jsx
import { ReactFlow } from '@xyflow/react';

const nodes = [
  /* ... */
];

const edges = [
  {
    source: '1',
    target: '2',
  },
];

function Flow(props) {
  return <ReactFlow nodes={nodes} edges={edges} />;
}
```

<div id="007" />
### The old edge with id="some-id" does not exist.

This can happen when you are trying to [reconnect an edge](/examples/edges/reconnect-edge)
but the edge you want to update is already removed from the state. This is a very rare
case. Please see the [Reconnect Edge example](/examples/edges/reconnect-edge) for
implementation details.

<div id="008" />
### Couldn't create edge for source/target handle id: "some-id"; edge id: "some-id".

This can happen if you are working with multiple handles and a handle is not found by its
`id` property or if you haven't
[updated the node internals after adding or removing handles](/api-reference/hooks/use-update-node-internals)
programmatically. Please see the [Custom Node Example](/examples/nodes/custom-node) for an
example of working with multiple handles.

<div id="009" />
### Marker type doesn't exist.

This warning occurs when you are trying to specify a marker type that is not built into
React Flow. The existing marker types are documented
[here](/api-reference/types/edge#edgemarker).

<div id="010" />
### Handle: No node id found.

This warning occurs when you try to use a `<Handle />` component outside of a custom node
component.

### I get an error when building my app with webpack 4.

If you're using webpack 4, you'll likely run into an error like this:

```
ERROR in /node_modules/@reactflow/core/dist/esm/index.js 16:19
Module parse failed: Unexpected token (16:19)
You may need an appropriate loader to handle this file type, currently no loaders are configured to process this file. See https://webpack.js.org/concepts#loaders
```

React Flow is a modern JavaScript code base and makes use of lots of newer JavaScript
features. By default, webpack 4 does not transpile your code and it doesn't know how to
handle React Flow.

You need to add a number of babel plugins to your webpack config to make it work:

```sh npm2yarn copy
npm i --save-dev babel-loader@8.2.5 @babel/preset-env @babel/preset-react @babel/plugin-proposal-optional-chaining @babel/plugin-proposal-nullish-coalescing-operator
```

and configure the loader like this:

```js
{
  test: /node_modules[\/\\]@?reactflow[\/\\].*.js$/,
  use: {
    loader: 'babel-loader',
    options: {
      presets: ['@babel/preset-env', "@babel/preset-react"],
      plugins: [
        "@babel/plugin-proposal-optional-chaining",
        "@babel/plugin-proposal-nullish-coalescing-operator",
      ]
    }
  }
}
```

<Callout type="info">
  If you're using webpack 5, you don't need to do anything! React Flow will work out of
  the box.
</Callout>

### Mouse events aren't working consistently when my nodes contain a `<canvas />` element.

If you’re using a `<canvas />` element inside your custom node, you might run into
problems with seemingly incorrect coordinates in mouse events from the canvas.

React Flow uses CSS transforms to scale nodes as you zoom in and out. However, from the
DOM’s perspective, the element is still the same size. This can cause problems if you have
event listeners that want to calculate the mouse position relative to the canvas element.

To remedy this in event handlers you control, you can scale your computed relative
position by `1 / zoom` where `zoom` is the current zoom level of the flow. To get the
current zoom level, you can use the `getZoom` method from the
[`useReactFlow`](/api-reference/hooks/use-react-flow) hook.

### Edges are not displaying.

If your edges are not displaying in React Flow, this might be due to one of the following
reasons:

- You have not imported the React Flow stylesheet. If you haven't imported it, you can
  import it like `import '@xyflow/react/dist/style.css';`.
- If you have replaced your default nodes with a custom node, check if that custom node
  has appropriate `source/target` handles in the custom node component. An edge cannot be
  made without a handle.
- If you use an external styling library like Tailwind or Bulma, ensure it doesn't
  override the edge styles. For example, sometimes styling libraries override the
  `.react-flow__edges` SVG selector with `overflow: hidden`, which hides the edges.
- If you are using an async operation like a request to the backend, make sure to call the
  `updateNodeInternals` function returned by the
  [`useUpdateNodeInternal`](/api-reference/hooks/use-update-node-internals) hook after the
  async operation so React Flow updates the handle position internally.

### Edges are not displaying correctly.

If your edges are not rendering as they should, this could be due to one of the following
reasons:

- If you want to hide your handles, do not use `display: none` to hide them. Use either
  `opacity: 0` or `visibility: hidden`.
- If edges are not connected to the correct handle, check if you have added more than one
  handle of the same type(`source` or `target`) in your custom node component. If that is
  the case, assign IDs to them. Multiple handles of the same kind on a node need to have
  distinguishable IDs so that React Flow knows which handle an edge corresponds to.
- If you are changing the position of the handles (via reordering, etc.), make sure to
  call the `updateNodeInternals` function returned by the
  [`useUpdateNodeInternals`](/api-reference/hooks/use-update-node-internals) hook after so
  React Flow knows to update the handle position internally.
- If you are using a custom edge and want your edge to go from the source handle to a
  target handle, make sure to correctly pass the `sourceX, sourceY, targetX, and targetY`
  props you get from the custom edge component in the edge path creation function(e.g.,
  [`getBezierPath`](/api-reference/utils/get-bezier-path), etc.). `sourceX, sourceY`, and
  `targetX, targetY` represent the `x,y` coordinates for the source and target handle,
  respectively.
- If the custom edge from the source or target side is not going towards the handle as
  expected (entering or exiting from a handle at a weird angle), make sure to pass the
  `sourcePosition` and `targetPosition` props you get from the custom edge component in
  the edge path creation function(e.g.,
  [`getBezierPath`](/api-reference/utils/get-bezier-path)). Passing the source/target
  handle position in the path creation function is necessary for the edge to start or end
  properly at a handle.
