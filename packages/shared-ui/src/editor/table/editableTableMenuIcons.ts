export type EditableTableMenuIconName =
  | "align-center"
  | "align-default"
  | "align-left"
  | "align-right"
  | "auto-fit-column"
  | "delete"
  | "duplicate-row"
  | "fit-viewport"
  | "insert-column-left"
  | "insert-column-right"
  | "insert-row-above"
  | "insert-row-below"
  | "move-down"
  | "move-left"
  | "move-right"
  | "move-up"
  | "reset-widths";

type EditableTableMenuIconNode = Readonly<{
  tag: "circle" | "line" | "path" | "polyline" | "rect";
  attributes: Readonly<Record<string, string | number>>;
}>;

const icon = (...nodes: EditableTableMenuIconNode[]) => nodes;
const path = (d: string): EditableTableMenuIconNode => ({ tag: "path", attributes: { d } });

const EDITABLE_TABLE_MENU_ICONS: Readonly<Record<EditableTableMenuIconName, readonly EditableTableMenuIconNode[]>> = {
  "align-center": icon(path("M4 6h16M7 10h10M5 14h14M8 18h8")),
  "align-default": icon(path("M4 6h16M4 10h16M4 14h16M4 18h16")),
  "align-left": icon(path("M4 6h16M4 10h10M4 14h16M4 18h8")),
  "align-right": icon(path("M4 6h16M10 10h10M4 14h16M12 18h8")),
  "auto-fit-column": icon(path("M4 5v14M20 5v14M4 12h5M7 9l3 3-3 3M20 12h-5M17 9l-3 3 3 3")),
  delete: icon(path("M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5")),
  "duplicate-row": icon(path("M8 8h11v11H8zM5 16V5h11")),
  "fit-viewport": icon(path("M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5")),
  "insert-column-left": icon(path("M14 4v16M19 4v16M4 12h7M7.5 8.5v7")),
  "insert-column-right": icon(path("M5 4v16M10 4v16M13 12h7M16.5 8.5v7")),
  "insert-row-above": icon(path("M4 14h16M4 19h16M12 4v7M8.5 7.5h7")),
  "insert-row-below": icon(path("M4 5h16M4 10h16M12 13v7M8.5 16.5h7")),
  "move-down": icon(path("M12 4v15M6.5 13.5 12 19l5.5-5.5")),
  "move-left": icon(path("M20 12H5M10.5 6.5 5 12l5.5 5.5")),
  "move-right": icon(path("M4 12h15M13.5 6.5 19 12l-5.5 5.5")),
  "move-up": icon(path("M12 20V5M6.5 10.5 12 5l5.5 5.5")),
  "reset-widths": icon(path("M4.7 9a8 8 0 1 1 1.7 8.6M4 4v5h5")),
};

export function getEditableTableMenuIconNodes(name: EditableTableMenuIconName) {
  return EDITABLE_TABLE_MENU_ICONS[name];
}

export function createEditableTableMenuIcon(
  document: Document,
  name: EditableTableMenuIconName,
): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.classList.add("po-editable-table-menu-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const node of getEditableTableMenuIconNodes(name)) {
    const element = document.createElementNS(namespace, node.tag);
    for (const [attribute, value] of Object.entries(node.attributes)) {
      element.setAttribute(attribute, String(value));
    }
    svg.appendChild(element);
  }
  return svg;
}
