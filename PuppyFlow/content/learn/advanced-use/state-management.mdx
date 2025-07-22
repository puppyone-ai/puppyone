---
sidebarTitle: State Management
description: Learn how to use React Flow with a state management library like Zustand, Redux, Recoil or Jotai.
---

# Using a State Management Library

import { Callout } from 'nextra/components';
import { RemoteCodeViewer } from 'xy-shared/server';

<Callout type="info">
  For this guide we assume that you already know about the [core
  concepts](/learn/concepts/core-concepts) of React Flow and how to implement
  [custom nodes](/learn/customization/custom-nodes). You should also be familiar
  with the concepts of state management libraries and how to use them.
</Callout>

In this guide, we explain how to use React Flow with the state management library [Zustand](https://github.com/pmndrs/zustand). We will build a small app where each node features a color chooser that updates its background color. We chose Zustand for this guide because React Flow already uses it internally, but you can easily use other state management libraries such as [Redux](https://redux.js.org/), [Recoil](https://recoiljs.org/) or [Jotai](https://jotai.org/)

As demonstrated in previous guides and examples, React Flow can easily be used with a local component state to manage nodes and edges in your diagram. However, as your application grows and you need to update the state from within individual nodes, managing this state can become more complex. Instead of passing functions through the node's data field, you can use a [React context](https://reactjs.org/docs/context.html) or integrate a state management library like Zustand, as outlined in this guide.

## Install Zustand

As mentioned above we are using Zustand in this example. Zustand is a bit like Redux: you have a central store with actions to alter your state and hooks to access your state. You can install Zustand via:

```bash copy npm2yarn
npm install --save zustand
```

## Create a store

Zustand lets you create a hook for accessing the values and functions of your store. We put the `nodes` and `edges` and the `onNodesChange`, `onEdgesChange`, `onConnect`, `setNodes` and `setEdges` functions in the store to get the basic interactivity for our graph:

<RemoteCodeViewer route="learn/state-management" framework="react" />

That's the basic setup. We now have a store with nodes and edges that can handle the changes (dragging, selecting or removing a node or edge) triggered by React Flow. When you take a look at the `App.tsx` file, you can see that it's kept nice and clean. All the data and actions are now part of the store and can be accessed with the `useStore` hook.

## Implement a color change action

We add a new `updateNodeColor` action to update the `data.color` field of a specific node. For this we pass the node id and the new color to the action, iterate over the nodes and update the matching one with the new color:

```ts
updateNodeColor: (nodeId: string, color: string) => {
  set({
    nodes: get().nodes.map((node) => {
      if (node.id === nodeId) {
        // it's important to create a new object here, to inform React Flow about the changes
        return { ...node, data: { ...node.data, color } };
      }

      return node;
    }),
  });
};
```

This new action can now be used in a React component like this:

```tsx
const updateNodeColor = useStore((s) => s.updateNodeColor);
...
<button onClick={() => updateNodeColor(nodeId, color)} />;
```

## Add a color chooser node

In this step we implement the `ColorChooserNode` component and call the `updateNodeColor` when the user changes the color. The custom part of the color chooser node is the color input.

```jsx
<input
  type="color"
  defaultValue={data.color}
  onChange={(evt) => updateNodeColor(id, evt.target.value)}
  className="nodrag"
/>
```

We add the `nodrag` class name so that the user doesn't drag the node by mistake when changing the color and call the `updateNodeColor` in the `onChange` event handler.

<RemoteCodeViewer
  route="learn/state-management-2"
  framework="react"
  activeFile="ColorChooserNode.tsx"
/>

You can now click on a color chooser and change the background of a node.
