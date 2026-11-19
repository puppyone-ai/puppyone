import { createElement } from "react";
import {
  getEditableTableMenuIconNodes,
  type EditableTableMenuIconName,
} from "./editableTableMenuIcons";

export function EditableTableMenuIcon({ name }: { name: EditableTableMenuIconName }) {
  return createElement(
    "svg",
    {
      "aria-hidden": "true",
      className: "po-editable-table-menu-icon",
      fill: "none",
      focusable: "false",
      stroke: "currentColor",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.75,
      viewBox: "0 0 24 24",
    },
    getEditableTableMenuIconNodes(name).map((node, index) => createElement(node.tag, {
      ...node.attributes,
      key: `${node.tag}-${index}`,
    })),
  );
}
