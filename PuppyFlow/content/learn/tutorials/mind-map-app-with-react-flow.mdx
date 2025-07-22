---
sidebarTitle: Mind Map App
title: Build a Mind Map App with React Flow
intro: "In this tutorial, you will learn to create a simple mind map tool with React Flow that can be used for brainstorming, organizing an idea, or mapping your thoughts in a visual way. To build this app, we'll be using state management, custom nodes and edges, and more."
date: 2023/01/10
authors: ['moritz']
tags: ['react-flow', 'how-to', 'mind-map']
image: /img/tutorials/mindmap/mindmap.png
---

import { Emoji } from '@xyflow/xy-ui';
import { RemoteCodeViewer } from 'xy-shared/server';

In this tutorial, you will learn to create a simple mind map tool with React Flow that can be used for brainstorming, organizing an idea, or mapping your thoughts in a visual way. To build this app, we'll be using state management, custom nodes and edges, and more.

## <Emoji content="🎬" /> It's Demo Time!

Before we get our hands dirty, I want to show you the mind-mapping tool we'll have by the end of this tutorial:

<RemoteCodeViewer route="tutorials/mindmap/app" framework="react"  />

If you'd like to live dangerously and dive right into the code, you can find the source code on [Github](https://github.com/xyflow/react-flow-mindmap-app).

## <Emoji content="👩🏻‍💻" /> Getting started

To do this tutorial you will need some knowledge of [React](https://reactjs.org/docs/getting-started.html) and [React Flow](/learn/concepts/terms-and-definitions) (hi, that's us! <Emoji content="😁" /> it's an open source library for building node-based UIs like workflow tools, ETL pipelines, and [more](/showcase/).)

We'll be using [Vite](https://vitejs.dev/) to develop our app, but you can also use [Create React App](https://create-react-app.dev/) or any other tool you like. To scaffold a new React app with Vite you need to do:

```bash npm2yarn
npm create vite@latest reactflow-mind-map -- --template react
```

if you would like to use Typescript:

```bash npm2yarn
npm create vite@latest reactflow-mind-map -- --template react-ts
```

After the initial setup, you need to install some packages:

```bash npm2yarn
npm install reactflow zustand classcat nanoid
```

We are using [Zustand](https://github.com/pmndrs/zustand) for managing the state of our application. It's a bit like Redux but way smaller and there's less boilerplate code to write. React Flow also uses Zustand, so the installation comes with no additional cost. (For this tutorial we are using Typescript but you can also use plain Javascript.)

To keep it simple we are putting all of our code in the `src/App` folder. For this you need to create the `src/App` folder and add an index file with the following content:

#### src/App/index.tsx

```tsx
import { ReactFlow, Controls, Panel } from '@xyflow/react';

// we have to import the React Flow styles for it to work
import '@xyflow/react/dist/style.css';

function Flow() {
  return (
    <ReactFlow>
      <Controls showInteractive={false} />
      <Panel position="top-left">React Flow Mind Map</Panel>
    </ReactFlow>
  );
}

export default Flow;
```

This will be our main component for rendering the mind map. There are no nodes or edges yet, but we added the React Flow [`Controls`](/api-reference/components/controls) component and a [`Panel`](/api-reference/components/panel) to display the title of our app.

To be able to use React Flow hooks, we need to wrap the application with the [`ReactFlowProvider`](/api-reference/react-flow-provider) component in our main.tsx (entry file for vite). We are also importing the newly created `App/index.tsx` and render it inside the `ReactFlowProvider.` Your main file should look like this:

#### src/main.tsx

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';

import App from './App';

import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>
  </React.StrictMode>,
);
```

The parent container of the React Flow component needs a width and a height to work properly. Our app is a fullscreen app, so we add these rules to the `index.css` file:

#### src/index.css

```css
body {
  margin: 0;
}

html,
body,
#root {
  height: 100%;
}
```

We are adding all styles of our app to the `index.css` file (you could also use [Tailwind](/examples/styling/tailwind)). Now you can start the development server with `npm run dev` and you should see the following:

<RemoteCodeViewer
  route="tutorials/mindmap/getting-started"
  framework="react"
/>

## <Emoji content="🏪" /> A store for nodes and edges

As mentioned above, we are using Zustand for state management. For this, we create a new file in our `src/App` folder called `store.ts`:

#### src/App/store.ts

```ts
import {
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  OnNodesChange,
  OnEdgesChange,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import { createWithEqualityFn } from 'zustand/traditional';

export type RFState = {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
};

const useStore = createWithEqualityFn<RFState>((set, get) => ({
  nodes: [
    {
      id: 'root',
      type: 'mindmap',
      data: { label: 'React Flow Mind Map' },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
  onNodesChange: (changes: NodeChange[]) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
    });
  },
  onEdgesChange: (changes: EdgeChange[]) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
    });
  },
}));

