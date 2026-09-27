"use client";

import type { MessageFormatter } from "@puppyone/localization/core";
import { Settings2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type CsvViewSettingsProps = Readonly<{
  direction: "ltr" | "rtl";
  headerEnabled: boolean;
  onFitToViewport: () => void;
  onHeaderChange: (enabled: boolean) => void;
  onResetColumnWidths: () => void;
  onRowNumbersChange: (visible: boolean) => void;
  rowNumbersVisible: boolean;
  t: MessageFormatter;
}>;

export function CsvViewSettings({
  direction,
  headerEnabled,
  onFitToViewport,
  onHeaderChange,
  onResetColumnWidths,
  onRowNumbersChange,
  rowNumbersVisible,
  t,
}: CsvViewSettingsProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const popover = popoverRef.current;
    const input = popover?.querySelector<HTMLInputElement>("input");
    if (!button || !popover || !input) return;
    input.focus({ preventScroll: true });

    const document = popover.ownerDocument;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (popover.contains(event.target) || button.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      button.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div className="csv-table-editor__settings" dir={direction}>
      <button
        ref={buttonRef}
        type="button"
        className="csv-table-editor__settings-button"
        aria-label={t("editor.csv.settings")}
        aria-controls={open ? popoverId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tooltip={t("editor.csv.settings")}
        onClick={() => setOpen((current) => !current)}
      >
        <Settings2 size={15} aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={popoverId}
          className="desktop-menu-surface csv-table-editor__settings-popover"
          data-native-surface-occluder="true"
          data-po-scrollbar="menu"
          role="dialog"
          aria-label={t("editor.csv.settings")}
        >
          <label
            className="csv-table-editor__view-toggle"
            data-tooltip={t("editor.csv.header")}
          >
            <span className="csv-table-editor__view-toggle-label">
              {t("editor.csv.headerToggle")}
            </span>
            <input
              type="checkbox"
              role="switch"
              className="csv-table-editor__view-toggle-input csv-table-editor__header-toggle-input"
              checked={headerEnabled}
              aria-label={t("editor.csv.header")}
              onChange={(event) => onHeaderChange(event.currentTarget.checked)}
            />
            <span className="csv-table-editor__view-toggle-track" aria-hidden="true" />
          </label>
          <label
            className="csv-table-editor__view-toggle"
            data-tooltip={t("editor.csv.rowNumbers")}
          >
            <span className="csv-table-editor__view-toggle-label">
              {t("editor.csv.rowNumbersToggle")}
            </span>
            <input
              type="checkbox"
              role="switch"
              className="csv-table-editor__view-toggle-input csv-table-editor__row-numbers-toggle-input"
              checked={rowNumbersVisible}
              aria-label={t("editor.csv.rowNumbers")}
              onChange={(event) => onRowNumbersChange(event.currentTarget.checked)}
            />
            <span className="csv-table-editor__view-toggle-track" aria-hidden="true" />
          </label>
          <div className="csv-table-editor__view-actions" role="group">
            <button
              type="button"
              className="csv-table-editor__view-action"
              onClick={() => {
                onFitToViewport();
                setOpen(false);
              }}
            >
              {t("editor.csv.fitToViewport")}
            </button>
            <button
              type="button"
              className="csv-table-editor__view-action"
              onClick={() => {
                onResetColumnWidths();
                setOpen(false);
              }}
            >
              {t("editor.csv.resetColumnWidths")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
