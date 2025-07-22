---
sidebarTitle: Migrate to v11
description: Use this guide to migrate from React Flow v10 to v11.
---

# Migrate to React Flow v11

import { Callout } from 'nextra/components';

<Callout type="info">
  You can find the docs for old versions of React Flow here:
  [v11](https://v11.reactflow.dev), [v10](https://v10.reactflow.dev),
  [v9](https://v9.reactflow.dev)
</Callout>

A lot changed in v11 but this time we've tried to keep the breaking changes small. The biggest change is the new package name `reactflow` and the new repo structure. React Flow is now managed as a monorepo and separated into multiple packages that can be installed separately. In addition to that, there are some API changes and new APIs introduced in v11. This guide explains the changes in detail and helps you to migrate from v10 to v11.

<Callout>React Flow 11 only works with **React 17** or greater</Callout>

## New Features

- **Better [Accessibility](/learn/advanced-use/accessibility)**
  - Nodes and edges are focusable, selectable, moveable and deletable with the keyboard.
  - `aria-` default attributes for all elements and controllable via `ariaLabel` options
  - Keyboard controls can be disabled with the new `disableKeyboardA11y` prop
- **Better selectable edges** via new edge option: `interactionWidth` - renders invisible edge that makes it easier to interact
- **Better routing for smoothstep and step edges**: https://twitter.com/reactflowdev/status/1567535405284614145
- **Nicer edge updating behavior**: https://twitter.com/reactflowdev/status/1564966917517021184
- **Node origin**: The new `nodeOrigin` prop lets you control the origin of a node. Useful for layouting.
- **New background pattern**: `BackgroundVariant.Cross` variant
- **[`useOnViewportChange`](/api-reference/hooks/use-on-viewport-change) hook** - handle viewport changes within a component
- **[`use-on-selection-change`](/api-reference/hooks/use-on-selection-change) hook** - handle selection changes within a component
- **[`useNodesInitialized`](/api-reference/hooks/use-nodes-initialized) hook** - returns true if all nodes are initialized and if there is more than one node
- **Deletable option** for Nodes and edges
- **New Event handlers**: `onPaneMouseEnter`, `onPaneMouseMove` and `onPaneMouseLeave`
- **Edge `pathOptions`** for `smoothstep` and `default` edges
- **Nicer cursor defaults**: Cursor is grabbing, while dragging a node or panning
- **Pane moveable** with middle mouse button
- **Pan over nodes** when they are not draggable (`draggable=false` or `nodesDraggable` false)
  - you can disable this behavior by adding the class name `nopan` to a wrapper of a custom node
- **[`<BaseEdge />`](/api-reference/components/base-edge) component** that makes it easier to build custom edges
- **[Separately installable packages](/learn/concepts/built-in-components)**
  - @reactflow/core
  - @reactflow/background
  - @reactflow/controls
  - @reactflow/minimap

## Breaking Changes

### 1. New npm package name

The package `react-flow-renderer` has been renamed to `reactflow`.

#### Old API

```js
// npm install react-flow-renderer
import ReactFlow from 'react-flow-renderer';
```

#### New API

```js
// npm install reactflow
import { ReactFlow } from '@xyflow/react';
```

### 2. Importing CSS is mandatory

We are not injecting CSS anymore. **React Flow won't work if you are not loading the styles!**

```js
// default styling
import '@xyflow/react/dist/style.css';

// or if you just want basic styles
import '@xyflow/react/dist/base.css';
```

#### 2.1. Removal of the nocss entrypoint

This change also means that there is no `react-flow-renderer/nocss` entry point anymore. If you used that, you need to adjust the CSS entry points as mentioned above.

### 3. `defaultPosition` and `defaultZoom` have been merged to `defaultViewport`

#### Old API

```jsx
import ReactFlow from 'react-flow-renderer';

const Flow = () => {
  return <ReactFlow defaultPosition={[10, 15]} defaultZoom={5} />;
};

export default Flow;
```

#### New API

```jsx
import { ReactFlow } from '@xyflow/react';

const defaultViewport: Viewport = { x: 10, y: 15, zoom: 5 };

const Flow = () => {
  return <ReactFlow defaultViewport={defaultViewport} />;
};

export default Flow;
```

### 4. Removal of `getBezierEdgeCenter`, `getSimpleBezierEdgeCenter` and `getEdgeCenter`

In v10 we had `getBezierEdgeCenter`, `getSimpleBezierEdgeCenter` and `getEdgeCenter` for getting the center of a certain edge type.
In v11 we changed the helper function for creating the path, so that it also returns the center / label position of an edge.

Let's say you want to get the path and the center / label position of a bezier edge:

#### Old API

```jsx
import { getBezierEdgeCenter, getBezierPath } from 'react-flow-renderer';

const path = getBezierPath(edgeParams);
const [centerX, centerY] = getBezierEdgeCenter(params);
```

#### New API

```jsx
import { getBezierPath } from '@xyflow/react';

const [path, labelX, labelY] = getBezierPath(edgeParams);
```

We avoid to call it `centerX` and `centerY` anymore, because it's actually the label position and not always the center for every edge type.

### 5. Removal of `onClickConnectStop` and `onConnectStop`

#### Old API

```jsx
import ReactFlow from 'react-flow-renderer';

const Flow = () => {
  const onConnectStop = () => console.log('on connect stop');

  return (
    <ReactFlow
      defaultNodes={defaultNodes}
      defaultEdges={defaultEdges}
      onConnectStop={onConnectStop}
      onClickConnectStop={onConnectStop}
    />
  );
};

export default Flow;
```

#### New API

```jsx
import { ReactFlow } from '@xyflow/react';

const Flow = () => {
  const onConnectEnd = () => console.log('on connect stop');

  return (
    <ReactFlow
      defaultNodes={defaultNodes}
      defaultEdges={defaultEdges}
      onConnectEnd={onConnectEnd}
      onClickConnectEnd={onConnectEnd}
    />
  );
};

export default Flow;
```

### 6. Pan over nodes

In the previous versions you couldn't pan over nodes even if they were not draggable. In v11, you can pan over nodes when `nodesDraggable=false` or node option `draggable=false`. If you want the old behavior back, you can add the class name `nopan` to the wrappers of your custom nodes.