export default useStore;
```

It seems like a lot of code, but it's mostly types <Emoji content="😇" /> The store keeps track of the nodes and edges and handles the change events. When a user drags a node, React Flow fires a change event, the store then applies the changes and the updated nodes get rendered. (You can read more about this in our [state management library guide](/api-reference/hooks/use-store).)

As you can see we start with one initial node placed at `{ x: 0, y: 0 }` of type 'mindmap'. To connect the store with our app, we use the `useStore` hook:

#### src/App/index.tsx

```tsx
import { ReactFlow, Controls, Panel, NodeOrigin } from '@xyflow/react';
import { shallow } from 'zustand/shallow';

import useStore, { RFState } from './store';

// we have to import the React Flow styles for it to work
import '@xyflow/react/dist/style.css';

const selector = (state: RFState) => ({
  nodes: state.nodes,
  edges: state.edges,
  onNodesChange: state.onNodesChange,
  onEdgesChange: state.onEdgesChange,
});

// this places the node origin in the center of a node
const nodeOrigin: NodeOrigin = [0.5, 0.5];

function Flow() {
  // whenever you use multiple values, you should use shallow to make sure the component only re-renders when one of the values changes
  const { nodes, edges, onNodesChange, onEdgesChange } = useStore(selector, shallow);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeOrigin={nodeOrigin}
      fitView
    >
      <Controls showInteractive={false} />
      <Panel position="top-left">React Flow Mind Map</Panel>
    </ReactFlow>
  );
}

export default Flow;
```

We access the nodes, edges and change handlers from the store and pass them to the React Flow component. We also use the `fitView` prop to make sure that the initial node is centered in the view and set the node origin to `[0.5, 0.5]` to set the origin to the center of a node. After this, your app should look like this:

<RemoteCodeViewer route="tutorials/mindmap/store-nodes-edges" framework="react" />

You can move the node around and zoom in and out, we are getting somewhere <Emoji content="🚀" /> Now let's add some more functionality.

## <Emoji content="✨" /> Custom nodes and edges

We want to use a custom type called 'mindmap' for our nodes. We need to add a new component for this. Let's create a new folder called `MindMapNode` with an index file under `src/App` with the following content:

#### src/App/MindMapNode/index.tsx

```tsx
import { Handle, NodeProps, Position } from '@xyflow/react';

export type NodeData = {
  label: string;
};

function MindMapNode({ id, data }: NodeProps<NodeData>) {
  return (
    <>
      <input defaultValue={data.label} />

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

export default MindMapNode;
```

We are using an input for displaying and editing the labels of our mind map nodes, and two handles for connecting them. This is necessary for React Flow to work; the handles are used as the start and end position of the edges.

We also add some CSS to the `index.css` file to make the nodes look a bit prettier:

#### src/index.css

```css
.react-flow__node-mindmap {
  background: white;
  border-radius: 2px;
  border: 1px solid transparent;
  padding: 2px 5px;
  font-weight: 700;
}
```

(For more on this, you can read the [guide to custom nodes](/learn/customization/custom-nodes) in our docs.)

Let's do the same for the custom edge. Create a new folder called `MindMapEdge` with an index file under `src/App`:

#### src/App/MindMapEdge/index.tsx

```tsx
import { BaseEdge, EdgeProps, getStraightPath } from '@xyflow/react';

function MindMapEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY } = props;

  const [edgePath] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return <BaseEdge path={edgePath} {...props} />;
}

