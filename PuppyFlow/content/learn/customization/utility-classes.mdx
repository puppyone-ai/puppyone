---
description:
  This guide gives you an overview of utility classes in React Flow that help you control
  interactions within custom nodes.
---

import { Callout } from 'nextra/components';
import { RemoteCodeViewer } from 'xy-shared/server';

# Utility Classes

React Flow provides several built-in utility CSS classes to help you fine-tune how
interactions work within your custom elements.

## `nodrag`

Adding the class `nodrag` to an element ensures that interacting with it doesn't trigger a
drag. This is particularly useful for elements like buttons or inputs that should not
initiate a drag operation when clicked.

Nodes have a `drag` class name in place by default. However, this class name can affect
the behaviour of the event listeners inside your custom nodes. To prevent unexpected
behaviours, add a `nodrag` class name to elements with an event listener. This prevents
the default drag behavior as well as the default node selection behavior when elements
with this class are clicked.

```tsx
export default function CustomNode(props: NodeProps) {
  return (
    <div>
      <input className="nodrag" type="range" min={0} max={100} />
    </div>
  );
}
```

## `nopan`

If an element in the canvas does not stop mouse events from propagating, clicking and
dragging that element will pan the viewport. Adding the "nopan" class prevents this
behavior and this prop allows you to change the name of that class.

```tsx
export default function CustomNode(props: NodeProps) {
  return (
    <div className="nopan">
      <p>fixed content...</p>
    </div>
  );
}
```

## `nowheel`

If your custom element contains scrollable content, you can apply the `nowheel` class.
This disables the canvas' default pan behavior when you scroll inside your custom node,
ensuring that only the content scrolls instead of moving the entire canvas.

```tsx
export default function CustomNode(props: NodeProps) {
  return (
    <div className="nowheel" style={{ overflow: 'auto' }}>
      <p>Scrollable content...</p>
    </div>
  );
}
```

Applying these utility classes helps you control interaction on a granular level. You can
customize these class names inside React Flow's
[style props](/api-reference/react-flow/#style-props).

<Callout type="info">
  When creating your own custom nodes, you will also need to remember to style them!
  Unlike the built-in nodes, custom nodes have no default styles, so feel free to use any
  styling method you prefer, such as [Tailwind CSS](/examples/styling/tailwind).
</Callout>
