# Block drag handle

A hover handle that moves a Markdown block within its parent. The keyboard
shortcuts ship with it, so turning it off removes both.

| File | Owns |
| --- | --- |
| `blockDragExtension.ts` | The one `Extension`: keymap plus the view plugin |
| `blockDragController.ts` | Pointer gesture state and when things happen |
| `blockDragGeometry.ts` | Layout reads and pure hit-testing; writes nothing |
| `blockDragOverlay.ts` | DOM writes; reads nothing |
| `blockDragPreview.ts` | The still copy of a block that follows the pointer |

Three rules keep the gesture smooth and correct:

- Hit-testing uses CodeMirror's height map, not `posAtCoords` or the event
  target. A row answers the same way whether the pointer is over text, blank
  space, a widget, or an editable control inside a widget.
- The overlay lives inside the scroller in document coordinates, so it scrolls
  natively with the content and needs no JavaScript while scrolling.
- Pressing the handle does not touch focus or the selection. Either one could
  reveal Markdown source and shift the layout under the pointer.

What moves, and where it may land, is decided by core:
`core/syntax/markdownBlockBoundaries.ts` and `core/commands/markdownBlockMove.ts`.
