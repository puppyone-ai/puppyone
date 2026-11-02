import { MoreHorizontal } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { EditorPaneMenuSegmentedControl } from "../../editorPaneMenuContribution";

/** Standalone previews have no pane menu; keep their controls out of document flow. */
export function HtmlViewMenu({ item }: { item: EditorPaneMenuSegmentedControl }) {
  const { t } = useLocalization();
  return <details className="html-editor-options" onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.currentTarget.removeAttribute("open");
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label={t("editor.panes.actions")} aria-haspopup="menu"><MoreHorizontal size={16} /></summary>
    <div role="menu" aria-label={item.label}>
      {item.options.map((option) => <button key={option.id} type="button" role="menuitemradio"
        aria-checked={item.value === option.id} data-mode={option.id}
        onClick={(event) => {
          const menu = event.currentTarget.closest("details");
          menu?.removeAttribute("open");
          menu?.querySelector("summary")?.focus();
          item.setValue(option.id);
        }}>{option.icon}{option.label}</button>)}
    </div>
  </details>;
}