export default MindMapEdge;
```

I will get into more detail about the custom nodes and edges in the next section. For now it's important that we can use the new types in our app, by adding the following to our `Flow` component:

```tsx
import MindMapNode from './MindMapNode';
import MindMapEdge from './MindMapEdge';

const nodeTypes = {
  mindmap: MindMapNode,
};

const edgeTypes = {
  mindmap: MindMapEdge,
};
```

and then pass the newly created types to the React Flow component.

<RemoteCodeViewer route="tutorials/mindmap/custom-nodes-edges" framework="react" />

Nice! We can already change the labels of our nodes by clicking in the input field and typing something.

## <Emoji content="🆕" /> New nodes

We want to make it super quick for a user to create a new node. The user should be able to add a new node by clicking on a node and drag to the position where a new node should be placed. This functionality is not built into React Flow, but we can implement it by using the [`onConnectStart` and `onConnectEnd`](/api-reference/react-flow#onconnectstart) handlers.

We are using the start handler to remember the node that was clicked and the end handler to create the new node:

#### Add to src/App/index.tsx

```tsx
const connectingNodeId = useRef<string | null>(null);

const onConnectStart: OnConnectStart = useCallback((_, { nodeId }) => {
  connectingNodeId.current = nodeId;
}, []);

const onConnectEnd: OnConnectEnd = useCallback((event) => {
  // we only want to create a new node if the connection ends on the pane
  const targetIsPane = (event.target as Element).classList.contains('react-flow__pane');

  if (targetIsPane && connectingNodeId.current) {
    console.log(`add new node with parent node ${connectingNodeId.current}`);
  }
}, []);
```

Since our nodes are managed by the store, we create an action to add a new node and its edge. This is how our `addChildNode` action looks:

#### New action in src/store.ts

```ts
addChildNode: (parentNode: Node, position: XYPosition) => {
  const newNode = {
    id: nanoid(),
    type: 'mindmap',
    data: { label: 'New Node' },
    position,
    parentNode: parentNode.id,
  };

  const newEdge = {
    id: nanoid(),
    source: parentNode.id,
    target: newNode.id,
  };

  set({
    nodes: [...get().nodes, newNode],
    edges: [...get().edges, newEdge],
  });
};
```

We are using the passed node as a parent. Normally this feature is used to implement [grouping](/examples/nodes/dynamic-grouping) or [sub flows](/examples/grouping/sub-flows). Here we are using it to move all child nodes when their parent is moved. It enables us to clean up and re-order the mind map so that we don't have to move all child nodes manually. Let's use the new action in our `onConnectEnd` handler:

#### Adjustments in src/App/index.tsx

```tsx
const store = useStoreApi();

