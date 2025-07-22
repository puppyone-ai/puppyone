---
sidebarTitle: Devtools
description: Copy pastable devtools for React Flow
---

import { Callout } from 'nextra/components';
import { RemoteCodeViewer } from 'xy-shared/server';

# Devtools and Debugging

<Callout type="info">
  This is an ongoing experiment on implementing our own React Flow devtools. While we are
  working on the actual package, we'd love to hear about your feedback and ideas on
  [Discord](https://discord.gg/Bqt6xrs) or via mail at info@xyflow.com.
</Callout>

React Flow can often seem like a magic black box, but in reality you can reveal quite a
lot about its internal state if you know where to look. In this guide we will show you
three different ways to reveal the internal state of your flow:

- A `<ViewportLogger />` component that shows the current position and zoom level of the
  viewport.
- A `<NodeInspector />` component that reveals the state of each node.
- A `<ChangeLogger />` that wraps your flow's `onNodesChange` handler and logs each change
  as it is dispatched.

While we find these tools useful for making sure React Flow is working properly, you might
also find them useful for debugging your applications as your flows and their interactions
become more complex.

<div className="nestedSandpack">
  <RemoteCodeViewer route="learn/devtools" framework="react" />
</div>

We encourage you to copy any or all of the components from this example into your own
projects and modify them to suit your needs: each component works independently!

## Node Inspector

The `<NodeInspector />` component makes use of our
[`useNodes`](/api-reference/hooks/use-nodes) hook to access all the nodes in the flow.
Typically we discourage using this hook because it will trigger a re-render any time _any_
of your nodes change, but that's exactly what makes it so useful for debugging!

The `width` and `height` properties are added to each node by React Flow after it has
measured the node's dimensions. We pass those dimensions, as well as other information
like the node's id and type, to a custom `<NodeInfo />` component.

We make use of the [`<ViewportPortal />`](/api-reference/components/viewport-portal)
component to let us render the inspector into React Flow's viewport. That means it's
content will be positioned and transformed along with the rest of the flow as the user
pans and zooms.

## Change Logger

Any change to your nodes and edges that originates from React Flow itself is communicated
to you through the `onNodesChange` and `onEdgesChange` callbacks. If you are working with
a controlled flow (that means you're managing the nodes and edges yourself), you need to
apply those changes to your state in order to keep everything in sync.

The `<ChangeLogger />` component wraps your user-provided `onNodesChange` handler with a
custom function that intercepts and logs each change as it is dispatched. We can do this
by using the [`useStore`](/api-reference/hooks/use-store) and
[`useStoreApi`](/api-reference/hooks/use-store-api) hooks to access the store and and then
update React Flow's internal state accordingly. These two hooks give you powerful access
to React Flow's internal state and methods.

Beyond debugging, using the `<ChangeLogger />` can be a great way to learn more about how
React Flow works and get you thinking about the different functionality you can build on
top of each change.

You can find documentation on the [`NodeChange`](/api-reference/types/node-change) and
[`EdgeChange`](/api-reference/types/edge-change) types in the API reference.

## Viewport Logger

The `<ViewportLogger />` is the simplest example of what state you can pull out of React
Flow's store if you know what to look for. The state of the viewport is stored internally
under the `transform` key (a name we inherited from
[d3-zoom](https://d3js.org/d3-zoom#zoomTransform)). This component extracts the `x`, `y`,
and `zoom` components of the transform and renders them into a
[`<Panel />`](/api-reference/components/panel) component.

## Let us know what you think

As mentioned above, if you have any feedback or ideas on how to improve the devtools,
please let us know on [Discord](https://discord.gg/Bqt6xrs) or via mail at
info@xyflow.com. If you build your own devtools using these ideas, we'd love to hear about
it!
