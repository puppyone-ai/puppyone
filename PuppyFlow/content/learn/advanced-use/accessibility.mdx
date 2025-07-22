---
description: React Flow is designed to be both keyboard and screen reader accessible.
---

import { Callout } from 'nextra/components';

# Accessibility

<Callout type="info">

If you have suggestions for how we can improve the accessibility of React Flow, please feel free to [contact us](https://xyflow.com/contact).

</Callout>

React Flow provides keyboard and screen-reader support to help meet accessibility standards. By default, all nodes and edges are keyboard-focusable and operable. You can enable or disable these features with props including: [nodesFocusable](/api-reference/react-flow#nodesfocusable), [edgesFocusable](/api-reference/react-flow#edgesfocusable), and [disableKeyboardA11y](/api-reference/react-flow#disablekeyboarda11y) which are passed through `<ReactFlow />` like this:

```js
<ReactFlow
  nodesFocusable={true}
  edgesFocusable={true}
  disableKeyboardA11y={false}
  nodes={nodes}
  edges={edges}
>
  {/* ...other components like Controls, MiniMap... */}
</ReactFlow>
```

## Built-in features

- **Tab navigation:** Pressing `Tab` moves focus through all focusable nodes and edges. These elements receive `tabIndex={0}` and, by default, `role="group"` to handle interactivity.
- **Select/Deselect:** Press `Enter` or `Space` to select the focused node/edge, and `Escape` to clear the selection.
- **Move nodes with arrow keys:** If `nodesDraggable` and `nodesFocusable` are both true (default), you can move the selected node with the arrow keys. You can hold `Shift` to increase movement speed. If you set `disableKeyboardA11y={true}`, arrow-key movement is disabled (but tab-focus and selection still work).
- **Automatic panning:** When a node receives focus, React Flow automatically pans the canvas to bring that node into view. This ensures focused nodes are visible to the user. This behavior can be toggled via the [autoPanOnNodeFocus](/api-reference/react-flow#autopanonnodefocus) prop.
- **ARIA descriptions:** React Flow automatically adds ARIA descriptions for keyboard guidance. These can be configured by using [ariaLabelConfig](/api-reference/react-flow#arialabelconfig).

<Callout type="info">
  To enable full keyboard accessibility, ensure both `nodesFocusable` and `edgesFocusable`
  are set to `true`. If either is false, corresponding elements will not be
  keyboard-focusable.
</Callout>
## ARIA roles for nodes and edges

By default, React Flow uses semantic ARIA roles for interactive elements. You can override a node’s role using the `ariaRole` prop. For example:

```js
const nodes = [
  {
    id: '1',
    data: { label: 'Hello' },
    ariaRole: 'button',
  },
];
<ReactFlow nodes={nodes} edges={[]} />;
```

By, default, if you don’t set a role, `role="group"` is applied. Customizing `ariaRole` lets you match any relevant ARIA role (e.g. `"listitem"`, `"region"`, etc.), improving semantic information for assistive technology.

**Note:** The `ariaRole` is applied to the node wrapper. If a custom node includes interactive elements, avoid setting `ariaRole: 'button'` on the node itself. Instead, apply the appropriate ARIA role directly to the interactive element.

### DOM attributes

To pass custom ARIA attributes or other DOM-level attributes (e.g., `aria-roledescription`, `data-\*`,`tabIndex`, etc.), you can use the `domAttributes` prop. This is available for both nodes and edges:

```
// Example for a node
{
  id: '2',
  data: { label: 'Accessible Node' },
  domAttributes: {
    'aria-roledescription': 'collapsible node',
    tabIndex: 0,
    'data-test-id': 'node-2',
  },
}

```

This gives you full control over accessibility-related attributes while maintaining React Flow’s built-in roles and behaviors.

## Localizing accessibility messages

React Flow’s built-in accessibility text (such as keyboard instructions and live updates) can be customized or localized via the [ariaLabelConfig](/api-reference/react-flow#arialabelconfig) prop on`<ReactFlow>`. This prop takes an object mapping message keys to strings or functions. Keys include:

| Key                                     | Default Value                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `node.a11yDescription.default`          | Press enter or space to select a node. Press delete to remove it and escape to cancel.                                                          |
| `node.a11yDescription.keyboardDisabled` | Press enter or space to select a node. You can then use the arrow keys to move the node around. Press delete to remove it and escape to cancel. |
| `node.a11yDescription.ariaLiveMessage`  | `Moved selected node {direction}. New position, x: {x}, y: {y}`                                                                                 |
| `edge.a11yDescription.default`          | Press enter or space to select an edge. You can then press delete to remove it or escape to cancel.                                             |
| `controls.ariaLabel`                    | Control Panel                                                                                                                                   |
| `controls.zoomIn.ariaLabel`             | Zoom In                                                                                                                                         |
| `controls.zoomOut.ariaLabel`            | Zoom Out                                                                                                                                        |
| `controls.fitView.ariaLabel`            | Fit View                                                                                                                                        |
| `controls.interactive.ariaLabel`        | Toggle Interactivity                                                                                                                            |
| `minimap.ariaLabel`                     | Mini Map                                                                                                                                        |
| `handle.ariaLabel`                      | Handle                                                                                                                                          |

For example, to provide custom or localized text:

```js
const ariaLabels = {
  'node.a11yDescription.default': 'Press [Enter] to select this node',
  'node.a11yDescription.keyboardDisabled': 'Keyboard navigation is disabled',
};
<ReactFlow nodes={nodes} edges={edges} ariaLabelConfig={ariaLabels}>
  <MiniMap />
  <Controls />
</ReactFlow>;
```

This tells React Flow to use your text instead of the defaults. By supplying localized strings via [ariaLabelConfig](/api-reference/react-flow#arialabelconfig), you ensure screen readers announce messages in the user’s language.

## WCAG 2.1 AA

React Flow provides features that can help you meet key WCAG 2.1 AA criteria when properly implemented:

- **Keyboard:** React Flow supports keyboard operability with `Tab` navigation to nodes and edges, interaction via `Enter`/`Space`, and arrow key movement for nodes. These features help satisfy requirements for keyboard accessibility.
- **Screen Reader:** With semantic ARIA roles and labels (e.g. `role="group"`, `aria-label`, and `aria-roledescription`), React Flow enables you to create meaningfully announced graphical nodes/edges. Edge components include a customizable `aria-label` and nodes can be given appropriate `aria-label` text.
- **ARIA Live Regions:** Dynamic updates are announced through an `aria-live` region. The `A11yDescriptions` component includes an element with `aria-live="assertive"` that notifies users of node movements, helping you meet requirements for status messages.
- **Instructions and Focus Management:** React Flow provides contextual help with clear instructions like "Press enter or space to select a node…". The automatic focus management ensures nodes scroll into view when focused, helping satisfy requirements for input assistance.

This guide is helpful for learning about [ARIA best practices](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/).