const onConnectEnd: OnConnectEnd = useCallback(
  (event) => {
    const { nodeLookup } = store.getState();
    const targetIsPane = (event.target as Element).classList.contains('react-flow__pane');

    if (targetIsPane && connectingNodeId.current) {
      const parentNode = nodeLookup.get(connectingNodeId.current);
      const childNodePosition = getChildNodePosition(event, parentNode);

      if (parentNode && childNodePosition) {
        addChildNode(parentNode, childNodePosition);
      }
    }
  },
  [getChildNodePosition],
);
```

First we are getting the `nodeLookup` from the React Flow store via `store.getState()`. `nodeLookup` is a map that contains all nodes and their current state. We need it to get the position and dimensions of the clicked node. Then we check if the target of the onConnectEnd event is the React Flow pane. If it is, we want to add a new node. For this we are using our `addChildNode` and the newly created `getChildNodePosition` helper function.

#### Helper function in src/App/index.tsx

```tsx
const getChildNodePosition = (event: MouseEvent, parentNode?: Node) => {
  const { domNode } = store.getState();

  if (
    !domNode ||
    // we need to check if these properties exist, because when a node is not initialized yet,
    // it doesn't have a positionAbsolute nor a width or height
    !parentNode?.computed?.positionAbsolute ||
    !parentNode?.computed?.width ||
    !parentNode?.computed?.height
  ) {
    return;
  }

  const panePosition = screenToFlowPosition({
    x: event.clientX,
    y: event.clientY,
  });

  // we are calculating with positionAbsolute here because child nodes are positioned relative to their parent
  return {
    x:
      panePosition.x -
      parentNode.computed?.positionAbsolute.x +
      parentNode.computed?.width / 2,
    y:
      panePosition.y -
      parentNode.computed?.positionAbsolute.y +
      parentNode.computed?.height / 2,
  };
};
```

This function returns the position of the new node we want to add to our store. We are using the [`project` function](/api-reference/types/react-flow-instance#project) to convert screen coordinates into React Flow coordinates. As mentioned earlier, child nodes are positioned relative to their parents. That's why we need to subtract the parent position from the child node position. That was a lot to take in, let's see it in action:

<RemoteCodeViewer route="tutorials/mindmap/create-nodes" framework="react" />

To test the new functionality you can start a connection from a handle and then end it on the pane. You should see a new node being added to the mind map.

## <Emoji content="🤝" /> Keep data in sync

We can already update the labels but we are not updating the nodes data object. This is important to keep our app in sync and if we want to save our nodes on the server for example. To achieve this we add a new action called `updateNodeLabel` to the store. This action takes a node id and a label. The implementation is pretty straight forward: we iterate over the existing nodes and update the matching one with the passed label:

#### src/store.ts

```ts
updateNodeLabel: (nodeId: string, label: string) => {
  set({
    nodes: get().nodes.map((node) => {
      if (node.id === nodeId) {
        // it's important to create a new object here, to inform React Flow about the changes
        node.data = { ...node.data, label };
      }

      return node;
    }),
  });
},
```

Let's use the new action in our `MindmapNode` component:

#### src/App/MindmapNode/index.tsx

```tsx
import { Handle, NodeProps, Position } from '@xyflow/react';

import useStore from '../store';

export type NodeData = {
  label: string;
};

function MindMapNode({ id, data }: NodeProps<NodeData>) {
  const updateNodeLabel = useStore((state) => state.updateNodeLabel);

  return (
    <>
      <input
        // from now on we can use value instead of defaultValue
        // this makes sure that the input always shows the current label of the node
        value={data.label}
        onChange={(evt) => updateNodeLabel(id, evt.target.value)}
        className="input"
      />

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Top} />
    </>
  );
}

