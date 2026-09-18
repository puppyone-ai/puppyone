"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import { getPresetViewerDefinition } from "../../registry/presetViewerManifest";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { ResourcePreviewState } from "../media/ResourceViewers";
import { preflightPdfResource } from "./pdfResourcePreflight";

type PdfViewerProps = Pick<PresetViewerRenderContext,
  "document" | "fileUrl" | "fileUrlLoading" | "fileUrlError" | "openExternalFile" | "workspaceId"
> & Partial<Pick<PresetViewerRenderContext, "resourcePolicy">>;

export const PDF_ATTACHMENT_TIMEOUT_MS = 15_000;

export function PdfViewer({ document, fileUrl, fileUrlLoading, fileUrlError, resourcePolicy,
  openExternalFile, workspaceId }: PdfViewerProps) {
  const { t } = useLocalization();
  const [attempt, setAttempt] = useState(0);
  const [externalError, setExternalError] = useState(false);
  const maxBytes = resourcePolicy?.maxSourceBytes ?? getPresetViewerDefinition("pdf-preview").resourcePolicy.maxSourceBytes;
  return (
    <div className="pdf-preview-shell">
      <div className="pdf-preview-actions">
        {fileUrl && !fileUrlLoading && <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t("editor.app.reload")}
        </button>}
        {openExternalFile && <button type="button" onClick={() => {
          setExternalError(false);
          void openExternalFile(document.path).catch(() => setExternalError(true));
        }}>{t("editor.openDefaultApp")}</button>}
      </div>
      {externalError && <div role="alert">{t("editor.preview.unavailable")}</div>}
      <ResourcePreviewState fileUrl={fileUrlLoading ? null : fileUrl} loading={fileUrlLoading} error={fileUrlError} kind="pdf">
        {(url) => <PdfPreviewSurface key={JSON.stringify([workspaceId, document.path, url, maxBytes, attempt])}
          url={url} name={document.name} maxBytes={maxBytes} onRetry={() => setAttempt((value) => value + 1)} />}
      </ResourcePreviewState>
    </div>
  );
}

function PdfPreviewSurface({ url, name, maxBytes, onRetry }: {
  url: string; name: string; maxBytes: number; onRetry: () => void;
}) {
  const { t } = useLocalization();
  const [phase, setPhase] = useState<"checking" | "loading" | "embedded" | "failed">("checking");
  const [reason, setReason] = useState("resource");
  const loadRef = useRef<() => void>(() => {});
  const ready = phase === "embedded";

  useEffect(() => {
    let current = true;
    let frame: number | undefined;
    let loaded = false;
    const controller = new AbortController();
    const fail = (failure: unknown) => {
      if (!current) return;
      setReason(failure instanceof Error && ["limit", "timeout"].includes(failure.message) ? failure.message : "resource");
      setPhase("failed");
      current = false;
      clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      controller.abort();
    };
    const timer = window.setTimeout(() => fail(new Error("timeout")), PDF_ATTACHMENT_TIMEOUT_MS);
    void preflightPdfResource(url, maxBytes, controller.signal).then(() => {
      if (current) setPhase("loading");
    }).catch(fail);
    loadRef.current = () => {
      if (!current || loaded) return;
      loaded = true;
      // A frame's load event also fires for HTTP/protocol error pages. Recheck
      // authority after navigation; never interpret load as PDF parse success.
      void preflightPdfResource(url, maxBytes, controller.signal).then(() => {
        if (!current) return;
        frame = window.requestAnimationFrame(() => {
          if (!current) return;
          clearTimeout(timer);
          setPhase("embedded");
        });
      }).catch(fail);
    };
    return () => {
      current = false;
      loadRef.current = () => {};
      controller.abort();
      clearTimeout(timer);
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [url, maxBytes]);

  if (phase === "failed") return <div className="editor-state danger" role="alert" data-pdf-failure={reason}>
    <span>{reason === "limit" ? t("editor.unavailable.resourceLimit", { limit: `${Math.round(maxBytes / 1024 / 1024)} MiB` }) : reason === "timeout"
      ? t("editor.pdf.timeout") : t("editor.resource.unavailable", { kind: t("editor.resource.kind.pdf") })}</span>
    <button type="button" onClick={onRetry}>{t("common.action.retry")}</button>
  </div>;

  return <div className="pdf-preview-surface" data-preview-state={phase}
    data-pdf-parse-state="unknown" data-document-surface-ready={ready ? "true" : undefined} aria-busy={!ready}>
    {!ready && <DocumentSurfacePending label={t("editor.preview.loading")} />}
    {phase !== "checking" && <iframe className="pdf-preview-frame" name="puppyone-pdf-preview"
      src={configureChromiumPdfViewerUrl(url)} title={name} referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'"
      onLoad={() => loadRef.current()} />}
  </div>;
}

export function configureChromiumPdfViewerUrl(resourceUrl: string): string {
  const separator = resourceUrl.includes("#") ? "&" : "#";
  return `${resourceUrl}${separator}toolbar=0&navpanes=0`;
}
