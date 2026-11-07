import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRightLeft, ArrowRight, FileText, LoaderCircle, ShieldCheck, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { EditorDocument } from "../registry/viewerTypes";
import { useEditorTaskController } from "../runtime/EditorTaskContext";
import { convertDocument } from "./conversionClient";
import { useDocumentConversionPort } from "./DocumentConversionProvider";
import { ConversionResults } from "./ConversionResults";
import { DocumentConversionError, DocumentConversionSaveError, type ConversionResult, type ConversionSelection, type ConversionSaveResult } from "./types";
import { resolveDataResourceWorkspaceRoot } from "../../core/dataResourcePath";
import { getWorkspaceResourcePath, type ResourceUri } from "../../core/resourceUri";

export function DocumentConversionSurface(props: { document: EditorDocument; fileUrl?: string | null; children: ReactNode }) {
  const port = useDocumentConversionPort();
  let format: "docx" | "pdf" | null = null;
  if (/\.docx$/i.test(props.document.name)) format = "docx";
  if (/\.pdf$/i.test(props.document.name)) format = "pdf";
  if (!format || !port) return <>{props.children}</>;
  return <ConversionWorkbench key={props.document.path} {...props} format={format} />;
}

function ConversionWorkbench({ document, fileUrl, children, format }: {
  document: EditorDocument; fileUrl?: string | null; children: ReactNode; format: "docx" | "pdf";
}) {
  const { t } = useLocalization();
  const port = useDocumentConversionPort()!;
  const createController = useEditorTaskController();
  const [expanded, setExpanded] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "ready" | "failed">("idle");
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [selection, setSelection] = useState<ConversionSelection>({ markdown: true, tableIds: [] });
  const [includeTables, setIncludeTables] = useState(true);
  const [progress, setProgress] = useState<{ page: number; total: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ConversionSaveResult | null>(null);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const savingRef = useRef(false);
  const startButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const cancel = () => { controller.current?.abort(); setPhase("idle"); setProgress(null); };
  const start = async () => {
    if (!fileUrl || controller.current && !controller.current.signal.aborted && phase === "running") return;
    controller.current?.abort();
    const current = createController(); controller.current = current;
    setPhase("running"); setError(null); setSaved(null); setProgress(null);
    try {
      const next = await convertDocument(fileUrl, format, current.signal, (page, total) => {
        if (alive.current && !current.signal.aborted) setProgress({ page, total });
      });
      if (!alive.current || current.signal.aborted) return;
      setResult(next); setSelection(value => ({ ...value, tableIds: includeTables ? next.tables.map(table => table.id) : [] })); setPhase("ready");
    } catch (failure) {
      if (!alive.current || current.signal.aborted) return;
      setError(failure); setPhase("failed");
    }
  };
  const save = async () => {
    if (!result || savingRef.current || saved) return;
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const output = await port.save({ sourcePath: document.path, sourceName: document.name, result, selection });
      if (!alive.current) return;
      setSaved(output);
      try { await port.open(output.openPath); } catch { /* Saved output remains available for another open attempt. */ }
    } catch (failure) { if (alive.current) setError(failure); }
    finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };
  const close = () => { cancel(); setExpanded(false); setResult(null); setError(null); setSaved(null); requestAnimationFrame(() => startButton.current?.focus()); };
  let introMessage = t("editor.conversion.description");
  if (phase === "running") introMessage = progress ? t("editor.conversion.progress", progress) : t("editor.conversion.loading");
  const renderAction = () => {
    if (phase === "running") return <button className="document-conversion__button" type="button" onClick={cancel}>{t("common.action.cancel")}</button>;
    if (phase !== "ready") return <button className="document-conversion__button document-conversion__button--primary" type="button" disabled={!fileUrl || !selection.markdown && !includeTables} onClick={() => { void start(); }}>{t(phase === "failed" ? "common.action.retry" : "editor.conversion.start")}<ArrowRight size={14} /></button>;
    if (saved) return <button className="document-conversion__button document-conversion__button--primary" type="button" onClick={() => { void Promise.resolve(port.open(saved.openPath)).catch(() => {}); }}>{t("editor.conversion.openResult")}</button>;
    return <div className="document-conversion__footer-actions"><button className="document-conversion__text-button" type="button" disabled={saving} onClick={() => { void start(); }}>{t("editor.conversion.reconvert")}</button>
      <button className="document-conversion__button document-conversion__button--primary" type="button" disabled={saving || !selection.markdown && !selection.tableIds.length} onClick={() => { void save(); }}>{saving && <LoaderCircle size={14} className="document-conversion__spinner" />}{t(saving ? "editor.conversion.saving" : "editor.conversion.saveOpen")}</button></div>;
  };
  return <section className={`document-conversion${expanded ? " document-conversion--expanded" : ""}`} aria-label={t("editor.conversion.title")}>
    <header className="document-conversion__toolbar">
      <div className="document-conversion__toolbar-label"><ArrowRightLeft size={15} /><span>{t(expanded ? "editor.conversion.title" : "editor.conversion.toolbarHint")}</span></div>
      {expanded ? <button className="document-conversion__icon-button" type="button" disabled={saving} aria-label={t("editor.conversion.close")} onClick={close}><X size={16} /></button>
        : <button ref={startButton} className="document-conversion__button" type="button" disabled={!fileUrl} onClick={() => setExpanded(true)}>{t("editor.conversion.convert")}<ArrowRight size={14} /></button>}
    </header>
    <div className="document-conversion__comparison">
      <div className="document-conversion__original">
        {expanded && <div className="document-conversion__pane-label">{t("editor.conversion.original")}<span>{document.name}</span></div>}
        <div className="document-conversion__original-content">{children}</div>
      </div>
      {expanded && <div className="document-conversion__destination">
        <div className="document-conversion__pane-label">{t("editor.conversion.result")}<span><ShieldCheck size={13} />{t("editor.conversion.local")}</span></div>
        {phase === "ready" && result ? <ConversionResults result={result} selection={selection} onSelectionChange={setSelection} />
          : <div className="document-conversion__intro">
            <div className="document-conversion__intro-icon">{phase === "running" ? <LoaderCircle className="document-conversion__spinner" size={28} /> : <FileText size={28} />}</div>
            <h2>{t(phase === "running" ? "editor.conversion.processing" : "editor.conversion.introTitle")}</h2>
            <p>{introMessage}</p>
            {phase !== "running" && <div className="document-conversion__choices">
              <label><input className="document-conversion__check" type="checkbox" checked={selection.markdown} onChange={event => setSelection(value => ({ ...value, markdown: event.target.checked }))} /><span><strong>{t("editor.conversion.markdown")}</strong><small>{t("editor.conversion.markdownHint")}</small></span></label>
              <label><input className="document-conversion__check" type="checkbox" checked={includeTables} onChange={event => setIncludeTables(event.target.checked)} /><span><strong>{t("editor.conversion.csv")}</strong><small>{t("editor.conversion.csvHint")}</small></span></label>
            </div>}
            {format === "pdf" && phase !== "running" && <p className="document-conversion__scope">{t("editor.conversion.pdfScope")}</p>}
            {phase === "running" && <div className="document-conversion__processing" role="status" aria-label={t("editor.conversion.processing")}><progress max={progress?.total} value={progress?.page} /></div>}
          </div>}
        {error != null && <div className="document-conversion__error" role="alert">{t(errorKey(error), { path: error instanceof DocumentConversionSaveError ? displayOutputFolder(error.folderPath) : "" })}</div>}
        <footer className="document-conversion__footer">
          <div className="document-conversion__save-location">{saved ? <><strong>{t("editor.conversion.saved")}</strong><span>{displayOutputFolder(saved.folderPath)}</span></> : <><strong>{t("editor.conversion.saveLocation")}</strong><span>{t("editor.conversion.saveLocationHint")}</span></>}</div>
          {renderAction()}
        </footer>
      </div>}
    </div>
  </section>;
}

function displayOutputFolder(path: string): string {
  const root = resolveDataResourceWorkspaceRoot(path);
  return root ? getWorkspaceResourcePath(root, path as ResourceUri) : path;
}

function errorKey(error: unknown) {
  const keys: Record<string, string> = {
    "limit": "editor.conversion.error.limit", "page-limit": "editor.conversion.error.pageLimit", "ocr-required": "editor.conversion.error.ocr",
    "encrypted": "editor.conversion.error.encrypted", "timeout": "editor.conversion.error.timeout", "source-changed": "editor.conversion.error.sourceChanged",
    "save-partial": "editor.conversion.error.savePartial", "save-unavailable": "editor.conversion.error.saveUnavailable",
  };
  return error instanceof DocumentConversionError ? keys[error.code] ?? "editor.conversion.error.failed" : "editor.conversion.error.failed";
}
