import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "@puppyone/localization/react";
import type { MarkdownTableShape } from "./core/commands/markdownInsertCommands";

export function MarkdownTableInsertDialog({ onInsert, onCancel }: {
  onInsert: (shape: MarkdownTableShape) => void;
  onCancel: () => void;
}) {
  const { t } = useLocalization();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(2);
  const valid = Number.isInteger(rows) && rows >= 1 && rows <= 50
    && Number.isInteger(columns) && columns >= 1 && columns <= 20 && rows * columns <= 500;
  useEffect(() => { form.current?.querySelector("input")?.focus(); }, []);
  return createPortal(
    <div className="markdown-table-insert-backdrop" data-native-surface-occluder="true"
      onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <form ref={form} className="markdown-table-insert-dialog" role="dialog" aria-modal="true"
        aria-labelledby={`${id}-title`} aria-describedby={`${id}-hint`}
        onSubmit={event => { event.preventDefault(); if (valid) onInsert({ rows, columns }); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); onCancel(); }
          if (event.key !== "Tab") return;
          const controls = [...(form.current?.querySelectorAll<HTMLElement>("input, button:not(:disabled)") ?? [])];
          const first = controls[0]; const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <h2 id={`${id}-title`}>{t("editor.shortcuts.table")}</h2>
        <div className="markdown-table-insert-fields">
          <label>{t("editor.shortcuts.tableRows")}<input type="number" min={1} max={50} step={1} required
            value={rows} onChange={event => setRows(event.currentTarget.valueAsNumber)} /></label>
          <label>{t("editor.shortcuts.tableColumns")}<input type="number" min={1} max={20} step={1} required
            value={columns} onChange={event => setColumns(event.currentTarget.valueAsNumber)} /></label>
        </div>
        <p id={`${id}-hint`}>{t("editor.shortcuts.tableSizeHint")}</p>
        <div className="markdown-table-insert-actions">
          <button type="button" onClick={onCancel}>{t("editor.shortcuts.cancel")}</button>
          <button type="submit" disabled={!valid}>{t("editor.shortcuts.insert")}</button>
        </div>
      </form>
    </div>, document.querySelector("[data-po-overlay-root]") ?? document.body,
  );
}
