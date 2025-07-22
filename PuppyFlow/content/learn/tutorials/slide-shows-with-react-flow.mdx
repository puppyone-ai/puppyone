---
sidebarTitle: Slideshow App
title: Create a slide show presentation with React Flow
intro:
  We recently published the results of our 2023 end of year survey using React Flow. This
  tutorial is an opportunity to share what we learned and show you how to build something
  similar!
date: 2024/01/07
authors: ['hayleigh']
tags: ['react-flow', 'presentation', 'slide-show']
image: /img/tutorials/presentation/slideshow-thumb.png
---

import { Emoji } from '@xyflow/xy-ui';
import { Callout, Cards } from 'nextra/components';
import { Image } from 'xy-shared';
import { RemoteCodeViewer } from 'xy-shared/server';

We recently published the findings from our React Flow 2023 end-of-year survey with an
[interactive presentation](/developer-survey-2023) of the key findings, using React Flow
itself. There were lots of useful bits built into this slideshow app, so we wanted to
share how we built it!

<Image
  src="/img/tutorials/presentation/survey.png"
  caption="Our 2023 end of year survey app was made up of many static nodes and buttons to navigate between them."
  alt="Screenshot of slides laid out on an infinite canvas, each with information pulled from a survey of React Flow users"
/>

By the end of this tutorial, you will have built a presentation app with

- Support for markdown slides
- Keyboard navigation around the viewport
- Automatic layouting
- Click-drag panning navigation (à la Prezi)

Along the way, you'll learn a bit about the basics of layouting algorithms, creating
static flows, and custom nodes.

Once you're done, the app will look like this!

<RemoteCodeViewer route="tutorials/presentation/app" framework="react" />

