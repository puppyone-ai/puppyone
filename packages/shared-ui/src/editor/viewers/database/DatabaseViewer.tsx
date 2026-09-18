import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import { useEditorPreviewServices } from "../../preview-services/EditorPreviewServices";
import type { DatabaseColumn, DatabaseInfo, DatabasePage, DatabasePreviewSession } from "../../preview-services/types";
import { useEditorDependencies, useEditorTaskOwner } from "../../runtime/EditorTaskContext";
import { acquireEditorHostLease } from "../../runtime/EditorHostLeases";
import { useDocumentModelOwner } from "../../document-session/DocumentModelOwner";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";

type ViewState = { selectedName: string; columnOffset: number };
type DisplayPage = DatabasePage & { visibleColumns: readonly DatabaseColumn[]; columns: readonly DatabaseColumn[]; offset: number };

export function DatabaseViewer({ document, openExternalFile }: PresetViewerRenderContext) {
  const { t } = useLocalization();
  const { services, revision } = useEditorPreviewServices();
  const owner = useEditorTaskOwner();
  const dependencies = useEditorDependencies();
  const modelOwner = useDocumentModelOwner();
  const [attempt, setAttempt] = useState(0);
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [selected, setSelected] = useState("");
  const [columnOffset, setColumnOffset] = useState(0);
  const [page, setPage] = useState<DisplayPage | null>(null);
  const [tab, setTab] = useState<"data" | "schema">("data");
  const session = useRef<DatabasePreviewSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const view = useRef<ViewState>({ selectedName: "", columnOffset: 0 });

  useEffect(() => {
    const token = ++epoch.current;
    const abort = new AbortController(); controller.current = abort;
    setInfo(null); setPage(null); setError(null); setBusy(true);
    const port = services?.database;
    if (!port || !owner) { setError("capability-unavailable"); setBusy(false); return () => { abort.abort(); epoch.current++; }; }
    const tracking = dependencies.index.begin();
    // A finite candidate set only; unknown inputs never trigger directory scans.
    for (const suffix of ["", "-journal", "-wal", "-shm", ".wal"]) tracking.track("resource", `${document.path}${suffix}`);
    tracking.commit();
    const lease = acquireEditorHostLease(owner, async (signal) => {
      const value = await port.open(document.path, signal);
      return { value, release: value.close };
    }, abort.signal);
    void lease.ready.then(async (value) => {
      if (abort.signal.aborted || token !== epoch.current) return;
      session.current = value;
      const info = await value.ready;
      if (abort.signal.aborted || token !== epoch.current) return;
      setInfo(info);
      const saved = modelOwner?.readViewState<ViewState>("database");
      const object = info.objects.find((entry) => entry.name === saved?.selectedName && entry.readable)
        ?? info.objects.find((entry) => entry.readable);
      if (object) {
        setSelected(object.id); setColumnOffset(0); view.current = { selectedName: object.name, columnOffset: 0 };
        let result = await value.readPage({ objectId: object.id }, abort.signal);
        const savedOffset = saved?.selectedName === object.name ? saved.columnOffset : 0;
        if (savedOffset && Number.isSafeInteger(savedOffset) && savedOffset > 0 && savedOffset < (result.columns?.length ?? 0)) {
          result = await value.readPage({ objectId: object.id, columnOffset: savedOffset }, abort.signal);
        }
        if (!abort.signal.aborted && token === epoch.current) {
          const offset = Number(result.visibleColumns?.[0]?.id ?? 0);
          setColumnOffset(offset); view.current.columnOffset = offset;
          setPage({ ...result, columns: result.columns ?? [], visibleColumns: result.visibleColumns ?? [], offset: 0 });
        }
      }
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted && token === epoch.current) setError(failure instanceof Error ? failure.message : "host-failed");
      void lease.close().catch(() => {});
    }).finally(() => { if (!abort.signal.aborted && token === epoch.current) setBusy(false); });
    return () => {
      // This ref is a generation counter, not a DOM ref to capture at setup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++; session.current = null; abort.abort();
      modelOwner?.writeViewState("database", view.current);
      void lease.close().catch(() => { /* Exit remains registered with the common host barrier. */ });
    };
  }, [services?.database, owner, document.path, revision, dependencies.index, dependencies.revision, attempt, modelOwner]);

  const expiresAt = page?.expiresAt ?? info?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => {
      setPage(null); setError("stale-input"); controller.current?.abort();
      void session.current?.close().catch(() => {});
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAt]);

  const read = async (objectId: string, offset: number, next = false) => {
    const value = session.current, abort = controller.current, token = epoch.current;
    if (!value || !abort || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await value.readPage(next && page?.cursor ? { cursor: page.cursor } : { objectId, columnOffset: offset }, abort.signal);
      if (abort.signal.aborted || token !== epoch.current) return;
      setSelected(objectId); setColumnOffset(offset); view.current = { selectedName: info?.objects.find((object) => object.id === objectId)?.name ?? "", columnOffset: offset };
      setPage({ ...result, columns: result.columns ?? page?.columns ?? [], visibleColumns: result.visibleColumns ?? page?.visibleColumns ?? [],
        offset: next ? (page?.offset ?? 0) + (page?.rows.length ?? 0) : 0 });
    } catch (failure) { if (!abort.signal.aborted && token === epoch.current) { setPage(null); setError(failure instanceof Error ? failure.message : "host-failed"); } }
    finally { if (!abort.signal.aborted && token === epoch.current) setBusy(false); }
  };

  return <section className="database-preview" data-document-surface-ready={!busy || info ? "true" : undefined}>
    <header className="database-preview-toolbar">
      <strong>{info ? `${info.engine === "sqlite" ? "SQLite" : "DuckDB"} · ${info.engineVersion}` : t("editor.database.title")}</strong>
      <span>{t("editor.database.readonly")}</span>
      <button type="button" onClick={() => setAttempt((value) => value + 1)}>{t("editor.database.reload")}</button>
      {openExternalFile && <button type="button" onClick={() => { void openExternalFile(document.path).catch(() => setError("host-failed")); }}>{t("editor.openDefaultApp")}</button>}
    </header>
    {error ? <div className="editor-state editor-state--stacked" role="alert">
      <strong>{t("editor.database.failure", { reason: error })}</strong>
      <span>{error === "stale-input" ? t("editor.database.expired") : error === "recovery-required" ? t("editor.database.recovery")
        : error === "budget-exceeded" || error === "timeout" ? t("editor.database.budget")
          : error === "permission-denied" ? t("editor.database.permission")
            : ["unrecognized-format", "unsupported-version", "unsupported-object"].includes(error) ? t("editor.database.unsupported") : null}</span><span>{t("editor.database.scope")}</span>
    </div> : info ? <>
      <div className="database-preview-controls">
        <label>{t("editor.database.objects")} <select value={selected} disabled={busy} onChange={(event) => { void read(event.target.value, 0); }}>
          {info.objects.map((object) => <option key={object.id} value={object.id} disabled={!object.readable}>{object.name}{object.readable ? "" : ` (${object.kind})`}</option>)}
        </select></label>
        <button type="button" aria-pressed={tab === "data"} onClick={() => setTab("data")}>{t("editor.database.data")}</button>
        <button type="button" aria-pressed={tab === "schema"} onClick={() => setTab("schema")}>{t("editor.database.schema")}</button>
        {busy && <DocumentSurfacePending label={t("editor.loadingFile")} />}
      </div>
      {page ? <>
        <div className="database-preview-grid" tabIndex={0} role="region" aria-label={t("editor.database.data")}>
          {tab === "schema" ? <table><thead><tr><th>{t("editor.database.field")}</th><th>{t("editor.database.type")}</th></tr></thead>
            <tbody>{page.visibleColumns.map((column) => <tr key={column.id}><td dir="auto">{column.name}</td><td>{column.type}{column.primaryKey ? " · PK" : ""}</td></tr>)}</tbody></table>
            : <table aria-label={t("editor.database.page")}><thead><tr>{page.visibleColumns.map((column) => <th key={column.id} dir="auto" title={column.type}>{column.name}</th>)}</tr></thead>
              <tbody>{page.rows.map((row, index) => <tr key={`${page.snapshotEpoch}:${page.offset + index}`}>{row.map((cell, col) =>
                <td key={page.visibleColumns[col]?.id ?? col} tabIndex={0} dir="auto" data-cell-kind={cell.kind}>
                  {cell.kind === "null" ? <em>{"NULL" /* SQL token; distinct from an empty string. */}</em> : cell.kind === "blob" ? `BLOB · ${cell.bytes ?? 0} B` : cell.kind === "complex" ? t("editor.database.complex") : cell.text}
                  {cell.truncated && <span title={t("editor.database.truncated")}>…</span>}
                </td>)}</tr>)}</tbody></table>}
        </div>
        <footer className="database-preview-controls">
          <span>{t("editor.database.rows", { start: page.rows.length ? page.offset + 1 : 0, end: page.offset + page.rows.length })}</span>
          <button type="button" disabled={busy || page.offset === 0} onClick={() => { void read(selected, columnOffset); }}>{t("editor.database.first")}</button>
          <button type="button" disabled={busy || !page.hasMore} onClick={() => { void read(selected, columnOffset, true); }}>{t("editor.database.next")}</button>
          <button type="button" disabled={busy || columnOffset === 0} onClick={() => { void read(selected, Math.max(0, columnOffset - info.pageColumns)); }}>{t("editor.database.previousColumns")}</button>
          <button type="button" disabled={busy || columnOffset + info.pageColumns >= page.columns.length} onClick={() => { void read(selected, columnOffset + info.pageColumns); }}>{t("editor.database.nextColumns")}</button>
        </footer>
      </> : <div className="editor-state">{t("editor.database.empty")}</div>}
    </> : <DocumentSurfacePending label={t("editor.loadingFile")} />}
  </section>;
}
