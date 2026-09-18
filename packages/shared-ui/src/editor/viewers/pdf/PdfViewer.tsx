"use client";

import { useEffect, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { ResourcePreviewState } from "../media/ResourceViewers";

type PdfViewerProps = Pick<
  PresetViewerRenderContext,
  "document" | "fileUrl" | "fileUrlLoading" | "fileUrlError"
>;

export function PdfViewer({ document, fileUrl, fileUrlLoading, fileUrlError }: PdfViewerProps) {
  return (
    <ResourcePreviewState
      fileUrl={fileUrl}
      loading={fileUrlLoading}
      error={fileUrlError}
      kind="pdf"
    >
      {(url) => <PdfPreviewSurface url={url} name={document.name} />}
    </ResourcePreviewState>
  );
}

function PdfPreviewSurface({ url, name }: { url: string; name: string }) {
  const { t } = useLocalization();
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const activeUrlRef = useRef(url);
  activeUrlRef.current = url;
  const ready = readyUrl === url;
  const failed = failedUrl === url;

  useEffect(() => () => {
    if (pendingFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingFrameRef.current);
      pendingFrameRef.current = null;
    }
  }, [url]);

  if (failed) {
    return (
      <div className="editor-state danger" role="alert">
        {t("editor.resource.unavailable", { kind: t("editor.resource.kind.pdf") })}
      </div>
    );
  }

  return (
    <div
      className="pdf-preview-shell"
      data-preview-state={ready ? "ready" : "loading"}
      data-document-surface-ready={ready ? "true" : undefined}
      aria-busy={!ready}
    >
      {!ready && <DocumentSurfacePending label={t("editor.preview.loading")} />}
      <iframe
        key={url}
        className="pdf-preview-frame"
        src={configureChromiumPdfViewerUrl(url)}
        title={name}
        referrerPolicy="no-referrer"
        onLoad={() => {
          if (activeUrlRef.current !== url) return;
          if (pendingFrameRef.current !== null) {
            window.cancelAnimationFrame(pendingFrameRef.current);
          }
          pendingFrameRef.current = window.requestAnimationFrame(() => {
            pendingFrameRef.current = null;
            if (activeUrlRef.current === url) setReadyUrl(url);
          });
        }}
        onError={() => {
          if (activeUrlRef.current === url) setFailedUrl(url);
        }}
      />
    </div>
  );
}

export function configureChromiumPdfViewerUrl(resourceUrl: string): string {
  const separator = resourceUrl.includes("#") ? "&" : "#";
  return `${resourceUrl}${separator}toolbar=0&navpanes=0`;
}
