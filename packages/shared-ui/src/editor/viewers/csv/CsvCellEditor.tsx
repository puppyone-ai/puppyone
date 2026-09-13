import { ExternalLink, Link2, Unlink } from "lucide-react";
import { useId, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import type { MessageFormatter } from "@puppyone/localization/core";
import type {
  DocumentNavigationPort,
  DocumentReference,
} from "../../navigation/documentNavigation";

type CsvCellEditorProps = Readonly<{
  value: string;
  readOnly: boolean;
  rowIndex: number;
  columnIndex: number;
  displayRowNumber: number;
  reference: DocumentReference | null;
  navigation: DocumentNavigationPort | null;
  onActivate: () => void;
  onCellKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onUpdate: (value: string) => void;
  t: MessageFormatter;
}>;

export function CsvCellEditor({
  value,
  readOnly,
  rowIndex,
  columnIndex,
  displayRowNumber,
  reference,
  navigation,
  onActivate,
  onCellKeyDown,
  onUpdate,
  t,
}: CsvCellEditorProps) {
  const previewId = useId();
  const projectedReference = reference?.kind === "external" || reference?.kind === "workspace"
    ? reference
    : null;
  const openable = Boolean(
    navigation
    && reference
    && navigation.canOpenReference(reference),
  );
  const target = reference?.kind === "external"
    ? reference.href
    : reference?.kind === "workspace"
      ? reference.path ?? reference.target
      : value;
  const open = () => {
    if (!navigation || !reference || !openable) return;
    void Promise.resolve()
      .then(() => navigation.openReference(reference))
      .catch((error) => {
        console.warn("Unable to open CSV document reference:", error);
      });
  };
  const handleClick = (event: MouseEvent<HTMLInputElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || !openable) return;
    event.preventDefault();
    event.stopPropagation();
    open();
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      event.key === "Enter"
      && (event.metaKey || event.ctrlKey)
      && !event.altKey
      && !event.shiftKey
      && openable
    ) {
      event.preventDefault();
      event.stopPropagation();
      open();
      return;
    }
    onCellKeyDown(event);
  };
  const referenceStatus = reference?.kind === "workspace"
    ? reference.status
    : reference?.kind ?? undefined;
  const kindLabel = !projectedReference ? "" : reference?.kind === "external"
    ? t("editor.csv.reference.external")
    : t("editor.csv.reference.workspace");
  const actionLabel = !projectedReference ? "" : openable
    ? t("editor.csv.reference.open", { target })
    : t("editor.csv.reference.unavailable", { target });

  const input = (
    <input
      className={reference ? "csv-table-editor__cell-input" : "csv-table-editor__cell-input csv-table-editor__cell-editor"}
      value={value}
      readOnly={readOnly}
      onChange={(event) => onUpdate(event.currentTarget.value)}
      onClick={handleClick}
      onFocus={onActivate}
      onKeyDown={handleKeyDown}
      aria-label={t("editor.csv.cell", {
        row: displayRowNumber,
        column: columnIndex + 1,
      })}
      aria-describedby={projectedReference ? previewId : undefined}
      aria-haspopup="menu"
      aria-expanded="false"
      data-csv-row={rowIndex}
      data-csv-column={columnIndex}
      spellCheck={false}
    />
  );
  // Plain cells need only the input; reference overlays retain their positioning host.
  if (!reference) return input;

  return (
    <div
      className="csv-table-editor__cell-editor"
      data-reference-kind={reference.kind}
      data-reference-status={referenceStatus}
      data-reference-syntax={reference.syntax}
    >
      {input}
      {projectedReference && (
        <>
          <span className="csv-table-editor__reference-label" aria-hidden="true" dir="auto">
            {projectedReference.label}
          </span>
          <button
            type="button"
            className="csv-table-editor__reference-action"
            data-po-interaction="navigation"
            disabled={!openable}
            aria-label={actionLabel}
            title={actionLabel}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          >
            {projectedReference.kind === "external"
              ? <ExternalLink size={13} strokeWidth={1.8} aria-hidden="true" />
              : projectedReference.status !== "missing"
                ? <Link2 size={13} strokeWidth={1.8} aria-hidden="true" />
                : <Unlink size={13} strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <span id={previewId} className="csv-table-editor__reference-preview" role="tooltip">
            <span className="csv-table-editor__reference-kind">{kindLabel}</span>
            <span className="csv-table-editor__reference-source" dir="ltr">
              {projectedReference.raw}
            </span>
          </span>
        </>
      )}
    </div>
  );
}