export default MindMapNode;
```

That was quick! The input fields of the custom nodes now display the current label of the nodes. You could take your nodes data, save it on the server and then load it again.

## <Emoji content="💅" /> Simpler UX and nicer styling

Functionality-wise we are finished with our mind map app! We can add new nodes, update their labels and move them around. But the UX and styling could use some improvements. Let's make it easier to drag the nodes and to create new nodes!

### 1. A node as handle

Let's use the whole node as a handle, rather than displaying the default handles. This makes it easier to create nodes, because the area where you can start a new connection gets bigger. We need to style the source handle to be the size of the node and hide the target handle visually. React Flow still needs it to connect the nodes but we don't need to display it since we are creating new nodes by dropping an edge on the pane. We use plain old CSS to hide the target handle and position it in the center of the node:

#### src/index.css

```css
.react-flow__handle.target {
  top: 50%;
  pointer-events: none;
  opacity: 0;
}
```

In order to make the whole node a handle, we also update the style of the source:

#### src/index.css

```css
.react-flow__handle.source {
  top: 0;
  left: 0;
  transform: none;
  background: #f6ad55;
  height: 100%;
  width: 100%;
  border-radius: 2px;
  border: none;
}
```

<RemoteCodeViewer route="tutorials/mindmap/node-as-handle" framework="react" />

This works but we can't move the nodes anymore because the source handle is now the whole node and covers the input field. We fix that by using the [`dragHandle` node option](/api-reference/types/node#drag-handle). It allows us to specify a selector for a DOM element that should be used as a drag handle. For this we adjust the custom node a bit:

#### src/App/MindmapNode/index.tsx

```tsx
import { Handle, NodeProps, Position } from '@xyflow/react';

import useStore from '../store';

export type NodeData = {
  label: string;
};

function MindMapNode({ id, data }: NodeProps<NodeData>) {
  const updateNodeLabel = useStore((state) => state.updateNodeLabel);

  return (
    <>
      <div className="inputWrapper">
        <div className="dragHandle">
          {/* icon taken from grommet https://icons.grommet.io */}
          <svg viewBox="0 0 24 24">
            <path
              fill="#333"
              stroke="#333"
              strokeWidth="1"
              d="M15 5h2V3h-2v2zM7 5h2V3H7v2zm8 8h2v-2h-2v2zm-8 0h2v-2H7v2zm8 8h2v-2h-2v2zm-8 0h2v-2H7v2z"
            />
          </svg>
        </div>
        <input
          value={data.label}
          onChange={(evt) => updateNodeLabel(id, evt.target.value)}
          className="input"
        />
      </div>

      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Top} />
    </>
  );
}

export default MindMapNode;
```

We add a wrapper div with the class name `inputWrapper` and a div with the class name `dragHandle` that acts as the drag handle (surprise!). Now we can style the new elements:

#### src/index.css

```css
.inputWrapper {
  display: flex;
  height: 20px;
  z-index: 1;
  position: relative;
}

.dragHandle {
  background: transparent;
  width: 14px;
  height: 100%;
  margin-right: 4px;
  display: flex;
  align-items: center;
}

.input {
  border: none;
  padding: 0 2px;
  border-radius: 1px;
  font-weight: 700;
  background: transparent;
  height: 100%;
  color: #222;
}
```

<RemoteCodeViewer route="tutorials/mindmap/node-as-handle-2" framework="react" />

### 2. Activate input on focus

We are almost there but we need to adjust some more details. We want to start our new connection from the center of the node. For this we set the pointer events of the input to "none" and check if the user releases the button on top of the node. Only then we want to activate the input field. We can use our `onConnectEnd` function to achieve this:

#### src/App/index.tsx

```tsx
const onConnectEnd: OnConnectEnd = useCallback(
  (event) => {
    const { nodeLookup } = store.getState();
    const targetIsPane = (event.target as Element).classList.contains('react-flow__pane');
    const node = (event.target as Element).closest('.react-flow__node');

    if (node) {
      node.querySelector('input')?.focus({ preventScroll: true });
    } else if (targetIsPane && connectingNodeId.current) {
      const parentNode = nodeLookup.get(connectingNodeId.current);
      const childNodePosition = getChildNodePosition(event, parentNode);

      if (parentNode && childNodePosition) {
        addChildNode(parentNode, childNodePosition);
      }
    }
  },
  [getChildNodePosition],
);
```

As you see we are focusing the input field if the user releases the mouse button on top of a node. We can now add some styling so that the input field is activated (pointerEvents: all) only when it's focused:

```css
/* we want the connection line to be below the node */
.react-flow .react-flow__connectionline {
  z-index: 0;
}

