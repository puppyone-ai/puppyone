---
sidebarTitle: Migrate to v10
description: Use this guide to migrate from React Flow v9 to v10.
---

# Migrate to React Flow v10

import { Callout } from 'nextra/components';

<Callout type="info">
  You can find the docs for old versions of React Flow here:
  [v11](https://v11.reactflow.dev), [v10](https://v10.reactflow.dev),
  [v9](https://v9.reactflow.dev)
</Callout>

Welcome to React Flow v10! With the major version update, there are coming many new features but also some breaking changes.

## New Features

- [**Sub Flows**](/learn/layouting/sub-flows): You can now add nodes to a parent node and create groups and nested flows
- **Node Type 'group'**: A new node type without handles that can be used as a group node
- **Touch Device Support**: It is now possible to connect nodes on touch devices
- **Fit View on Init**: You can use the new `fitView` prop to fit the initial view
- **Key Handling**: Not only single keys but also multiple keys and key combinations are possible now
- [**useKeyPress hook**](/api-reference/hooks/use-key-press): A util hook for handling keyboard events
- [**useReactFlow hook**](/api-reference/hooks/use-react-flow): Returns a React Flow instance that exposes functions to manipulate the flow
- **[useNodes](/api-reference/hooks/use-nodes), [useEdges](/api-reference/hooks/use-edges) and [useViewport](/api-reference/hooks/use-viewport) hooks**: Hooks for receiving nodes, edges and the viewport
- **Edge Marker**: More options to configure the start and end markers of an edge

## Breaking Changes

TLDR:

- Split the `elements` array into `nodes` and `edges` arrays and implement `onNodesChange` and `onEdgesChange` handlers (detailed guide in the [core concepts section](/learn/concepts/core-concepts))
- Memoize your custom `nodeTypes` and `edgeTypes`
- Rename `onLoad` to `onInit`
- Rename `paneMoveable` to `panOnDrag`
- Rename `useZoomPanHelper` to `useReactFlow` (and `setTransform` to `setViewport`)
- Rename node and edge option `isHidden` to `hidden`

Detailed explanation of breaking changes:

### 1. ~~Elements~~ - Nodes and Edges

We saw that a lot of people struggle with the semi controlled `elements` prop. It was always a bit messy to sync the local user state with the internal state of React Flow. Some of you used the internal store that was never documented and always a kind of hacky solution. For the new version we offer two ways to use React Flow - uncontrolled and controlled.

### 1.1. Controlled `nodes` and `edges`

If you want to have the full control and use nodes and edges from your local state or your store, you can use the `nodes`, `edges` props in combination with the `onNodesChange` and `onEdgesChange` handlers. You need to implement these handlers for an interactive flow (if you are fine with just pan and zoom you don't need them). You'll receive a change when a node(s) gets initialized, dragged, selected or removed. This means that you always know the exact position and dimensions of a node or if it's selected for example. We export the helper functions `applyNodeChanges` and `applyEdgeChanges` that you should use to apply the changes.

#### Old API

```jsx
import { useState, useCallback } from 'react';
import { ReactFlow, removeElements, addEdge } from 'react-flow-renderer';

const initialElements = [
  { id: '1', data: { label: 'Node 1' }, position: { x: 250, y: 0 } },
  { id: '2', data: { label: 'Node 2' }, position: { x: 150, y: 100 } },
  { id: 'e1-2', source: '1', target: '2' },
];

const BasicFlow = () => {
  const [elements, setElements] = useState(initialElements);
  const onElementsRemove = useCallback(
    (elementsToRemove) =>
      setElements((els) => removeElements(elementsToRemove, els)),
    [],
  );
  const onConnect = useCallback((connection) =>
    setElements((es) => addEdge(connection, es)),
  );

  return (
    <ReactFlow
      elements={elements}
      onElementsRemove={onElementsRemove}
      onConnect={onConnect}
    />
  );
};

export default BasicFlow;
```

#### New API

```jsx
import { useState, useCallback } from 'react';
import {
  ReactFlow,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from 'react-flow-renderer';

const initialNodes = [
  { id: '1', data: { label: 'Node 1' }, position: { x: 250, y: 0 } },
  { id: '2', data: { label: 'Node 2' }, position: { x: 150, y: 100 } },
];

const initialEdges = [{ id: 'e1-2', source: '1', target: '2' }];

const BasicFlow = () => {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  const onNodesChange = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback((connection) =>
    setEdges((eds) => addEdge(connection, eds)),
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
    />
  );
};

export default BasicFlow;
```

You can also use the new hooks `useNodesState` and `useEdgesState` for a quick start:

```js
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
```

related changes:

- `onElementsClick` ->`onNodeClick` and `onEdgeClick`
- `onElementsRemove` -> replaced by the `onNodesChange` and `onEdgesChange` handler

### 1.2 Uncontrolled `defaultNodes` and `defaultEdges`

The easiest way to get started is to use the `defaultNodes` and `defaultEdges` props. When you set these props, all actions are handled internally. You don't need to add any other handlers to get a fully interactive flow with the ability to drag nodes, connect nodes and remove nodes and edges:

#### New API

```jsx
import ReactFlow from 'react-flow-renderer';

const defaultNodes = [
  { id: '1', data: { label: 'Node 1' }, position: { x: 250, y: 0 } },
  { id: '2', data: { label: 'Node 2' }, position: { x: 150, y: 100 } },
];

const defaultEdges = [{ id: 'e1-2', source: '1', target: '2' }];

const BasicFlow = () => {
  return <ReactFlow defaultNodes={defaultNodes} defaultEdges={defaultEdges} />;
};

export default BasicFlow;
```

If you want to add, remove or update a node or edge you can only do this by using the [ReactFlow instance](/api-reference/types/react-flow-instance) that you can receive either with the new `useReactFlow` hook or by using the `onInit` handler that gets the instance as a function param.

### 2. Memoize your custom `nodeTypes` and `edgeTypes`

Whenever you pass new node or edge types, we create wrapped node or edge component types in the background. This means that you should not create a new `nodeType` or `edgeType` object on every render. **Memoize your nodeTypes and edgeTypes or define them outside of the component when they don't change**.

**Don't do this:**

This creates a new object on every render and leads to bugs and performance issues:

```jsx
// this is bad! Don't do it.
<ReactFlow
  nodes={[]}
  nodeTypes={{
    specialType: SpecialNode, // bad!
  }}
/>
```

**Do this:**

```jsx
function Flow() {
  const nodeTypes = useMemo(() => ({ specialType: SpecialNode }), []);

  return <ReactFlow nodes={[]} nodeTypes={nodeTypes} />;
}
```

or create the types outside of the component when they don't change:

```jsx
const nodeTypes = { specialType: SpecialNode };

function Flow() {
  return <ReactFlow nodes={[]} nodeTypes={nodeTypes} />;
}
```

### 3. ~~Redux~~ - Zustand

We switched our state management library from Redux to [Zustand](https://github.com/pmndrs/zustand). With this change we could remove about 300LOC from our state related code. If you need to access the internal store, you can use the [`useStore` hook](/api-reference/hooks/use-store):

#### Old API

```jsx
import { useStoreState, useStoreActions } from 'react-flow-renderer';

...

const transform = useStoreState((store) => store.transform);
```

#### New API

```jsx
import { useStore } from 'react-flow-renderer';

...
const transform = useStore((store) => store.transform);
```

You still need to wrap your component with the `<ReactFlowProvider />` if you want to access the internal store.

We are also exporting `useStoreApi` if you need to get the store in an event handler for example without triggering re-renders.

```js
import { useStoreApi } from 'react-flow-renderer';

...

const store = useStoreApi();

...
// in an event handler
const [x, y, zoom] = store.getState().transform;
```

### 4. ~~onLoad~~ - onInit

The `onLoad` callback has been renamed to `onInit` and now fires when the nodes are initialized.

#### Old API

```jsx
const onLoad = (reactFlowInstance: OnLoadParams) => reactFlowInstance.zoomTo(2);
...
<ReactFlow
   ...
  onLoad={onLoad}
/>
```

#### New API

```jsx
const onInit = (reactFlowInstance: ReactFlowInstance) => reactFlowInstance.zoomTo(2);
...
<ReactFlow
   ...
  onInit={onInit}
/>
```

### 5. ~~paneMoveable~~ - panOnDrag

This is more consistent with the rest of the API (`panOnScroll`, `zoomOnScroll`, etc.)

#### Old API

```jsx
<ReactFlow
   ...
  paneMoveable={false}
/>
```

#### New API

```jsx
<ReactFlow
   ...
  panOnDrag={false}
/>
```

### 6. ~~useZoomPanHelper transform~~ - unified in `useReactFlow`

As "transform" is also the variable name of the transform in the store and it's not clear that `transform` is a setter we renamed it to `setViewport`. This is also more consistent with the other functions. Also, all `useZoomPanHelper` functions have been moved to the [React Flow instance](/api-reference/types/react-flow-instance) that you get from the [`useReactFlow` hook](/api-reference/hooks/use-react-flow) or the `onInit` handler.

#### Old API

```js
const { transform, setCenter, setZoom  } = useZoomPanHelper();
...
transform({ x: 100, y: 100, zoom: 2 });
```

#### New API

```js
const { setViewport, setCenter, setZoom } = useReactFlow();
...
setViewport({ x: 100, y: 100, zoom: 2 });
```

New viewport functions:

- `getZoom`
- `getViewport`

### 7. ~~isHidden~~ - hidden

We mixed prefixed (`is...`) and non-prefixed boolean option names. All node and edge options are not prefixed anymore. So it's `hidden`, `animated`, `selected`, `draggable`, `selectable` and `connectable`.

#### Old API

```js
const hiddenNode = { id: '1', isHidden: true, position: { x: 50, y: 50 } };
```

#### New API

```js
const hiddenNode = { id: '1', hidden: true, position: { x: 50, y: 50 } };
```

### 8. ~~arrowHeadType~~ ~~markerEndId~~ - markerStart / markerEnd

We improved the API for customizing the markers for an edge. With the new API you are able to set individual markers at the start and the end of an edge as well as customizing them with colors, strokeWidth etc. You still have the ability to set a markerEndId but instead of using different properties, the `markerStart` and `markerEnd` property accepts either a string (id for the svg marker that you need to define yourself) or a configuration object for using the built in arrowClosed or arrow markers.

#### Old API

```js
const markerEdge = { source: '1', target: '2', arrowHeadType: 'arrow' };
```

#### New API

```js
const markerEdge = {
  source: '1',
  target: '2',
  markerStart: 'myCustomSvgMarker',
  markerEnd: { type: 'arrow', color: '#f00' },
};
```

### 9. ~~ArrowHeadType~~ - MarkerType

This is just a wording change for making the marker API more consistent. As we are now able to set markers for the start of the edge, the name type ArrowHeadType has been renamed to MarkerType. In the future, this can also not only contain arrow shapes but others like circles, diamonds etc.

### 10. Attribution

This is not really a breaking change to the API but a little change in the general appearance of React Flow. We added a tiny "React Flow" attribution to the bottom right (the position is configurable via the `attributionPosition` prop). This change comes with the new "React Flow Pro" subscription model. If you want to remove the attribution in a commercial application, please subscribe to ["React Flow Pro"](/pro).