To follow along with this tutorial we'll assume you have a basic understanding of
[React](https://reactjs.org/docs/getting-started.html) and
[React Flow](/learn/concepts/terms-and-definitions), but if you get stuck on the way feel
free to reach out to us on [Discord](https://discord.com/invite/RVmnytFmGW)!

Here's the [repo with the final code](https://github.com/xyflow/react-flow-slide-show) if
you'd like to skip ahead or refer to it as we go.

Let's get started!

## Setting up the project

We like to recommend using [Vite](https://vitejs.dev) when starting new React Flow
projects, and this time we'll use TypeScript too. You can scaffold a new project with the
following command:

```bash npm2yarn
npm create vite@latest -- --template react-ts
```

If you'd prefer to follow along with JavaScript feel free to use the `react` template
instead. You can also follow along in your browser by using our Codesandbox templates:

<Cards num={2}>
  <Cards.Card
    title="new.reactflow.dev/js"
    href="https://new.reactflow.dev/js"
    icon={
      <div className="rounded-full w-10 h-10 bg-yellow-200 text-gray-700 font-black flex items-center justify-center">
        JS
      </div>
    }
  />
  <Cards.Card
    title="new.reactflow.dev/ts"
    href="https://new.reactflow.dev/ts"
    icon={
      <div className="rounded-full w-10 h-10 bg-blue-500 text-white font-black flex items-center justify-center">
        TS
      </div>
    }
  />
</Cards>

Besides React Flow we only need to pull in one dependency,
[`react-remark`](https://www.npmjs.com/package/react-remark), to help us render markdown
in our slides.

```bash npm2yarn
npm install @xyflow/react react-remark
```

We'll modify the generated `main.tsx` to include React Flow's styles, as well as wrap the
app in a `<ReactFlowProvider />` to make sure we can access the React Flow instance inside
our components;

```tsx filename="main.tsx" {3,7,12,20}
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';

import App from './App';

import '@xyflow/react/dist/style.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ReactFlowProvider>
      {/* The parent element of the React Flow component needs a width and a height
          to work properly. If you're styling your app as you follow along, you
          can remove this div and apply styles to the #root element in your CSS.
       */}
      <div style={{ width: '100vw', height: '100vh' }}>
        <App />
      </div>
    </ReactFlowProvider>
  </React.StrictMode>,
);
```

This tutorial is going to gloss over the styling of the app, so feel free to use any CSS
framework or styling solution you're familiar with. If you're going to style your app
differently from just writing CSS, [Tailwind CSS](/examples/styling/tailwind), you can
skip the import to `index.css`.

<Callout>
  How you style your app is up to you, but you must **always** include React Flow's
  styles! If you don't need the default styles, at a minimum you should include the base
  styles from `@xyflow/react/dist/base.css`.
</Callout>

Each slide of our presentation will be a node on the canvas, so let's create a new file
`Slide.tsx` that will be our custom node used to render each slide.

```tsx filename="Slide.tsx"
import { type Node, type NodeProps } from '@xyflow/react';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

export type SlideNode = Node<SlideData, 'slide'>;

export type SlideData = {};

const style = {
  width: `${SLIDE_WIDTH}px`,
  height: `${SLIDE_HEIGHT}px`,
} satisfies React.CSSProperties;

export function Slide({ data }: NodeProps<SlideNode>) {
  return (
    <article className="slide nodrag" style={style}>
      <div>Hello, React Flow!</div>
    </article>
  );
}
```

We're setting the slide width and height as constants here (rather than styling the node
in CSS) because we'll want access to those dimensions later on. We've also stubbed out the
`SlideData` type so we can properly type the component's props.

The last thing to do is to register our new custom node and show something on the screen.

```tsx filename="App.tsx"
import { ReactFlow } from '@xyflow/react';
import { Slide } from './Slide.tsx';

const nodeTypes = {
  slide: Slide,
};

export default function App() {
  const nodes = [{ id: '0', type: 'slide', position: { x: 0, y: 0 }, data: {} }];

  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} fitView />;
}
```

<Callout>
  It's important to remember to define your `nodeTypes` object _outside_ of the component
  (or to use React's `useMemo` hook)! When the `nodeTypes` object changes, the entire flow
  is re-rendered.
</Callout>

With the basics put together, you can start the development server by running
`npm run dev` and see the following:

<RemoteCodeViewer route="tutorials/presentation/scaffold" framework="react" />

Not super exciting yet, but let's add markdown rendering and create a few slides side by
side!

## Rendering markdown

We want to make it easy to add content to our slides, so we'd like the ability to write
[Markdown](https://www.markdownguide.org/basic-syntax/) in our slides. If you're not
familiar, Markdown is a simple markup language for creating formatted text documents. If
you've ever written a README on GitHub, you've used Markdown!

Thanks to the `react-remark` package we installed earlier, this step is a simple one. We
can use the `<Remark />` component to render a string of markdown content into our slides.

```tsx filename="Slide.tsx" {2,9-11,21}
import { type Node, type NodeProps } from '@xyflow/react';
import { Remark } from 'react-remark';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

export type SlideNode = Node<SlideData, 'slide'>;

export type SlideData = {
  source: string;
};

const style = {
  width: `${SLIDE_WIDTH}px`,
  height: `${SLIDE_HEIGHT}px`,
} satisfies React.CSSProperties;

export function Slide({ data }: NodeProps<SlideNode>) {
  return (
    <article className="slide nodrag" style={style}>
      <Remark>{data.source}</Remark>
    </article>
  );
}
```

In React Flow, nodes can have data stored on them that can be used during rendering. In
this case we're storing the markdown content to display by adding a `source` property to
the `SlideData` type and passing that to the `<Remark />` component. We can update our
hardcoded nodes with some markdown content to see it in action:

```tsx filename="App.tsx" {2, 10-27, 34}
import { ReactFlow } from '@xyflow/react';
import { Slide, SLIDE_WIDTH } from './Slide';

const nodeTypes = {
  slide: Slide,
};

export default function App() {
  const nodes = [
    {
      id: '0',
      type: 'slide',
      position: { x: 0, y: 0 },
      data: { source: '# Hello, React Flow!' },
    },
    {
      id: '1',
      type: 'slide',
      position: { x: SLIDE_WIDTH, y: 0 },
      data: { source: '...' },
    },
    {
      id: '2',
      type: 'slide',
      position: { x: SLIDE_WIDTH * 2, y: 0 },
      data: { source: '...' },
    },
  ];

  return <ReactFlow nodes={nodes} nodeTypes={nodeTypes} fitView minZoom={0.1} />;
}
```

Note that we've added the `minZoom` prop to the `<ReactFlow />` component. Our slides are
quite large, and the default minimum zoom level is not enough to zoom out and see multiple
slides at once.

<RemoteCodeViewer route="tutorials/presentation/rendering-markdown" framework="react" />

In the nodes array above, we've made sure to space the slides out by doing some manual
math with the `SLIDE_WIDTH` constant. In the next section we'll come up with an algorithm
to automatically lay out the slides in a grid.

## Laying out the nodes

We often get asked how to automatically lay out nodes in a flow, and we have some
documentation on how to use common layouting libraries like dagre and d3-hierarchy in our
[layouting guide](/learn/layouting/layouting). Here you'll be writing your own
super-simple layouting algorithm, which gets a bit nerdy, but stick with us!

For our presentation app we'll construct a simple grid layout by starting from 0,0 and
updating the x or y coordinates any time we have a new slide to the left, right, up, or
down.

First, we need to update our `SlideData` type to include optional ids for the slides to
the left, right, up, and down of the current slide.

```tsx filename="Slide.tsx" {3-6}
export type SlideData = {
  source: string;
  left?: string;
  up?: string;
  down?: string;
  right?: string;
};
```

Storing this information on the node data directly gives us some useful benefits:

- We can write fully declarative slides without worrying about the concept of nodes and
  edges

- We can compute the layout of the presentation by visiting connecting slides

- We can add navigation buttons to each slide to navigate between them automatically.
  We'll handle that in a later step.

The magic happens in a function we're going to define called `slidesToElements`. This
function will take an object containing all our slides addressed by their id, and an id
for the slide to start at. Then it will work through each connecting slide to build an
array of nodes and edges that we can pass to the `<ReactFlow />` component.

The algorithm will go something like this:

- Push the initial slide's id and the position `{ x: 0, y: 0 }` onto a stack.
- While that stack is not empty...
  - Pop the current position and slide id off the stack.

  - Look up the slide data by id.
  - Push a new node onto the nodes array with the current id, position, and slide data.
  - Add the slide's id to a set of visited slides.
  - For every direction (left, right, up, down)...
    - Make sure the slide has not already been visited.
    - Take the current position and update the x or y coordinate by adding or subtracting
      `SLIDE_WIDTH` or `SLIDE_HEIGHT` depending on the direction.
    - Push the new position and the new slide's id onto a stack.
    - Push a new edge onto the edges array connecting the current slide to the new slide.

    - Repeat for the remaining directions...

If all goes to plan, we should be able to take a stack of slides shown below and turn them
into a neatly laid out grid!

<Image src="/img/tutorials/presentation/ideal-layout.png" wide />

Let's see the code. In a file called `slides.ts` add the following:

```tsx filename="slides.ts"
import { SlideData, SLIDE_WIDTH, SLIDE_HEIGHT } from './Slide';

export const slidesToElements = (initial: string, slides: Record<string, SlideData>) => {
  // Push the initial slide's id and the position `{ x: 0, y: 0 }` onto a stack.
  const stack = [{ id: initial, position: { x: 0, y: 0 } }];
  const visited = new Set();
  const nodes = [];
  const edges = [];

  // While that stack is not empty...
  while (stack.length) {
    // Pop the current position and slide id off the stack.
    const { id, position } = stack.pop();
    // Look up the slide data by id.
    const data = slides[id];
    const node = { id, type: 'slide', position, data };

    // Push a new node onto the nodes array with the current id, position, and slide
    // data.
    nodes.push(node);
    // add the slide's id to a set of visited slides.
    visited.add(id);

    // For every direction (left, right, up, down)...
    // Make sure the slide has not already been visited.
    if (data.left && !visited.has(data.left)) {
      // Take the current position and update the x or y coordinate by adding or
      // subtracting `SLIDE_WIDTH` or `SLIDE_HEIGHT` depending on the direction.
      const nextPosition = {
        x: position.x - SLIDE_WIDTH,
        y: position.y,
      };

      // Push the new position and the new slide's id onto a stack.
      stack.push({ id: data.left, position: nextPosition });
      // Push a new edge onto the edges array connecting the current slide to the
      // new slide.
      edges.push({ id: `${id}->${data.left}`, source: id, target: data.left });
    }

    // Repeat for the remaining directions...
  }

  return { nodes, edges };
};
```

We've left out the code for the right, up, and down directions for brevity, but the logic
is the same for each direction. We've also included the same breakdown of the algorithm as
comments, to help you navigate the code.

Below is a demo app of the layouting algorithm, you can edit the `slides` object to see
how adding slides to different directions affects the layout. For example, try extending
4's data to include `down: '5'` and see how the layout updates.

<RemoteCodeViewer route="tutorials/presentation/layout-demo" framework="react" />

If you spend a little time playing with this demo, you'll likely run across two
limitations of this algorithm:

1. It is possible to construct a layout that overlaps two slides in the same position.

2. The algorithm will ignore nodes that cannot be reached from the initial slide.

Addressing these shortcomings is totally possible, but a bit beyond the scope of this
tutorial. If you give a shot, be sure to share your solution with us on the
[discord server](https://discord.com/invite/RVmnytFmGW)!

With our layouting algorithm written, we can hop back to `App.tsx` and remove the
hardcoded nodes array in favor of the new `slidesToElements` function.

```tsx filename="App.tsx" {2,3,5-9,15-16,24}
import { ReactFlow } from '@xyflow/react';
import { slidesToElements } from './slides';
import { Slide, SlideData, SLIDE_WIDTH } from './Slide';

const slides: Record<string, SlideData> = {
  '0': { source: '# Hello, React Flow!', right: '1' },
  '1': { source: '...', left: '0', right: '2' },
  '2': { source: '...', left: '1' },
};

const nodeTypes = {
  slide: Slide,
};

const initialSlide = '0';
const { nodes, edges } = slidesToElements(initialSlide, slides);

export default function App() {
  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ nodes: [{ id: initialSlide }] }}
      minZoom={0.1}
    />
  );
}
```

The slides in our flow are static, so we can move the `slidesToElements` call _outside_
the component to make sure we're not recalculating the layout if the component re-renders.
Alternatively, you could use React's `useMemo` hook to define things inside the component
but only calculate them once.

Because we have the idea of an "initial" slide now, we're also using the `fitViewOptions`
to ensure the initial slide is the one that is focused when the canvas is first loaded.

## Navigating between slides

So far we have our presentation laid out in a grid but we have to manually pan the canvas
to see each slide, which isn't very practical for a presentation! We're going to add three
different ways to navigate between slides:

- Click-to-focus on nodes for jumping to different slides by clicking on them.

- Navigation buttons on each slide for moving sequentially between slides in any valid
  direction.

- Keyboard navigation using the arrow keys for moving around the presentation without
  using the mouse or interacting with a slide directly.

### Focus on click

The `<ReactFlow />` element can receive an
[`onNodeClick`](/api-reference/react-flow#on-node-click) callback that fires when _any_
node is clicked. Along with the mouse event itself, we also receive a reference to the
node that was clicked on, and we can use that to pan the canvas thanks to the `fitView`
method.

[`fitView`](/api-reference/types/react-flow-instance#fit-view) is a method on the React
Flow instance, and we can get access to it by using the
[`useReactFlow`](/api-reference/types/react-flow-instance#use-react-flow) hook.

```tsx filename="App.tsx" {1-2,17-23,29}
import { useCallback } from 'react';
import { ReactFlow, useReactFlow, type NodeMouseHandler } from '@xyflow/react';
import { Slide, SlideData, SLIDE_WIDTH } from './Slide';

const slides: Record<string, SlideData> = {
  ...
}

const nodeTypes = {
  slide: Slide,
};

const initialSlide = '0';
const { nodes, edges } = slidesToElements(initialSlide, slides);

export default function App() {
  const { fitView } = useReactFlow();
  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      fitView({ nodes: [node], duration: 150 });
    },
    [fitView],
  );

  return (
    <ReactFlow
      ...
      fitViewOptions={{ nodes: [{ id: initialSlide }] }}
      onNodeClick={handleNodeClick}
    />
  );
}
```

<Callout>
  It's important to remember to include `fitView` as in the dependency array of our
  `handleNodeClick` callback. That's because the `fitView` function is replaced once React
  Flow has initialized the viewport. If you forget this step you'll likely find out that
  `handleNodeClick` does nothing at all (and yes, we also forget this ourselves sometimes
  too <Emoji content="🫠" />
  ).
</Callout>

Calling `fitView` with no arguments would attempt to fit every node in the graph into
view, but we only want to focus on the node that was clicked! The
[`FitViewOptions`](/api-reference/types/fit-view-options) object lets us provide an array
of just the nodes we want to focus on: in this case, that's just the node that was
clicked.

<RemoteCodeViewer route="tutorials/presentation/focus-on-click" framework="react" />

### Slide controls

Clicking to focus a node is handy for zooming out to see the big picture before focusing
back in on a specific slide, but it's not a very practical way for navigating around a
presentation. In this step we'll add some controls to each slide that allow us to move to
a connected slide in any direction.

Let's add a `<footer>` to each slide that conditionally renders a button in any direction
with a connected slide. We'll also preemptively create a `moveToNextSlide` callback that
we'll use in a moment.

```tsx filename="Slide.tsx" {3,8,13-18}
import { type NodeProps, fitView } from '@xyflow/react';
import { Remark } from 'react-remark';
import { useCallback } from 'react';

...

export function Slide({ data }: NodeProps<SlideNide>) {
  const moveToNextSlide = useCallback((id: string) => {}, []);

  return (
    <article className="slide nodrag" style={style}>
      <Remark>{data.source}</Remark>
      <footer className="slide__controls nopan">
        {data.left && (<button onClick={() => moveToNextSlide(data.left)}>←</button>)}
        {data.up && (<button onClick={() => moveToNextSlide(data.up)}>↑</button>)}
        {data.down && (<button onClick={() => moveToNextSlide(data.down)}>↓</button>)}
        {data.right && (<button onClick={() => moveToNextSlide(data.right)}>→</button>)}
      </footer>
    </article>
  );
}
```

You can style the footer however you like, but it's important to add the `"nopan"` class
to prevent prevent the canvas from panning as you interact with any of the buttons.

To implement `moveToSlide`, we'll make use of `fitView` again. Previously we had a
reference to the actual node that was clicked on to pass to `fitView`, but this time we
only have a node's id. You might be tempted to look up the target node by its id, but
actually that's not necessary! If we look at the type of
[`FitViewOptions`](/api-reference/types/fit-view-options) we can see that the array of
nodes we pass in only _needs_ to have an `id` property:

```ts filename="https://reactflow.dev/api-reference/types/fit-view-options" {7}
export type FitViewOptions = {
  padding?: number;
  includeHiddenNodes?: boolean;
  minZoom?: number;
  maxZoom?: number;
  duration?: number;
  nodes?: (Partial<Node> & { id: Node['id'] })[];
};
```

`Partial<Node>` means that all of the fields of the `Node` object type get marked as
optional, and then we intersect that with `{ id: Node['id'] }` to ensure that the `id`
field is always required. This means we can just pass in an object with an `id` property
and nothing else, and `fitView` will know what to do with it!

```tsx filename="Slide.tsx" {1,4,6-9}
import { type NodeProps, useReactFlow } from '@xyflow/react';

export function Slide({ data }: NodeProps<SlideNide>) {
  const { fitView } = useReactFlow();

  const moveToNextSlide = useCallback(
    (id: string) => fitView({ nodes: [{ id }] }),
    [fitView],
  );

  return (
    <article className="slide" style={style}>
      ...
    </article>
  );
}
```

<RemoteCodeViewer route="tutorials/presentation/slide-controls" framework="react" />

### Keyboard navigation

The final piece of the puzzle is to add keyboard navigation to our presentation. It's not
very convenient to have to _always_ click on a slide to move to the next one, so we'll add
some keyboard shortcuts to make it easier. React Flow lets us listen to keyboard events on
the `<ReactFlow />` component through handlers like
[`onKeyDown`](/api-reference/react-flow#on-key-down).

Up until now the slide currently focused is implied by the position of the canvas, but if
we want to handle key presses on the entire canvas we need to _explicitly_ track the
current slide. We need to this because we need to know which slide to navigate to when an
arrow key is pressed!

```tsx filename="App.tsx" {1,2,13-14,17,23}
import { useState, useCallback } from 'react';
import { ReactFlow, useReactFlow } from '@xyflow/react';
import { Slide, SlideData, SLIDE_WIDTH } from './Slide';

const slides: Record<string, SlideData> = {
  ...
}

const nodeTypes = {
  slide: Slide,
};

const initialSlide = '0';
const { nodes, edges } = slidesToElements(initialSlide, slides)

export default function App() {
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const { fitView } = useReactFlow();

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_, node) => {
      fitView({ nodes: [node] });
      setCurrentSlide(node.id);
    },
    [fitView],
  );

  return (
    <ReactFlow
      ...
      onNodeClick={handleNodeClick}
    />
  );
}
```

Here we've added a bit of state, `currentSlide`, to our flow component and we're making
sure to update it whenever a node is clicked. Next, we'll write a callback to handle
keyboard events on the canvas:

```tsx filename="App.tsx"
export default function App() {
  const [currentSlide, setCurrentSlide] = useState(initialSlide);
  const { fitView } = useReactFlow();

  ...

  const handleKeyPress = useCallback<KeyboardEventHandler>(
    (event) => {
      const slide = slides[currentSlide];

      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowRight':
          const direction = event.key.slice(5).toLowerCase();
          const target = slide[direction];

          if (target) {
            event.preventDefault();
            setCurrentSlide(target);
            fitView({ nodes: [{ id: target }] });
          }
      }
    },
    [currentSlide, fitView],
  );

  return (
    <ReactFlow
      ...
      onKeyPress={handleKeyPress}
    />
  );
}
```

To save some typing we're extracting the direction from the key pressed - if the user
pressed `'ArrowLeft'` we'll get `'left'` and so on. Then, if there is actually a slide
connected in that direction we'll update the current slide and call `fitView` to navigate
to it!

We're also preventing the default behavior of the arrow keys to prevent the window from
scrolling up and down. This is necessary for this tutorial because the canvas is only one
part of the page, but for an app where the canvas is the entire viewport you might not
need to do this.

And that's everything! To recap let's look at the final result and talk about what we've
learned.

<RemoteCodeViewer route="tutorials/presentation/app" framework="react" />

## Final thoughts

Even if you're not planning on making the next [Prezi](https://prezi.com), we've still
looked at a few useful features of React Flow in this tutorial:

- The [`useReactFlow`](/api-reference/hooks/use-react-flow) hook to access the `fitView`
  method.

- The [`onNodeClick`](/api-reference/react-flow#on-node-click) event handler to listen to
  clicks on every node in a flow.

- The [`onKeyPress`](/api-reference/react-flow#on-key-press) event handler to listen to
  keyboard events on the entire canvas.

We've also looked at how to implement a simple layouting algorithm ourselves. Layouting is
a _really_ common question we get asked about, but if your needs aren't that complex you
can get quite far rolling your own solution!

If you're looking for ideas on how to extend this project, you could try addressing the
issues we pointed out with the layouting algorithm, coming up with a more sophisticated
`Slide` component with different layouts, or something else entirely.

You can use the completed [source code](https://github.com/xyflow/react-flow-slide-show)
as a starting point, or you can just keep building on top of what we've made today. We'd
love to see what you build so please share it with us over on our
[Discord server](https://discord.com/invite/RVmnytFmGW) or
[Twitter](https://twitter.com/reactflowdev).
