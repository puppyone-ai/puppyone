---
description: An edge that animates a custom SVG element along the edge's path.
---

import { Callout } from 'nextra/components';
import UiComponentViewer from '@/components/ui-component-viewer.mdx';

# Animated SVG Edge

An edge that animates a custom SVG element along the edge's path. This component
is based on the [animating SVG elements example](/examples/edges/animating-edges).

<UiComponentViewer id="animated-svg-edge" />

## Custom shapes

It is intended that you add your own SVG shapes to the module. Each shape should
be a React component that takes one prop, `animateMotionProps`, and returns some
SVG.

You can define these shapes in a separate file or in the same file as the edge
component. In order to use them, you need to add them to the `shapes` record like
so:

```tsx
const shapes = {
  box: ({ animateMotionProps }) => (
    <rect width="5" height="5" fill="#ff0073">
      <animateMotion {...animateMotionProps} />
    </rect>
  ),
} satisfies Record<string, AnimatedSvg>;
```

The keys of the `shapes` record are valid values for the `shape` field of the
edge's data:

```ts
const initialEdges = [
  {
    // ...
    type: "animatedSvgEdge",
    data: {
      duration: 2,
      shape: "box",
    },
  } satisfies AnimatedSvgEdge,
];
```

<Callout type="info">
  If you want to render regular HTML elements, be sure to wrap them in an SVG
  `<foreignObject />` element. Make sure to give the `<foreignObject />` an `id`
  attribute and use that as the `href` attribute when rendering the  `<animateMotion />`
  element.
</Callout>
