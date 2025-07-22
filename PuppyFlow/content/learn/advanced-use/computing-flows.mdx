---
description: Learn how to extend React Flow to compute data going through flow graphs.
---

# Computing Flows

import { Callout } from 'nextra/components';
import { RemoteCodeViewer } from 'xy-shared/server';

<Callout type="info">
  For this guide we assume that you already know about the [core
  concepts](/learn/concepts/core-concepts) of React Flow and how to implement
  [custom nodes](/learn/customization/custom-nodes).
</Callout>

Usually with React Flow, developers handle their data outside of React Flow by sending it somewhere else, like on a server or a database. Instead, in this guide we'll show you how to compute data flows directly inside of React Flow. You can use this for updating a node based on connected data, or for building an app that runs entirely inside the browser.

## What are we going to build?

By the end of this guide, you will build an interactive flow graph that generates a color out of three separate number input fields (red, green and blue), and determines whether white or black text would be more readable on that background color.

<RemoteCodeViewer route="learn/computing-6" framework="react" />

## Creating custom nodes

Let's start by creating a custom input node (`NumberInput.js`) and add three instances of it. We will be using a controlled `<input type="number" />` and limit it to integer numbers between 0 - 255 inside the `onChange` event handler.

```jsx
import { useCallback, useState } from 'react';
import { Handle, Position } from '@xyflow/react';

function NumberInput({ id, data }) {
  const [number, setNumber] = useState(0);

  const onChange = useCallback((evt) => {
    const cappedNumber = Math.round(
      Math.min(255, Math.max(0, evt.target.value)),
    );
    setNumber(cappedNumber);
  }, []);

  return (
    <div className="number-input">
      <div>{data.label}</div>
      <input
        id={`number-${id}`}
        name="number"
        type="number"
        min="0"
        max="255"
        onChange={onChange}
        className="nodrag"
        value={number}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

export default NumberInput;
```

Next, we'll add a new custom node (`ColorPreview.js`) with one target handle for each color channel and a background that displays the resulting color. We can use `mix-blend-mode: 'difference';` to make the text color always readable.

<Callout type="info">
  Whenever you have multiple handles of the same kind on a single node, don't
  forget to give each one a separate id!
</Callout>
Let's also add edges going from the input nodes to the color node to our
`initialEdges` array while we are at it.

<RemoteCodeViewer
  route="learn/computing"
  framework="react"
  activeFile="ColorPreview.jsx"
/>

## Computing data

How do we get the data from the input nodes to the color node? This is a two step process that involves two hooks created for this exact purpose:

1. Store each number input value inside the node's `data` object with help of the [`updateNodeData`](/api-reference/types/react-flow-instance#update-node-data) callback.
2. Find out which nodes are connected by using [`useNodeConnections`](/api-reference/hooks/use-node-connections) and then use [`useNodesData`](/api-reference/hooks/use-nodes-data) for receiving the data from the connected nodes.

### Step 1: Writing values to the data object

First let's add some initial values for the input nodes inside the `data` object in our `initialNodes` array and use them as an initial state for the input nodes.
Then we'll grab the function [`updateNodeData`](/api-reference/types/react-flow-instance#update-node-data) from the [`useReactFlow`](/api-reference/hooks/use-react-flow) hook and use it to update the `data` object of the node with a new value whenever the input changes.

