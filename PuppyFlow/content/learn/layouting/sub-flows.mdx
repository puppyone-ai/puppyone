---
description: Learn how to use sub flows to group nodes together in a flow.
---

import { Callout } from 'nextra/components';
import { RemoteCodeViewer } from 'xy-shared/server';

# Sub Flows

<Callout type="info">
  **Deprecation of `parentNode` property!** We have renamed the `parentNode` option to
  `parentId` in version 11.11.0. The old property is still supported but will be removed
  in version 12.
</Callout>

A sub flow is a flow inside a node. It can be a separate flow or a flow that is connected
with other nodes outside of its parent. This feature can also be used for grouping nodes.
In this part of the docs we are going to build a flow with sub flows and show you the
child node specific options.

<Callout type="warning">
  <strong>Order of Nodes</strong>
  It's important that your parent nodes appear before their children in the `nodes`/
  `defaultNodes` array to get processed correctly.
</Callout>

### Adding child nodes

If you want to add a node as a child of another node you need to use the `parentId` (this
was called `parentNode` in previous versions) option (you can find a list of all options
in the [node options section](/api-reference/types/node)). Once we do that, the child node
is positioned relative to its parent. A position of `{ x: 0, y: 0 }` is the top left
corner of the parent.

In this example we are setting a fixed width and height of the parent node by passing the
style option. Additionally, we set the child extent to `'parent'` so that we can't move
the child nodes out of the parent node.

<RemoteCodeViewer route="learn/sub-flows" framework="react" />

### Using child specific options

When you move the parent node you can see that the child nodes move, too. Adding a node to
another node with the `parentId` option, just does one thing: It positions it relatively
to its parent. The child node is not really a child markup-wise. You can drag or position
the child outside of its parent (when the `extent: 'parent'` option is not set) but when
you move the parent, the child moves with it.

In the example above we are using the `group` type for the parent node but you can use any
other type as well. The `group` type is just a convenience node type that has no handles
attached.

Now we are going to add some more nodes and edges. As you can see, we can connect nodes
within a group and create connections that go from a sub flow to an outer node:

<RemoteCodeViewer route="learn/sub-flows-2" framework="react" />

### Edge rendering behavior

Edges are rendered below nodes by default, and this behavior applies to both normal nodes
and group nodes. However, edges connected to a node with a parent are rendered above
nodes.

If you want to customize the z-index of edges, you can use the `zIndex` option. For
example:

```tsx
const defaultEdgeOptions = { zIndex: 1 };

<ReactFlow defaultEdgeOptions={defaultEdgeOptions} />;
```

This allows you to render edges above nodes or adjust their stacking order as needed.

### Using a default node type as a parent

Let's remove the label of node B and add some child nodes. In this example you can see
that you can use one of the default node types as parents, too. We also set the child
nodes to `draggable: false` so that they are not draggable anymore.

<RemoteCodeViewer route="learn/sub-flows-3" framework="react" />