/* pointer-events: none so that the click for the connection goes through */
.inputWrapper {
  display: flex;
  height: 20px;
  position: relative;
  z-index: 1;
  pointer-events: none;
}

/* pointer-events: all so that we can use the drag handle (here the user cant start a new connection) */
.dragHandle {
  background: transparent;
  width: 14px;
  height: 100%;
  margin-right: 4px;
  display: flex;
  align-items: center;
  pointer-events: all;
}

/* pointer-events: none by default */
.input {
  border: none;
  padding: 0 2px;
  border-radius: 1px;
  font-weight: 700;
  background: transparent;
  height: 100%;
  color: #222;
  pointer-events: none;
}

/* pointer-events: all when it's focused so that we can type in it */
.input:focus {
  border: none;
  outline: none;
  background: rgba(255, 255, 255, 0.25);
  pointer-events: all;
}
```

<RemoteCodeViewer route="tutorials/mindmap/node-as-handle-3" framework="react" />

### 3. Dynamic width and auto focus

Almost done! We want to have a dynamic width for the nodes based on the length of the text. To keep it simple we do a calculation based on the length of text for this:

#### Added effect in src/app/MindMapNode.tsx

```jsx
useLayoutEffect(() => {
  if (inputRef.current) {
    inputRef.current.style.width = `${data.label.length * 8}px`;
  }
}, [data.label.length]);
```

We also want to focus / activate a node right after it gets created:

#### Added effect in src/app/MindMapNode.tsx

```jsx
useEffect(() => {
  setTimeout(() => {
    if (inputRef.current) {
      inputRef.current.focus({ preventScroll: true });
    }
  }, 1);
}, []);
```

<RemoteCodeViewer
  route="tutorials/mindmap/node-as-handle-4"
  framework="react"
  activeFile="MindMapNode.tsx"
/>

Now when you adjust a node label, the width of the node will adjust accordingly. You can also create a new node and it will be focused right away.

### 4. Centered edges and styling details

You may have noticed that the edges are not centered. We created a custom edge at the beginning for this, and now we can adjust it a bit so that the edge starts in the center of the node and not at the top of the handle (the default behavior):

#### src/App/MindMapEdge.tsx

```tsx
import { BaseEdge, EdgeProps, getStraightPath } from '@xyflow/react';

function MindMapEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY } = props;

  const [edgePath] = getStraightPath({
    sourceX,
    sourceY: sourceY + 20,
    targetX,
    targetY,
  });

  return <BaseEdge path={edgePath} {...props} />;
}

export default MindMapEdge;
```

We are passing all props to the [`getStraightPath`](/api-reference/utils/get-straight-path) helper function but adjust the sourceY so that it is in the center of the node.

More over we want the title to be a bit more subtle and choose a color for our background. We can do this by adjusting the color of the panel (we added the class name `"header"`) and the background color of the body element:

```css
body {
  margin: 0;
  background-color: #f8f8f8;
  height: 100%;
}

.header {
  color: #cdcdcd;
}
```

Nicely done! <Emoji content="💯" /> You can find the final code here:

<RemoteCodeViewer
  route="tutorials/mindmap/node-as-handle-4"
  framework="react"
  activeFile="MindMapNode.tsx"
/>

## <Emoji content="👋" /> Final thoughts

What a trip! We started with an empty pane and ended with a fully functional mind map app. If you want to move on you could work on some of the following features:

- Add new nodes by clicking on the pane
- Save and restore button to store current state to local storage
- Export and import UI
- Collaborative editing

I hope you enjoyed this tutorial and learned something new! If you have any questions or feedback, feel free to reach out to me on [Twitter](https://twitter.com/moklick) or join our [Discord server](https://discord.com/invite/RVmnytFmGW). React Flow is an independent company financed by its users. If you want to support us you can [sponsor us on Github](https://github.com/sponsors/xyflow) or [subscribe to one of our Pro plans](/pro/).
