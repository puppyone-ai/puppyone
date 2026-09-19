import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  Columns3,
  Database,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Rows3,
  Table2,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import { useEditorPreviewServices } from "../../preview-services/EditorPreviewServices";
import type {
  DatabaseColumn,
  DatabaseInfo,
  DatabaseObjectUnavailableReason,
  DatabasePage,
  DatabasePreviewSession,
} from "../../preview-services/types";
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
  const objectTabId = useId();
  const objectTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
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

  const failureDetail = error === "stale-input" ? t("editor.database.expired")
    : error === "recovery-required" ? t("editor.database.recovery")
      : error === "budget-exceeded" || error === "timeout" ? t("editor.database.budget")
        : error === "permission-denied" ? t("editor.database.permission")
          : ["unrecognized-format", "unsupported-version", "unsupported-object"].includes(error ?? "")
            ? t("editor.database.unsupported")
            : t("editor.database.unavailable");
  const hasColumnPages = Boolean(info && page && page.columns.length > info.pageColumns);
  const selectedObjectIndex = info?.objects.findIndex((object) => object.id === selected) ?? -1;
  const moveObjectTabFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number, count: number) => {
    let target = index;
    if (event.key === "ArrowRight") target = (index + 1) % count;
    else if (event.key === "ArrowLeft") target = (index - 1 + count) % count;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = count - 1;
    else return;
    event.preventDefault();
    objectTabRefs.current[target]?.focus();
  };

  return <section className="database-preview" aria-busy={busy} data-document-surface-ready={!busy || info ? "true" : undefined}>
    {error ? <div className="database-preview__failure" role="alert" data-error-code={error}>
      <Database size={22} strokeWidth={1.5} aria-hidden="true" />
      <span>{failureDetail}</span>
      <div className="database-preview__failure-actions">
        <DatabaseIconButton label={t("editor.database.reload")} onClick={() => setAttempt((value) => value + 1)}><RefreshCw /></DatabaseIconButton>
        {openExternalFile && <DatabaseIconButton label={t("editor.openDefaultApp")} onClick={() => { void openExternalFile(document.path).catch(() => setError("host-failed")); }}><ExternalLink /></DatabaseIconButton>}
      </div>
    </div> : info ? <>
      <header className="database-preview__toolbar">
        <span className="database-preview__engine" title={`${info.engine === "sqlite" ? "SQLite" : "DuckDB"} ${info.engineVersion} · ${t("editor.database.readonly")}`}>
          <Database size={15} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="database-preview__object-tabs" role="tablist" aria-label={t("editor.database.objects")} data-po-scrollbar="content">
          {info.objects.map((object, index) => {
            const unavailable = object.readable ? null : t(databaseObjectUnavailableMessage(object.unavailableReason));
            const inaccessible = busy || !object.readable;
            const label = unavailable ? `${object.name} · ${unavailable}` : object.name;
            return <button
              className="database-preview__object-tab"
              type="button"
              role="tab"
              id={`${objectTabId}-${index}`}
              aria-controls={`${objectTabId}-panel`}
              aria-disabled={inaccessible || undefined}
              aria-label={label}
              aria-selected={selected === object.id}
              key={object.id}
              ref={(node) => { objectTabRefs.current[index] = node; }}
              tabIndex={selected === object.id ? 0 : -1}
              title={label}
              onClick={() => { if (!inaccessible) void read(object.id, 0); }}
              onKeyDown={(event) => moveObjectTabFocus(event, index, info.objects.length)}
            ><Table2 size={13} strokeWidth={1.8} aria-hidden="true" /><span dir="auto">{object.name}</span></button>;
          })}
        </div>
        <nav className="database-preview__actions" aria-label={t("editor.database.title")}>
          {busy && <span className="database-preview__busy" aria-hidden="true"><LoaderCircle /></span>}
          <DatabaseIconButton label={t("editor.database.data")} active={tab === "data"} onClick={() => setTab("data")}><Rows3 /></DatabaseIconButton>
          <DatabaseIconButton label={t("editor.database.schema")} active={tab === "schema"} onClick={() => setTab("schema")}><Columns3 /></DatabaseIconButton>
          <span className="database-preview__separator" aria-hidden="true" />
          <DatabaseIconButton label={t("editor.database.reload")} onClick={() => setAttempt((value) => value + 1)}><RefreshCw /></DatabaseIconButton>
          {openExternalFile && <DatabaseIconButton label={t("editor.openDefaultApp")} onClick={() => { void openExternalFile(document.path).catch(() => setError("host-failed")); }}><ExternalLink /></DatabaseIconButton>}
        </nav>
      </header>
      {page ? <>
        <div className="database-preview__scroll" id={`${objectTabId}-panel`} tabIndex={0} role="tabpanel"
          aria-labelledby={selectedObjectIndex >= 0 ? `${objectTabId}-${selectedObjectIndex}` : undefined}
          aria-label={selectedObjectIndex < 0 ? (tab === "data" ? t("editor.database.data") : t("editor.database.schema")) : undefined}
          data-po-scrollbar="content">
          <div className="database-preview__frame">
            {tab === "schema" ? <table className="database-preview__table database-preview__table--schema"><thead><tr><th>{t("editor.database.field")}</th><th>{t("editor.database.type")}</th></tr></thead>
              <tbody>{page.visibleColumns.map((column) => <tr key={column.id}><td dir="auto">{column.name}</td><td><span className="database-preview__type">{column.type}</span>{column.primaryKey && <span className="database-preview__key">{"PK" /* Stable database schema token. */}</span>}</td></tr>)}</tbody></table>
              : <table className="database-preview__table" aria-label={t("editor.database.page")}><thead><tr><th className="database-preview__record-index" aria-hidden="true" />{page.visibleColumns.map((column) => <th key={column.id} dir="auto" title={column.type} scope="col">{column.name}</th>)}</tr></thead>
                <tbody>{page.rows.map((row, index) => <tr key={`${page.snapshotEpoch}:${page.offset + index}`}><th className="database-preview__record-index" scope="row">{page.offset + index + 1}</th>{row.map((cell, col) =>
                  <td key={page.visibleColumns[col]?.id ?? col} tabIndex={0} dir="auto" data-cell-kind={cell.kind}>
                    {cell.kind === "null" ? <em>{"NULL" /* SQL token; distinct from an empty string. */}</em> : cell.kind === "blob" ? `BLOB · ${cell.bytes ?? 0} B` : cell.kind === "complex" ? t("editor.database.complex") : cell.text}
                    {cell.truncated && <span title={t("editor.database.truncated")}>…</span>}
                  </td>)}</tr>)}</tbody></table>}
          </div>
        </div>
        <footer className="database-preview__pager">
          <span className="database-preview__range">{page.rows.length ? `${page.offset + 1}–${page.offset + page.rows.length}` : "0"}</span>
          <DatabaseIconButton label={t("editor.database.first")} disabled={busy || page.offset === 0} onClick={() => { void read(selected, columnOffset); }}><ChevronsLeft /></DatabaseIconButton>
          <DatabaseIconButton label={t("editor.database.next")} disabled={busy || !page.hasMore} onClick={() => { void read(selected, columnOffset, true); }}><ChevronRight /></DatabaseIconButton>
          {hasColumnPages && <><span className="database-preview__separator" aria-hidden="true" /><Columns3 className="database-preview__pager-glyph" aria-hidden="true" />
            <DatabaseIconButton label={t("editor.database.previousColumns")} disabled={busy || columnOffset === 0} onClick={() => { void read(selected, Math.max(0, columnOffset - info.pageColumns)); }}><ChevronLeft /></DatabaseIconButton>
            <DatabaseIconButton label={t("editor.database.nextColumns")} disabled={busy || columnOffset + info.pageColumns >= page.columns.length} onClick={() => { void read(selected, columnOffset + info.pageColumns); }}><ChevronRight /></DatabaseIconButton></>}
        </footer>
      </> : <div className="database-preview__empty"><Table2 size={20} strokeWidth={1.5} aria-hidden="true" /><span>{t("editor.database.empty")}</span></div>}
    </> : <DocumentSurfacePending label={t("editor.loadingFile")} />}
  </section>;
}

function databaseObjectUnavailableMessage(reason?: DatabaseObjectUnavailableReason) {
  if (reason === "too-many-columns") return "editor.database.objectUnavailableColumns" as const;
  if (reason === "generated-or-hidden-columns") return "editor.database.objectUnavailableGenerated" as const;
  return "editor.database.objectUnavailableKind" as const;
}

function DatabaseIconButton({ active = false, children, disabled = false, label, onClick }: {
  active?: boolean;
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return <button
    className="database-preview__icon-button"
    type="button"
    aria-label={label}
    aria-pressed={active || undefined}
    title={label}
    disabled={disabled}
    onClick={onClick}
  >{children}</button>;
}
