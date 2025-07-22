---
description:
  Custom nodes in React Flow are just React components. This guide shows you how to
  implement your own nodes.
sidebarTitle: Nodes
---

import { Callout, Steps } from 'nextra/components';
import { RemoteCodeViewer } from 'xy-shared/server';

# Custom Nodes

A powerful feature of React Flow is the ability to create custom nodes. This gives you the
flexibility to render anything you want within your nodes. We generally recommend creating
your own custom nodes rather than relying on built-in ones. With custom nodes, you can add
as many source and target [handles](/learn/customization/handles) as you like—or even
embed form inputs, charts, and other interactive elements.

In this section, we'll walk through creating a custom node featuring an input field that
updates text elsewhere in your application. For further examples, we recommend checking
out our [Custom Node Example](/examples/nodes/custom-node).

## Implementing a custom node

To create a custom node, all you need to do is create a React component. React Flow will
automatically wrap it in an interactive container that injects essential props like the
node's id, position, and data, and provides functionality for selection, dragging, and
connecting handles. For a full overview on all available node props, see the
[Node](/api-reference/types/node-props) reference.

<Steps>
### Create the component

Let's dive into an example by creating a custom node called `TextUpdaterNode`. For this,
we've added a simple input field with a change handler.

```jsx
export function TextUpdaterNode(props) {
  const onChange = useCallback((evt) => {
    console.log(evt.target.value);
  }, []);

  return (
    <div className="text-updater-node">
      <div>
        <label htmlFor="text">Text:</label>
        <input id="text" name="text" onChange={onChange} className="nodrag" />
      </div>
    </div>
  );
}
```

### Initialize nodeTypes

You can add a new node type to React Flow by adding it to the `nodeTypes` prop like below.
We define the `nodeTypes` outside of the component to prevent re-renderings.

```jsx
const nodeTypes = {
  textUpdater: TextUpdaterNode,
};
```

### Pass nodeTypes to React Flow

```jsx {4}
<ReactFlow
  nodes={nodes}
  edges={edges}
  nodeTypes={nodeTypes}
  onNodesChange={onNodesChange}
  onEdgesChange={onEdgesChange}
  fitView
/>
```

### Update node definitions

After defining your new node type, you can use it by specifying the `type` property on
your node definition:

```jsx {4}
const nodes = [
  {
    id: 'node-1',
    type: 'textUpdater',
    position: { x: 0, y: 0 },
    data: { value: 123 },
  },
];
```

### Flow with custom node

After putting all together and adding some basic styles we get a custom node that prints
text to the console:

<RemoteCodeViewer aspectRatio="4" route="learn/custom-node" framework="react" />

</Steps>

## Full code example 🏁

<RemoteCodeViewer route="learn/custom-node" framework="react" />

To enable your custom node to connect with other nodes, check out the
[Handles](/learn/customization/handles) page to learn how to add source and target
handles.
