import { Facet } from "@codemirror/state";
import type { EditorTaskOwner } from "../../../runtime/EditorTaskScheduler";

export const markdownTaskOwner = Facet.define<EditorTaskOwner | null, EditorTaskOwner | null>({
  combine: (values) => values[0] ?? null,
});