<Callout type="info">
By default, the data you pass to [`updateNodeData`](/api-reference/types/react-flow-instance#update-node-data) will be merged with the old data object. This makes it easier to do partial updates and saves you in case you forget to add `{...data}`. You can pass `{ replace: true }` as an option to replace the object instead.
</Callout>

<RemoteCodeViewer
  route="learn/computing-2"
  framework="react"
  activeFile="NumberInput.jsx"
/>

<Callout type="warning">
  <b>
    When dealing with input fields you don't want to use a nodes `data` object
    as UI state directly.
  </b>
  There is a delay in updating the data object and the cursor might jump around
  erratically and lead to unwanted inputs.
</Callout>

### Step 2: Getting data from connected nodes

We start by determining all connections for each node with the [`useNodeConnections`](/api-reference/hooks/use-node-connections) hook and then fetching the data for the first connected node with [`updateNodeData`](/api-reference/types/react-flow-instance#update-node-data).

<Callout type="info">
  Note that each handle can have multiple nodes connected to it and you might
  want to restrict the number of connections to a single handle inside your
  application. Check out the [connection limit
  example](/examples/nodes/connection-limit) to see how to do that.
</Callout>

<b>And there you go!</b> Try changing the input values and see the color change
in real time.

<RemoteCodeViewer
  route="learn/computing-3"
  framework="react"
  activeFile="ColorPreview.jsx"
/>

### Improving the code

It might seem awkward to get the connections first, and then the data separately for each handle. For nodes with multiple handles like these, you should consider creating a custom handle component that isolates connection states and node data binding. We can create one inline.

```jsx filename="ColorPreview.js"
// {...}
function CustomHandle({ id, label, onChange }) {
  const connections = useNodeConnections({
    handleType: 'target',
    handleId: id,
  });

  const nodeData = useNodesData(connections?.[0].source);

  useEffect(() => {
    onChange(nodeData?.data ? nodeData.data.value : 0);
  }, [nodeData]);

  return (
    <div>
      <Handle
        type="target"
        position={Position.Left}
        id={id}
        className="handle"
      />
      <label htmlFor="red" className="label">
        {label}
      </label>
    </div>
  );
}
```

We can promote color to local state and declare each handle like this:

```jsx filename="ColorPreview.js"
// {...}
function ColorPreview() {
  const [color, setColor] = useState({ r: 0, g: 0, b: 0 });

  return (
    <div
      className="node"
      style={{
        background: `rgb(${color.r}, ${color.g}, ${color.b})`,
      }}
    >
      <CustomHandle
        id="red"
        label="R"
        onChange={(value) => setColor((c) => ({ ...c, r: value }))}
      />
      <CustomHandle
        id="green"
        label="G"
        onChange={(value) => setColor((c) => ({ ...c, g: value }))}
      />
      <CustomHandle
        id="blue"
        label="B"
        onChange={(value) => setColor((c) => ({ ...c, b: value }))}
      />
    </div>
  );
}

export default ColorPreview;
```

## Getting more complex

Now we have a simple example of how to pipe data through React Flow. What if we want to do something more complex, like transforming the data along the way? Or even take different paths? We can do that too!

### Continuing the flow

Let's extend our flow. Start by adding an output `<Handle type="source" position={Position.Right} />` to the color node and remove the local component state.

<Callout type="info">
  Because there are no inputs fields on this node, we don't need to keep a local
  state at all. We can just read and update the node's `data` object directly.
</Callout>

Next, we add a new node (`Lightness.js`) that takes in a color object and determines if it is either a light or dark color. We can use the [relative luminance formula](https://en.wikipedia.org/wiki/Relative_luminance#Relative_luminance_and_%22gamma_encoded%22_colorspaces)
`luminance = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b`
to calculate the perceived brightness of a color (0 being the darkest and 255 being the brightest). We can assume everything >= 128 is a light color.

<RemoteCodeViewer
  route="learn/computing-4"
  framework="react"
  activeFile="Lightness.jsx"
/>

### Conditional branching

What if we would like to take a different path in our flow based on the perceived lightness? Let's give our lightness node two source handles `light` and `dark` and separate the node `data` object by source handle IDs. This is needed if you have multiple source handles to distinguish between each source handle's data.

But what does it mean to "take a different route"? One solution would be to assume that `null` or `undefined` data hooked up to a target handle is considered a "stop". In our case we can write the incoming color into `data.values.light` if it's a light color and into `data.values.dark` if it's a dark color and set the respective other value to `null`.

Don't forget to add `flex-direction: column;` and `align-items: end;` to reposition the handle labels.

<RemoteCodeViewer
  route="learn/computing-5"
  framework="react"
  activeFile="Lightness.jsx"
/>

Cool! Now we only need a last node to see if it actually works... We can create a custom debugging node (`Log.js`) that displays the hooked up data, and we're done!

<RemoteCodeViewer
  route="learn/computing-6"
  framework="react"
  activeFile="Log.jsx"
/>

## Summary

You have learned how to move data through the flow and transform it along the way.
All you need to do is

1. store data inside the node's `data` object with help of [`updateNodeData`](/api-reference/types/react-flow-instance#update-node-data) callback.
2. find out which nodes are connected by using [`useNodeConnections`](/api-reference/hooks/use-node-connections) and then use [`useNodesData`](/api-reference/hooks/use-nodes-data) for receiving the data from the connected nodes.

You can implement branching for example by interpreting incoming data that is undefined as a "stop". As a side note, most flow graphs that also have a branching usually separate the triggering of nodes from the actual data hooked up to the nodes. Unreal Engines Blueprints are a good example for this.

<Callout type="info">
  One last note before you go: you should find a consistent way of structuring
  all your node data, instead of mixing ideas like we did just now. This means
  for example, if you start working with splitting data by handle ID you should
  do it for all nodes, regardless whether they have multiple handles or not.
  Being able to make assumptions about the structure of your data throughout
  your flow will make life a lot easier.
</Callout>
