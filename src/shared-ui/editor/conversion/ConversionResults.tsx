import { lazy, Suspense, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { Check, FileText, Table2, TriangleAlert } from "lucide-react";
import type { ConversionResult, ConversionSelection } from "./types";

const MarkdownPreview = lazy(() => import("./ConversionMarkdownPreview"));
export function ConversionResults({ result, selection, onSelectionChange }: {
  result: ConversionResult; selection: ConversionSelection; onSelectionChange: (selection: ConversionSelection) => void;
}) {
  const { t } = useLocalization();
  const [tab, setTab] = useState<"markdown" | "tables">("markdown");
  const [source, setSource] = useState(false);
  const renderContent = () => {
    if (tab === "markdown" && source) return <pre className="document-conversion__source-text">{result.markdown}</pre>;
    if (tab === "markdown") return <Suspense fallback={<p className="document-conversion__muted">{t("editor.conversion.loading")}</p>}><MarkdownPreview result={result} /></Suspense>;
    if (!result.tables.length) return <div className="document-conversion__empty"><Table2 size={28} /><strong>{t("editor.conversion.noTables")}</strong><p>{t("editor.conversion.noTablesHint")}</p></div>;
    return result.tables.map((table, index) => <section className="document-conversion__table-card" key={table.id}>
            <label><input className="document-conversion__check" type="checkbox" checked={selection.tableIds.includes(table.id)}
              onChange={event => onSelectionChange({ ...selection, tableIds: event.target.checked ? [...selection.tableIds, table.id] : selection.tableIds.filter(id => id !== table.id) })} />
              <strong>{t("editor.conversion.table", { number: index + 1 })}</strong>
              <span>{t("editor.conversion.dimensions", { rows: table.rows.length, columns: table.rows[0]?.length ?? 0 })}{table.page ? ` · ${t("editor.conversion.page", { number: table.page })}` : ""}</span>
            </label>
            <div className="document-conversion__table-scroll"><table><tbody>{table.rows.slice(0, 50).map((row, y) => <tr key={y}>{row.slice(0, 20).map((cell, x) => y === 0 ? <th key={x} scope="col">{cell}</th> : <td key={x}>{cell}</td>)}</tr>)}</tbody></table></div>
            {(table.rows.length > 50 || (table.rows[0]?.length ?? 0) > 20) && <p className="document-conversion__muted">{t("editor.conversion.tablePreviewLimit")}</p>}
          </section>);
  };
  return <>
    <div className="document-conversion__summary" role="status"><Check size={15} />{t("editor.conversion.ready")}
      <span>{t("editor.conversion.counts", { images: result.assets.length, tables: result.tables.length })}</span>
    </div>
    <div className="document-conversion__outputs">
      <label><input className="document-conversion__check" type="checkbox" data-output="markdown" checked={selection.markdown}
        onChange={event => onSelectionChange({ ...selection, markdown: event.target.checked })} /><FileText size={15} />{t("editor.conversion.markdown")}</label>
      {result.tables.length > 0 && <span>{t("editor.conversion.csvSelection", { count: selection.tableIds.length })}</span>}
    </div>
    {result.warnings.length > 0 && <details className="document-conversion__warnings" open>
      <summary><TriangleAlert size={14} />{t("editor.conversion.review", { count: result.warnings.length })}</summary>
      <ul>{result.warnings.map((warning, index) => <li key={index}>{t(warningKey(warning.code), { pages: warning.pages?.join(", ") ?? "" })}</li>)}</ul>
    </details>}
    <div className="document-conversion__tabs" role="group" aria-label={t("editor.conversion.result")}>
      <button className="document-conversion__tab" type="button" aria-pressed={tab === "markdown"} onClick={() => setTab("markdown")}><FileText size={15} />{t("editor.conversion.markdown")}</button>
      <button className="document-conversion__tab" type="button" aria-pressed={tab === "tables"} onClick={() => setTab("tables")}><Table2 size={15} />{t("editor.conversion.tables", { count: result.tables.length })}</button>
      {tab === "markdown" && <button className="document-conversion__text-button" type="button" aria-pressed={source} onClick={() => setSource(value => !value)}>{t(source ? "editor.conversion.preview" : "editor.conversion.source")}</button>}
    </div>
    <div className="document-conversion__result" role="region" aria-label={t(tab === "markdown" ? "editor.conversion.markdown" : "editor.conversion.tableResults")}>
      {renderContent()}
    </div>
  </>;
}

function warningKey(code: string) {
  const keys: Record<string, string> = {
    "merged-cells": "editor.conversion.warning.mergedCells", "image-omitted": "editor.conversion.warning.imageOmitted",
    "docx-review": "editor.conversion.warning.docxReview", "docx-layout": "editor.conversion.warning.docxLayout",
    "pdf-layout": "editor.conversion.warning.pdfLayout", "pdf-images": "editor.conversion.warning.pdfImages",
    "pdf-tables": "editor.conversion.warning.pdfTables", "empty-pages": "editor.conversion.warning.emptyPages",
    "ocr-pages": "editor.conversion.warning.ocrPages", "ocr-confidence": "editor.conversion.warning.ocrConfidence",
    "image-pages": "editor.conversion.warning.imagePages", "ocr-empty": "editor.conversion.warning.ocrEmpty",
    "ocr-skipped": "editor.conversion.warning.ocrSkipped",
  };
  return keys[code] ?? "editor.conversion.warning.docxReview";
}
