"use client";

import { useState, type ReactNode } from "react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { FilePreviewIcon } from "../../../file/fileIcons";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";

export type ResourceViewerProps = Pick<
  PresetViewerRenderContext,
  | "document"
  | "fileUrl"
  | "fileUrlLoading"
  | "fileUrlError"
  | "onRetryInput"
  | "fileIconTheme"
>;

export function ImageResourceViewer({ document, fileUrl, fileUrlLoading, fileUrlError, onRetryInput }: ResourceViewerProps) {
  return (
    <ResourcePreviewState fileUrl={fileUrl} loading={fileUrlLoading} error={fileUrlError} kind="image">
      {(url) => (
        <ImagePreviewSurface url={url} name={document.name} onRetry={onRetryInput} />
      )}
    </ResourcePreviewState>
  );
}

function ImagePreviewSurface({ url, name, onRetry }: { url: string; name: string; onRetry?: () => void }) {
  const { t } = useLocalization();
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ready = readyUrl === url;
  const failed = failedUrl === url;

  if (failed) {
    return (
      <div className="editor-state editor-state--stacked danger" role="alert">
        {t("editor.resource.unavailable", { kind: t("editor.resource.kind.image") })}
        <ResourceRetry onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div
      className="native-preview native-preview-centered native-image-preview-shell"
      data-po-scrollbar="content"
      data-preview-state={ready ? "ready" : "loading"}
      aria-busy={!ready}
    >
      {!ready && <DocumentSurfacePending label={t("editor.preview.loading")} />}
      <img
        key={url}
        className="native-image-preview"
        src={url}
        alt={name}
        decoding="async"
        hidden={!ready}
        aria-hidden={!ready}
        onLoad={(event) => {
          const image = event.currentTarget;
          const markReady = () => setReadyUrl(url);
          if (typeof image.decode !== "function") {
            markReady();
            return;
          }
          void image.decode().catch(() => undefined).then(markReady);
        }}
        onError={() => setFailedUrl(url)}
      />
    </div>
  );
}

export function AudioResourceViewer({ document, fileUrl, fileUrlLoading, fileUrlError, fileIconTheme, onRetryInput }: ResourceViewerProps) {
  return (
    <ResourcePreviewState fileUrl={fileUrl} loading={fileUrlLoading} error={fileUrlError} kind="audio">
      {(url) => (
        <AudioPreviewSurface
          url={url}
          name={document.name}
          fileIconTheme={fileIconTheme}
          onRetry={onRetryInput}
        />
      )}
    </ResourcePreviewState>
  );
}

export function VideoResourceViewer({ document, fileUrl, fileUrlLoading, fileUrlError, onRetryInput }: ResourceViewerProps) {
  return (
    <ResourcePreviewState fileUrl={fileUrl} loading={fileUrlLoading} error={fileUrlError} kind="video">
      {(url) => (
        <VideoPreviewSurface url={url} onRetry={onRetryInput} />
      )}
    </ResourcePreviewState>
  );
}

function AudioPreviewSurface({
  url,
  name,
  fileIconTheme,
  onRetry,
}: {
  url: string;
  name: string;
  fileIconTheme: ResourceViewerProps["fileIconTheme"];
  onRetry?: () => void;
}) {
  const { t } = useLocalization();
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ready = readyUrl === url;
  if (failedUrl === url) {
    return (
      <div className="editor-state editor-state--stacked danger" role="alert">
        {t("editor.resource.unavailable", { kind: t("editor.resource.kind.audio") })}
        <ResourceRetry onRetry={onRetry} />
      </div>
    );
  }
  return (
    <div
      className="native-preview native-preview-centered"
      data-po-scrollbar="content"
      aria-busy={!ready}
    >
      <div className="native-media-card">
        <FilePreviewIcon name={name} type="audio" size={54} theme={fileIconTheme} />
        <strong dir="auto">{name}</strong>
        <audio
          key={url}
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={() => setReadyUrl(url)}
          onError={() => setFailedUrl(url)}
        >
          <UnsupportedMedia kind="audio" />
        </audio>
      </div>
    </div>
  );
}

function VideoPreviewSurface({ url, onRetry }: { url: string; onRetry?: () => void }) {
  const { t } = useLocalization();
  const [readyUrl, setReadyUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const ready = readyUrl === url;
  if (failedUrl === url) {
    return (
      <div className="editor-state editor-state--stacked danger" role="alert">
        {t("editor.resource.unavailable", { kind: t("editor.resource.kind.video") })}
        <ResourceRetry onRetry={onRetry} />
      </div>
    );
  }
  return (
    <div
      className="native-preview native-preview-centered"
      data-po-scrollbar="content"
      aria-busy={!ready}
    >
      <video
        key={url}
        src={url}
        className="native-video-preview"
        controls
        preload="auto"
        onLoadedData={(event) => markVideoFrameReady(event.currentTarget, () => setReadyUrl(url))}
        onError={() => setFailedUrl(url)}
      >
        <UnsupportedMedia kind="video" />
      </video>
    </div>
  );
}

function markVideoFrameReady(video: HTMLVideoElement, onReady: () => void) {
  if (typeof video.requestVideoFrameCallback === "function") {
    video.requestVideoFrameCallback(() => onReady());
    return;
  }
  window.requestAnimationFrame(onReady);
}

export function ResourcePreviewState({
  fileUrl,
  loading,
  error,
  kind,
  children,
}: {
  fileUrl?: string | null;
  loading: boolean;
  error?: string | null;
  kind: "image" | "pdf" | "audio" | "video";
  children: (fileUrl: string) => ReactNode;
}) {
  const { t } = useLocalization();
  if (error) {
    return (
      <div className="editor-state danger">
        {t("editor.resource.loadFailed", {
          kind: t(`editor.resource.kind.${kind}`),
          detail: bidiIsolate(error),
        })}
      </div>
    );
  }
  if (loading && !fileUrl) return <DocumentSurfacePending label={t("editor.preview.loading")} />;
  if (!fileUrl) {
    return (
      <div className="editor-state">
        {t("editor.resource.unavailable", { kind: t(`editor.resource.kind.${kind}`) })}
      </div>
    );
  }
  return <>{children(fileUrl)}</>;
}

function UnsupportedMedia({ kind }: { kind: "audio" | "video" }) {
  const { t } = useLocalization();
  return <>{t(`editor.resource.unsupported.${kind}`)}</>;
}

function ResourceRetry({ onRetry }: { onRetry?: () => void }) {
  const { t } = useLocalization();
  return onRetry ? <button type="button" onClick={onRetry}>{t("common.action.retry")}</button> : null;
}
