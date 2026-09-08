"use client";

import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minus,
  PencilLine,
  Plus,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type { PptxViewer, SlideHandle } from "@aiden0z/pptx-renderer";
import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import { DocumentSurfacePending } from "../../host/DocumentSurfaceHost";
import { validateOfficePackageInWorker } from "../../security/officePackageValidationClient";
import {
  preflightOoxmlPackage,
  preflightZipCentralDirectory,
  ZipPreflightError,
} from "../../security/zipCentralDirectoryPreflight";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import {
  fetchOfficeArrayBuffer,
  OfficeResourceLimitError,
} from "./officeResourceLoader";
import { extractOfficeTextFallbackInWorker } from "./officeTextFallbackClient";
import {
  applyOfficeCjkFontFallbacks,
  ensureOfficeFontCompatibilityStyles,
} from "./officeFontCompatibility";
import {
  createPresentationWheelGestureState,
  getPresentationFitZoomPercent,
  getPresentationNavigationTarget,
  reducePresentationWheelGesture,
  settlePresentationFonts,
  type PresentationWheelGestureState,
} from "./presentationPreview";
import {
  findSpreadsheetCellPosition,
  getSpreadsheetArchiveKind,
  getSpreadsheetNavigationTarget,
  getSpreadsheetRenderRows,
  getSpreadsheetRowOffsets,
  getSpreadsheetVisibleRowWindow,
  type SpreadsheetCellBorder,
  type SpreadsheetCellPosition,
  type SpreadsheetCellStyle,
  type SpreadsheetPreviewResult,
  type SpreadsheetSheet,
} from "./spreadsheetPreview";
import { parseSpreadsheetInWorker } from "./spreadsheetPreviewClient";
import { WordDocumentPreview } from "./word/WordDocumentPreview";
import {
  stepWordPreviewScale,
  type WordPreviewZoom,
} from "./word/wordPreviewLayout";

type OfficeState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: OfficePreviewResult };

type OfficePreviewResult =
  | { kind: "word"; arrayBuffer: ArrayBuffer }
  | SpreadsheetPreviewResult
  | { kind: "presentation"; arrayBuffer: ArrayBuffer }
  | { kind: "presentationText"; slides: PresentationSlide[]; truncatedSlideCount: number }
  | { kind: "opendocument"; title: string; lines: string[]; truncatedLines: boolean }
  | OfficeUnsupportedResult;

type OfficeUnsupportedCode =
  | "conversion-failed"
  | "legacy-presentation"
  | "resource-unavailable"
  | "resource-rejected"
  | "unsafe-package"
  | "unsupported-format"
  | "legacy-word"
  | "rich-text-converter";

type OfficePackageSubject =
  | "converted-word"
  | "word"
  | "spreadsheet"
  | "presentation"
  | "opendocument"
  | "office";

type OfficeUnsupportedResult = {
  kind: "unsupported";
  code: OfficeUnsupportedCode;
  detail?: string | null;
  extension?: string;
  subject?: OfficePackageSubject;
};

type PresentationSlide = {
  index: number;
  title: string | null;
  lines: string[];
};

const SPREADSHEET_COLUMN_HEADER_HEIGHT = 32;
const SPREADSHEET_ROW_HEADER_WIDTH = 44;
const SPREADSHEET_OVERSCAN_ROWS = 12;
const LEGACY_WORD_EXTENSIONS = new Set(["doc"]);
const LEGACY_PRESENTATION_EXTENSIONS = new Set(["ppt", "pps"]);
const NATIVE_DOCX_CONVERTIBLE_EXTENSIONS = new Set(["doc", "rtf"]);
const OOXML_PACKAGE_EXTENSIONS = new Set(["docx", "xlsx", "xlsb", "xlsm", "pptx", "ppsx"]);
const OPEN_DOCUMENT_PACKAGE_EXTENSIONS = new Set(["odt", "ods", "odp", "ott", "ots", "otp"]);
const DOCX_DECOMPRESSION_BUDGET = {
  maxEntryUncompressedBytes: 32 * 1024 * 1024,
  maxTotalUncompressedBytes: 128 * 1024 * 1024,
  maxDocxXmlStartTags: 150_000,
} as const;
const PRESENTATION_DECOMPRESSION_BUDGET = {
  maxEntryUncompressedBytes: 64 * 1024 * 1024,
  maxTotalUncompressedBytes: 192 * 1024 * 1024,
} as const;
const OPEN_DOCUMENT_DECOMPRESSION_BUDGET = {
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
} as const;

type OfficeViewerProps = Pick<
  PresetViewerRenderContext,
  | "document"
  | "resolvedExtension"
  | "resourcePolicy"
  | "fileUrl"
  | "fileUrlLoading"
  | "fileUrlError"
  | "openExternalFile"
  | "convertOfficeDocumentToDocx"
  | "markdownEnvironment"
  | "officeEditorActions"
>;

export function OfficeViewer({
  document,
  resolvedExtension,
  resourcePolicy,
  fileUrl,
  fileUrlLoading,
  fileUrlError,
  openExternalFile,
  convertOfficeDocumentToDocx,
  markdownEnvironment,
  officeEditorActions = [],
}: OfficeViewerProps) {
  const { t } = useLocalization();
  const [state, setState] = useState<OfficeState>({ status: "idle" });
  const [activeSheet, setActiveSheet] = useState(0);
  const [wordZoom, setWordZoom] = useState<WordPreviewZoom>("fit");
  const [wordResolvedScale, setWordResolvedScale] = useState(1);
  const extension = resolvedExtension ?? getExtension(document.name);
  const canUseNativeDocxConversion = Boolean(
    convertOfficeDocumentToDocx && NATIVE_DOCX_CONVERTIBLE_EXTENSIONS.has(extension),
  );
  const surfaceKind = getOfficePreviewSurfaceKind(extension);
  const previewResourceUrl = canUseNativeDocxConversion ? null : fileUrl;
  const previewResourceLoading = canUseNativeDocxConversion ? false : fileUrlLoading;

  useEffect(() => {
    setActiveSheet(0);
    setWordZoom("fit");
    setWordResolvedScale(1);
  }, [document.path]);

  useEffect(() => {
    if (!previewResourceUrl && !canUseNativeDocxConversion) {
      setState(previewResourceLoading ? { status: "loading" } : { status: "idle" });
      return undefined;
    }

    let cancelled = false;
    const abortController = new AbortController();

    setState({ status: "loading" });
    loadOfficePreview({
      fileUrl: previewResourceUrl,
      filename: document.name,
      extension,
      path: document.path,
      maxSourceBytes: resourcePolicy.maxSourceBytes,
      convertOfficeDocumentToDocx,
      signal: abortController.signal,
    })
      .then((result) => {
        if (!cancelled) setState({ status: "ready", result });
      })
      .catch((error) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    canUseNativeDocxConversion,
    convertOfficeDocumentToDocx,
    document.name,
    document.path,
    extension,
    fileUrl,
    resourcePolicy.maxSourceBytes,
    previewResourceLoading,
    previewResourceUrl,
  ]);

  let previewBody: ReactNode;
  if (fileUrlError && !canUseNativeDocxConversion) {
    previewBody = (
      <OfficeEmptyState
        title={t("editor.office.loadFailed")}
        message={fileUrlError}
        documentPath={document.path}
        openExternalFile={openExternalFile}
      />
    );
  } else if (
    (previewResourceLoading || state.status === "loading")
    && !previewResourceUrl
    && !canUseNativeDocxConversion
  ) {
    previewBody = <DocumentSurfacePending label={t("editor.preview.loading")} />;
  } else if (!previewResourceUrl && !canUseNativeDocxConversion && state.status !== "ready") {
    previewBody = (
      <OfficeEmptyState
        title={t("editor.preview.unavailable")}
        message={t("editor.office.resourceUnavailable")}
        documentPath={document.path}
        openExternalFile={openExternalFile}
      />
    );
  } else {
    previewBody = (
      <>
        {state.status === "error" && (
          <OfficeEmptyState
            title={t("editor.preview.failed")}
            message={state.message}
            documentPath={document.path}
            openExternalFile={openExternalFile}
          />
        )}
        {state.status === "idle" || state.status === "loading" ? (
          <DocumentSurfacePending label={t("editor.preview.loading")} />
        ) : null}
        {state.status === "ready" && (
          <OfficePreviewContent
            documentPath={document.path}
            result={state.result}
            activeSheet={activeSheet}
            onActiveSheetChange={setActiveSheet}
            openExternalFile={openExternalFile}
            openExternalUrl={markdownEnvironment?.linkCommands.openExternalUrl}
            wordZoom={wordZoom}
            onWordResolvedScaleChange={setWordResolvedScale}
          />
        )}
      </>
    );
  }

  return (
    <div
      className="office-preview"
      data-office-kind={surfaceKind}
      aria-busy={Boolean(
        !fileUrlError
        && (
          state.status === "loading"
          || (
            state.status === "idle"
            && (previewResourceLoading || Boolean(previewResourceUrl) || canUseNativeDocxConversion)
          )
        )
      )}
    >
      <div className="office-preview__body">
        {previewBody}
        <OfficePreviewControls
          officeEditorActions={officeEditorActions}
          wordZoomControls={state.status === "ready" && state.result.kind === "word" ? {
            scale: wordResolvedScale,
            isFit: wordZoom === "fit",
            onDecrease: () => setWordZoom(stepWordPreviewScale(wordResolvedScale, -1)),
            onIncrease: () => setWordZoom(stepWordPreviewScale(wordResolvedScale, 1)),
            onFit: () => setWordZoom("fit"),
          } : null}
        />
      </div>
    </div>
  );
}

function OfficePreviewControls({
  officeEditorActions,
  wordZoomControls,
}: {
  officeEditorActions: NonNullable<OfficeViewerProps["officeEditorActions"]>;
  wordZoomControls: {
    scale: number;
    isFit: boolean;
    onDecrease: () => void;
    onIncrease: () => void;
    onFit: () => void;
  } | null;
}) {
  const { t } = useLocalization();
  const [editorActionError, setEditorActionError] = useState<string | null>(null);
  const activateEditorAction = (
    action: NonNullable<OfficeViewerProps["officeEditorActions"]>[number],
  ) => {
    setEditorActionError(null);
    void Promise.resolve().then(() => action.activate()).catch((error) => {
      setEditorActionError(error instanceof Error ? error.message : String(error));
    });
  };

  if (!wordZoomControls && officeEditorActions.length === 0 && !editorActionError) return null;

  return (
    <div className="office-preview__floating-region">
      {editorActionError && (
        <span className="office-preview__floating-error" role="alert" dir="auto">
          {editorActionError}
        </span>
      )}
      <div className="office-preview__floating-controls">
        {wordZoomControls && (
          <div
            className="office-preview__zoom-controls"
            role="group"
            aria-label={t("editor.office.wordZoom")}
          >
            <button
              type="button"
              className="office-preview__toolbar-button"
              aria-label={t("editor.office.zoomOut")}
              title={t("editor.office.zoomOut")}
              disabled={wordZoomControls.scale <= 0.5}
              onClick={wordZoomControls.onDecrease}
            >
              <Minus size={14} strokeWidth={2} />
            </button>
            <output className="office-preview__zoom-value" aria-live="polite">
              {Math.round(wordZoomControls.scale * 100)}%
            </output>
            <button
              type="button"
              className="office-preview__toolbar-button"
              aria-label={t("editor.office.zoomIn")}
              title={t("editor.office.zoomIn")}
              disabled={wordZoomControls.scale >= 2}
              onClick={wordZoomControls.onIncrease}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button
              type="button"
              className="office-preview__toolbar-button"
              aria-label={t("editor.office.fitWidth")}
              title={t("editor.office.fitWidth")}
              aria-pressed={wordZoomControls.isFit}
              data-active={wordZoomControls.isFit ? "true" : undefined}
              onClick={wordZoomControls.onFit}
            >
              <Maximize2 size={13} strokeWidth={2} />
            </button>
          </div>
        )}
        {officeEditorActions.map((action) => (
          <button
            type="button"
            className="office-preview__editor-action"
            key={action.id}
            onClick={() => activateEditorAction(action)}
          >
            <PencilLine size={13} strokeWidth={2} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function OfficePreviewContent({
  documentPath,
  result,
  activeSheet,
  onActiveSheetChange,
  openExternalFile,
  openExternalUrl,
  wordZoom,
  onWordResolvedScaleChange,
}: {
  documentPath: string;
  result: OfficePreviewResult;
  activeSheet: number;
  onActiveSheetChange: (index: number) => void;
  openExternalFile?: (path: string) => Promise<void>;
  openExternalUrl?: (href: string) => void | Promise<void>;
  wordZoom: WordPreviewZoom;
  onWordResolvedScaleChange: (scale: number) => void;
}) {
  const { t } = useLocalization();
  if (result.kind === "unsupported") {
    return (
      <OfficeEmptyState
        title={t("editor.preview.unavailable")}
        message={formatOfficeUnsupported(result, t)}
        documentPath={documentPath}
        openExternalFile={openExternalFile}
      />
    );
  }

  if (result.kind === "word") {
    return (
      <WordDocumentPreview
        arrayBuffer={result.arrayBuffer}
        documentPath={documentPath}
        openExternalFile={openExternalFile}
        openExternalUrl={openExternalUrl}
        zoom={wordZoom}
        onResolvedScaleChange={onWordResolvedScaleChange}
      />
    );
  }

  if (result.kind === "spreadsheet") {
    return (
      <SpreadsheetPreview
        result={result}
        activeSheet={activeSheet}
        onActiveSheetChange={onActiveSheetChange}
      />
    );
  }

  if (result.kind === "presentation") {
    return (
      <PptxPresentationPreview
        arrayBuffer={result.arrayBuffer}
        documentPath={documentPath}
        openExternalFile={openExternalFile}
      />
    );
  }

  if (result.kind === "presentationText") {
    return (
      <PresentationTextPreview
        slides={result.slides}
        truncatedSlideCount={result.truncatedSlideCount}
      />
    );
  }

  return (
    <div className="office-document-preview" data-po-scrollbar="content">
      <article className="office-document-page">
        <h1 dir="auto">{result.title}</h1>
        {result.lines.length > 0 ? (
          result.lines.map((line, index) => <p dir="auto" key={`${line}-${index}`}>{line}</p>)
        ) : (
          <p>{t("editor.office.noReadableText")}</p>
        )}
        {result.truncatedLines && (
          <div className="office-preview__note">{t("editor.office.firstExtractedLines", { count: 400 })}</div>
        )}
      </article>
    </div>
  );
}

function PresentationTextPreview({
  slides,
  truncatedSlideCount = 0,
}: {
  slides: PresentationSlide[];
  truncatedSlideCount?: number;
}) {
  const { formatNumber, t } = useLocalization();
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    setActiveSlide(0);
  }, [slides]);

  const handleStageWheel = usePresentationWheelNavigation({
    activeSlide,
    slideCount: slides.length,
    onSelect: setActiveSlide,
    resetKey: slides,
  });

  if (slides.length === 0) {
    return (
      <OfficeEmptyState
        title={t("editor.office.emptyPresentation")}
        message={t("editor.office.noSlideText")}
      />
    );
  }

  const selectedSlide = slides[Math.min(activeSlide, slides.length - 1)];

  return (
    <div className="office-presentation-preview office-presentation-preview--text">
      {truncatedSlideCount > 0 && (
        <div className="office-preview__note">
          {t("editor.office.omittedSlidesSafety", { count: truncatedSlideCount })}
        </div>
      )}
      <div className="office-pptx-workspace">
        <aside
          className="office-pptx-thumbnail-rail office-pptx-thumbnail-rail--text"
          data-po-scrollbar="content"
          role="tablist"
          aria-label={t("editor.office.slides")}
        >
          {slides.map((slide, index) => (
            <button
              type="button"
              role="tab"
              aria-selected={index === activeSlide}
              aria-label={t("editor.office.slideNumber", { number: slide.index })}
              className="office-pptx-text-thumbnail"
              key={slide.index}
              onClick={() => setActiveSlide(index)}
            >
              <span>{formatNumber(slide.index)}</span>
              <strong dir="auto">
                {slide.title ?? t("editor.office.slideNumber", { number: slide.index })}
              </strong>
            </button>
          ))}
        </aside>
        <div
          className="office-pptx-stage"
          role="group"
          tabIndex={0}
          aria-label={t("editor.office.slides")}
          onWheelCapture={handleStageWheel}
          onKeyDown={(event) => handlePresentationNavigationKeyDown(
            event,
            activeSlide,
            slides.length,
            setActiveSlide,
          )}
        >
          <article className="office-pptx-text-slide">
            <h2 dir="auto">
              {selectedSlide.title ?? t("editor.office.slideNumber", { number: selectedSlide.index })}
            </h2>
            {selectedSlide.lines.length > 0 ? (
              <ul>
                {selectedSlide.lines.map((line, index) => (
                  <li dir="auto" key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            ) : (
              <p>{t("editor.office.noSlideReadableText")}</p>
            )}
          </article>
          <PresentationNavigation
            activeSlide={activeSlide}
            slideCount={slides.length}
            onSelect={setActiveSlide}
          />
        </div>
      </div>
    </div>
  );
}

function PptxPresentationPreview({
  arrayBuffer,
  documentPath,
  openExternalFile,
}: {
  arrayBuffer: ArrayBuffer;
  documentPath: string;
  openExternalFile?: (path: string) => Promise<void>;
}) {
  const { t } = useLocalization();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRailRef = useRef<HTMLElement | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [renderState, setRenderState] = useState<
    | { status: "loading" | "ready" }
    | {
      status: "fallback";
      detail: string;
      slides: PresentationSlide[];
      truncatedSlideCount: number;
    }
    | { status: "error"; renderDetail: string; fallbackDetail: string }
  >({ status: "loading" });
  const [viewerState, setViewerState] = useState<{
    viewer: PptxViewer;
    slideCount: number;
  } | null>(null);
  const [slideErrors, setSlideErrors] = useState<Record<number, string>>({});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const abortController = new AbortController();
    let cancelled = false;
    let viewer: PptxViewer | null = null;
    let fitFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let windowResizeListener: (() => void) | null = null;

    const fitViewerToHost = (targetViewer: PptxViewer) => {
      const zoomPercent = getPresentationFitZoomPercent({
        availableWidth: host.clientWidth,
        availableHeight: host.clientHeight,
        slideWidth: targetViewer.slideWidth,
        slideHeight: targetViewer.slideHeight,
      });
      return zoomPercent === null ? Promise.resolve() : targetViewer.setZoom(zoomPercent);
    };

    const scheduleFit = () => {
      cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        const currentViewer = viewer;
        if (cancelled || !currentViewer) return;
        void fitViewerToHost(currentViewer).catch((error) => {
          if (cancelled) return;
          setSlideErrors((current) => ({
            ...current,
            [currentViewer.currentSlideIndex]: error instanceof Error ? error.message : String(error),
          }));
        });
      });
    };

    ensureOfficeFontCompatibilityStyles(document);
    host.replaceChildren();
    setActiveSlide(0);
    setRenderState({ status: "loading" });
    setViewerState(null);
    setSlideErrors({});

    import("@aiden0z/pptx-renderer")
      .then(({ PptxViewer, RECOMMENDED_ZIP_LIMITS }) => PptxViewer.open(arrayBuffer.slice(0), host, {
        fitMode: "none",
        lazyMedia: true,
        lazySlides: true,
        pdfjs: false,
        renderMode: "slide",
        signal: abortController.signal,
        zipLimits: RECOMMENDED_ZIP_LIMITS,
        onSlideChange: (index) => {
          if (!cancelled) setActiveSlide(index);
        },
        onSlideRendered: (index, element) => {
          if (cancelled) return;
          applyOfficeCjkFontFallbacks(element);
          setSlideErrors((current) => {
            if (!(index in current)) return current;
            const next = { ...current };
            delete next[index];
            return next;
          });
        },
        onSlideError: (index, error) => {
          if (!cancelled) {
            setSlideErrors((current) => ({
              ...current,
              [index]: error instanceof Error ? error.message : String(error),
            }));
          }
        },
      }))
      .then(async (nextViewer) => {
        if (cancelled) {
          nextViewer.destroy();
          return;
        }
        viewer = nextViewer;
        await settlePresentationFonts(document.fonts?.ready, abortController.signal);
        abortController.signal.throwIfAborted();
        await fitViewerToHost(nextViewer);
        applyOfficeCjkFontFallbacks(host);
        if (typeof ResizeObserver === "undefined") {
          windowResizeListener = scheduleFit;
          window.addEventListener("resize", windowResizeListener);
        } else {
          resizeObserver = new ResizeObserver(scheduleFit);
          resizeObserver.observe(host);
        }
        setActiveSlide(nextViewer.currentSlideIndex);
        setViewerState({ viewer: nextViewer, slideCount: nextViewer.slideCount });
        setRenderState({ status: "ready" });
      })
      .catch(async (error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        try {
          const fallback = await parsePresentationText(arrayBuffer.slice(0), abortController.signal);
          if (!cancelled && fallback.kind === "presentationText") {
            setRenderState({
              status: "fallback",
              detail: message,
              slides: fallback.slides,
              truncatedSlideCount: fallback.truncatedSlideCount,
            });
          }
        } catch (fallbackError) {
          if (!cancelled) {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            setRenderState({
              status: "error",
              renderDetail: message,
              fallbackDetail: fallbackMessage,
            });
          }
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
      cancelAnimationFrame(fitFrame);
      resizeObserver?.disconnect();
      if (windowResizeListener) window.removeEventListener("resize", windowResizeListener);
      viewer?.destroy();
      host.replaceChildren();
    };
  }, [arrayBuffer]);

  useEffect(() => {
    if (!thumbnailRailRef.current) return;
    const activeButton = thumbnailRailRef.current.querySelector<HTMLElement>(
      `[data-slide-index="${activeSlide}"]`,
    );
    activeButton?.scrollIntoView({ block: "nearest" });
  }, [activeSlide]);

  const navigateToSlide = (index: number) => {
    if (!viewerState) return;
    void viewerState.viewer.goToSlide(index).catch((error) => {
      setSlideErrors((current) => ({
        ...current,
        [index]: error instanceof Error ? error.message : String(error),
      }));
    });
  };

  const handleStageWheel = usePresentationWheelNavigation({
    activeSlide,
    slideCount: viewerState?.slideCount ?? 0,
    onSelect: navigateToSlide,
    resetKey: arrayBuffer,
  });

  if (renderState.status === "fallback") {
    return (
      <div className="office-pptx-render-preview">
        <div className="office-preview__note">
          {t("editor.office.pptxFallback", { detail: bidiIsolate(renderState.detail) })}
        </div>
        <PresentationTextPreview
          slides={renderState.slides}
          truncatedSlideCount={renderState.truncatedSlideCount}
        />
      </div>
    );
  }

  if (renderState.status === "error") {
    return (
      <OfficeEmptyState
        title={t("editor.preview.failed")}
        message={t("editor.office.pptxFailed", {
          renderDetail: bidiIsolate(renderState.renderDetail),
          fallbackDetail: bidiIsolate(renderState.fallbackDetail),
        })}
        documentPath={documentPath}
        openExternalFile={openExternalFile}
      />
    );
  }

  return (
    <div
      className="office-pptx-render-preview"
      aria-busy={renderState.status === "loading"}
    >
      <div className="office-pptx-workspace">
        <aside
          ref={thumbnailRailRef}
          className="office-pptx-thumbnail-rail"
          data-po-scrollbar="content"
          role="tablist"
          aria-label={t("editor.office.slides")}
        >
          {viewerState && Array.from({ length: viewerState.slideCount }, (_, index) => (
            <PptxThumbnail
              key={index}
              viewer={viewerState.viewer}
              slideIndex={index}
              active={index === activeSlide}
              scrollRoot={thumbnailRailRef.current}
              onSelect={() => navigateToSlide(index)}
            />
          ))}
        </aside>
        <div
          className="office-pptx-stage"
          role="group"
          tabIndex={0}
          aria-label={t("editor.office.slides")}
          onWheelCapture={handleStageWheel}
          onKeyDown={(event) => handlePresentationNavigationKeyDown(
            event,
            activeSlide,
            viewerState?.slideCount ?? 0,
            navigateToSlide,
          )}
        >
          <div
            ref={hostRef}
            className="office-pptx-render-host"
            data-po-scrollbar="content"
            data-rendering={renderState.status === "loading" ? "true" : undefined}
          />
          {renderState.status === "loading" && (
            <DocumentSurfacePending label={t("editor.office.renderingPresentation")} />
          )}
          {viewerState?.slideCount === 0 && (
            <div className="office-pptx-render-state">{t("editor.office.emptyPresentation")}</div>
          )}
          {slideErrors[activeSlide] && (
            <div className="office-pptx-slide-error" role="status">
              {t("editor.office.slideRenderFailed", {
                number: activeSlide + 1,
                detail: bidiIsolate(slideErrors[activeSlide]),
              })}
            </div>
          )}
          {viewerState && viewerState.slideCount > 0 && (
            <PresentationNavigation
              activeSlide={activeSlide}
              slideCount={viewerState.slideCount}
              onSelect={navigateToSlide}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function PptxThumbnail({
  viewer,
  slideIndex,
  active,
  scrollRoot,
  onSelect,
}: {
  viewer: PptxViewer;
  slideIndex: number;
  active: boolean;
  scrollRoot: HTMLElement | null;
  onSelect: () => void;
}) {
  const { formatNumber, t } = useLocalization();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [renderStatus, setRenderStatus] = useState<"waiting" | "rendering" | "ready" | "error">("waiting");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let handle: SlideHandle | null = null;
    let observer: IntersectionObserver | null = null;
    let disposed = false;
    setRenderStatus("waiting");

    const renderThumbnail = () => {
      if (disposed || handle) return;
      setRenderStatus("rendering");
      const width = Math.max(72, host.clientWidth || 112);
      handle = viewer.renderThumbnailToContainer(slideIndex, host, { width });
      if (!handle) {
        setRenderStatus("error");
      } else {
        void handle.ready.then(() => {
          if (!disposed) {
            applyOfficeCjkFontFallbacks(host);
            setRenderStatus("ready");
          }
        }).catch(() => {
          if (!disposed) setRenderStatus("error");
        });
      }
      observer?.disconnect();
    };

    if (typeof IntersectionObserver === "undefined") {
      renderThumbnail();
    } else {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) renderThumbnail();
      }, {
        root: scrollRoot,
        rootMargin: "240px 0px",
      });
      observer.observe(host);
    }

    return () => {
      disposed = true;
      observer?.disconnect();
      handle?.dispose();
      host.replaceChildren();
    };
  }, [scrollRoot, slideIndex, viewer]);

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={t("editor.office.slideNumber", { number: slideIndex + 1 })}
      className="office-pptx-thumbnail"
      data-slide-index={slideIndex}
      onClick={onSelect}
    >
      <span className="office-pptx-thumbnail__number">{formatNumber(slideIndex + 1)}</span>
      <span
        className="office-pptx-thumbnail__frame"
        ref={hostRef}
        aria-hidden="true"
        data-render-state={renderStatus}
      />
    </button>
  );
}

function PresentationNavigation({
  activeSlide,
  slideCount,
  onSelect,
}: {
  activeSlide: number;
  slideCount: number;
  onSelect: (index: number) => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="office-pptx-navigation">
      <button
        type="button"
        aria-label={t("editor.office.previousSlide")}
        disabled={activeSlide <= 0}
        onClick={() => onSelect(Math.max(0, activeSlide - 1))}
      >
        <ChevronLeft size={15} strokeWidth={2} />
      </button>
      <span>{t("editor.office.slidePosition", { current: activeSlide + 1, total: slideCount })}</span>
      <button
        type="button"
        aria-label={t("editor.office.nextSlide")}
        disabled={activeSlide >= slideCount - 1}
        onClick={() => onSelect(Math.min(slideCount - 1, activeSlide + 1))}
      >
        <ChevronRight size={15} strokeWidth={2} />
      </button>
    </div>
  );
}

function handlePresentationNavigationKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  activeSlide: number,
  slideCount: number,
  onSelect: (index: number) => void,
): void {
  const target = getPresentationNavigationTarget({
    key: event.key,
    activeSlide,
    slideCount,
  });
  if (target === null) return;
  event.preventDefault();
  if (target !== activeSlide) onSelect(target);
}

function usePresentationWheelNavigation({
  activeSlide,
  slideCount,
  onSelect,
  resetKey,
}: {
  activeSlide: number;
  slideCount: number;
  onSelect: (index: number) => void;
  resetKey: unknown;
}): (event: ReactWheelEvent<HTMLElement>) => void {
  const gestureRef = useRef<PresentationWheelGestureState>(
    createPresentationWheelGestureState(),
  );

  useEffect(() => {
    gestureRef.current = createPresentationWheelGestureState();
  }, [resetKey, slideCount]);

  return (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;

    const result = reducePresentationWheelGesture({
      state: gestureRef.current,
      activeSlide,
      slideCount,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      eventTime: event.timeStamp,
    });
    gestureRef.current = result.state;

    if (!result.handled) return;
    event.preventDefault();
    if (result.target !== null) onSelect(result.target);
  };
}

function SpreadsheetPreview({
  result,
  activeSheet,
  onActiveSheetChange,
}: {
  result: Extract<OfficePreviewResult, { kind: "spreadsheet" }>;
  activeSheet: number;
  onActiveSheetChange: (index: number) => void;
}) {
  const { formatList, formatNumber, t } = useLocalization();
  const gridWrapRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [selection, setSelection] = useState<SpreadsheetCellPosition | null>(null);

  const selectedSheet = result.sheets[Math.min(activeSheet, result.sheets.length - 1)];
  const displayScale = selectedSheet?.displayScale ?? 1;
  const rowOffsets = useMemo(
    () => getSpreadsheetRowOffsets(selectedSheet?.rows ?? []),
    [selectedSheet],
  );
  const columnOffsets = useMemo(() => {
    const offsets = new Array<number>((selectedSheet?.columns.length ?? 0) + 1);
    offsets[0] = 0;
    for (let index = 0; index < (selectedSheet?.columns.length ?? 0); index += 1) {
      offsets[index + 1] = offsets[index] + selectedSheet!.columns[index].width;
    }
    return offsets;
  }, [selectedSheet]);

  useEffect(() => {
    const gridWrap = gridWrapRef.current;
    if (!gridWrap) return undefined;

    gridWrap.scrollTop = 0;
    gridWrap.scrollLeft = 0;
    setSelection(findSpreadsheetCellPosition(selectedSheet, selectedSheet?.initialSelection ?? null));
    const updateViewport = () => {
      setViewport({
        scrollTop: gridWrap.scrollTop / displayScale,
        height: gridWrap.clientHeight / displayScale,
      });
    };
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(gridWrap);
    updateViewport();
    return () => {
      resizeObserver.disconnect();
    };
  }, [displayScale, selectedSheet]);

  if (result.sheets.length === 0 || !selectedSheet) {
    const hiddenMessage = result.hiddenSheetCount > 0
      ? t("editor.office.hiddenSheetsOmitted", { count: result.hiddenSheetCount })
      : t("editor.office.noSheets");
    return <OfficeEmptyState title={t("editor.office.noVisibleSheets")} message={hiddenMessage} />;
  }

  const rowCount = selectedSheet.rows.length;
  const frozenRowCount = Math.min(selectedSheet.frozenRows, rowCount);
  const rowWindow = getSpreadsheetVisibleRowWindow({
    rowOffsets,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height || (28 * 60),
    frozenRows: frozenRowCount,
    overscanRows: SPREADSHEET_OVERSCAN_ROWS,
  });
  const frozenRows = getSpreadsheetRenderRows(selectedSheet, 0, frozenRowCount);
  const renderedRows = getSpreadsheetRenderRows(
    selectedSheet,
    rowWindow.startRow,
    rowWindow.endRow,
  );
  const columnSpan = selectedSheet.columns.length + 1;
  const previewNotes = createSpreadsheetPreviewNotes(result, selectedSheet, t, formatList);
  const effectiveSelection = selection
    && selection.rowPosition < rowCount
    && selection.columnPosition < selectedSheet.columns.length
    ? selection
    : findSpreadsheetCellPosition(selectedSheet, selectedSheet.initialSelection);
  const selectedRow = effectiveSelection ? selectedSheet.rows[effectiveSelection.rowPosition] : null;
  const selectedColumn = effectiveSelection
    ? selectedSheet.columns[effectiveSelection.columnPosition]
    : null;
  const selectedValue = effectiveSelection && selectedRow
    ? selectedRow.values[effectiveSelection.columnPosition] ?? ""
    : "";
  const selectedFormula = effectiveSelection && selectedRow
    ? selectedRow.formulas[effectiveSelection.columnPosition]
    : null;
  const selectedAddress = selectedRow && selectedColumn
    ? `${spreadsheetColumnLabel(selectedColumn.columnIndex)}${selectedRow.rowIndex + 1}`
    : "";

  const handleScroll = () => {
    const gridWrap = gridWrapRef.current;
    if (!gridWrap) return;
    setViewport({
      scrollTop: gridWrap.scrollTop / displayScale,
      height: gridWrap.clientHeight / displayScale,
    });
  };

  const selectCell = (target: SpreadsheetCellPosition, reveal: boolean) => {
    setSelection(target);
    if (!reveal) return;
    const gridWrap = gridWrapRef.current;
    if (!gridWrap) return;

    const frozenHeight = (rowOffsets[frozenRowCount] ?? 0) * displayScale;
    const cellTop = (
      SPREADSHEET_COLUMN_HEADER_HEIGHT + (rowOffsets[target.rowPosition] ?? 0)
    ) * displayScale;
    const cellBottom = (
      SPREADSHEET_COLUMN_HEADER_HEIGHT + (rowOffsets[target.rowPosition + 1] ?? 0)
    ) * displayScale;
    const visibleTop = gridWrap.scrollTop
      + ((SPREADSHEET_COLUMN_HEADER_HEIGHT * displayScale) + frozenHeight);
    const visibleBottom = gridWrap.scrollTop + gridWrap.clientHeight;
    if (target.rowPosition >= frozenRowCount && cellTop < visibleTop) {
      gridWrap.scrollTop = Math.max(
        0,
        cellTop - (SPREADSHEET_COLUMN_HEADER_HEIGHT * displayScale) - frozenHeight,
      );
    } else if (cellBottom > visibleBottom) {
      gridWrap.scrollTop = Math.max(0, cellBottom - gridWrap.clientHeight);
    }

    const frozenColumnCount = Math.min(selectedSheet.frozenColumns, selectedSheet.columns.length);
    const frozenWidth = (columnOffsets[frozenColumnCount] ?? 0) * displayScale;
    const cellLeft = (
      SPREADSHEET_ROW_HEADER_WIDTH + (columnOffsets[target.columnPosition] ?? 0)
    ) * displayScale;
    const cellRight = (
      SPREADSHEET_ROW_HEADER_WIDTH + (columnOffsets[target.columnPosition + 1] ?? 0)
    ) * displayScale;
    const visibleLeft = gridWrap.scrollLeft
      + ((SPREADSHEET_ROW_HEADER_WIDTH * displayScale) + frozenWidth);
    const visibleRight = gridWrap.scrollLeft + gridWrap.clientWidth;
    if (target.columnPosition >= frozenColumnCount && cellLeft < visibleLeft) {
      gridWrap.scrollLeft = Math.max(
        0,
        cellLeft - (SPREADSHEET_ROW_HEADER_WIDTH * displayScale) - frozenWidth,
      );
    } else if (cellRight > visibleRight) {
      gridWrap.scrollLeft = Math.max(0, cellRight - gridWrap.clientWidth);
    }
  };

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!effectiveSelection) return;
    const key = event.key === "Tab" && event.shiftKey ? "ArrowLeft" : event.key;
    const target = getSpreadsheetNavigationTarget({
      key,
      selection: effectiveSelection,
      rowCount,
      columnCount: selectedSheet.columns.length,
      pageRows: Math.max(1, Math.floor((viewport.height || 280) / 28)),
      merges: selectedSheet.merges,
    });
    if (!target) return;
    event.preventDefault();
    selectCell(target, true);
  };

  const renderRow = (
    row: ReturnType<typeof getSpreadsheetRenderRows>[number],
    frozen: boolean,
  ) => (
    <tr
      key={`${frozen ? "frozen" : "body"}-${row.rowIndex}`}
      aria-rowindex={row.rowPosition + 2}
      data-frozen-row={frozen ? "true" : undefined}
      style={{
        "--office-sheet-row-height": `${row.height}px`,
        "--office-sheet-frozen-top": `${SPREADSHEET_COLUMN_HEADER_HEIGHT + rowOffsets[row.rowPosition]}px`,
      } as CSSProperties}
    >
      <th
        className="office-spreadsheet-grid__row-header"
        scope="row"
        aria-colindex={1}
        data-selected={effectiveSelection?.rowPosition === row.rowPosition ? "true" : undefined}
      >
        {formatNumber(row.rowIndex + 1)}
      </th>
      {row.cells.map((cell) => {
        const isSelected = effectiveSelection?.rowPosition === row.rowPosition
          && effectiveSelection.columnPosition === cell.columnPosition;
        const frozenColumn = cell.columnPosition < selectedSheet.frozenColumns;
        const workbookStyle = result.styles[cell.styleId];
        return (
          <td
            key={`${row.rowIndex}-${cell.columnIndex}`}
            data-cell-kind={cell.kind}
            data-column-position={cell.columnPosition}
            data-frozen-column={frozenColumn ? "true" : undefined}
            data-row-position={row.rowPosition}
            data-selected={isSelected ? "true" : undefined}
            aria-colindex={cell.columnPosition + 2}
            aria-selected={isSelected || undefined}
            colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
            rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
            style={createSpreadsheetCellCssStyle(
              workbookStyle,
              frozenColumn
                ? SPREADSHEET_ROW_HEADER_WIDTH + columnOffsets[cell.columnPosition]
                : null,
            )}
            title={cell.value || undefined}
            onClick={() => {
              selectCell({ rowPosition: row.rowPosition, columnPosition: cell.columnPosition }, false);
              gridWrapRef.current?.focus({ preventScroll: true });
            }}
          >
            <span dir="auto">{cell.value}</span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div
      className="office-spreadsheet-preview"
      style={createSpreadsheetPresentationCssStyle(result)}
    >
      <div
        className="office-spreadsheet-formula-bar"
        aria-label={t("editor.office.formulaBar")}
        aria-live="polite"
        role="group"
      >
        <output
          className="office-spreadsheet-formula-bar__name"
          aria-label={`${t("editor.office.formulaBar")}: ${selectedAddress}`}
        >
          {selectedAddress}
        </output>
        <span className="office-spreadsheet-formula-bar__fx" aria-hidden="true">{"ƒx"}</span>
        <output className="office-spreadsheet-formula-bar__value" dir="auto">
          {selectedFormula ? `=${selectedFormula}` : selectedValue}
        </output>
      </div>
      <div
        className="office-spreadsheet-grid-wrap"
        data-po-scrollbar="content"
        ref={gridWrapRef}
        role="region"
        tabIndex={0}
        aria-label={selectedSheet.name}
        onScroll={handleScroll}
        onKeyDown={handleGridKeyDown}
      >
        <table
          className="office-spreadsheet-grid"
          data-display-scale={displayScale}
          data-show-grid-lines={selectedSheet.showGridLines ? "true" : "false"}
          aria-rowcount={selectedSheet.rows.length + 1}
          aria-colcount={selectedSheet.columns.length + 1}
          style={{ zoom: displayScale }}
        >
          <caption className="sr-only">{selectedSheet.name}</caption>
          <colgroup>
            <col className="office-spreadsheet-grid__row-header-col" />
            {selectedSheet.columns.map((column) => (
              <col key={column.columnIndex} style={{ width: column.width }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="office-spreadsheet-grid__corner" aria-hidden="true" />
              {selectedSheet.columns.map((column, columnPosition) => (
                <th
                  className="office-spreadsheet-grid__column-header"
                  key={column.columnIndex}
                  scope="col"
                  aria-colindex={columnPosition + 2}
                  data-frozen-column={columnPosition < selectedSheet.frozenColumns ? "true" : undefined}
                  data-selected={effectiveSelection?.columnPosition === columnPosition ? "true" : undefined}
                  style={columnPosition < selectedSheet.frozenColumns
                    ? ({
                      "--office-sheet-frozen-left": `${SPREADSHEET_ROW_HEADER_WIDTH + columnOffsets[columnPosition]}px`,
                    } as CSSProperties)
                    : undefined}
                >
                  {spreadsheetColumnLabel(column.columnIndex)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {frozenRows.map((row) => renderRow(row, true))}
            {rowWindow.topSpacerHeight > 0 && (
              <tr className="office-spreadsheet-grid__spacer" aria-hidden="true">
                <td colSpan={columnSpan} style={{ height: rowWindow.topSpacerHeight }} />
              </tr>
            )}
            {renderedRows.map((row) => renderRow(row, false))}
            {rowWindow.bottomSpacerHeight > 0 && (
              <tr className="office-spreadsheet-grid__spacer" aria-hidden="true">
                <td colSpan={columnSpan} style={{ height: rowWindow.bottomSpacerHeight }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {previewNotes.length > 0 && (
        <div className="office-preview__note">
          {previewNotes.join(" ")}
        </div>
      )}
      <div
        className="office-spreadsheet-tabs"
        data-po-scrollbar="horizontal"
        role="tablist"
        aria-label={t("editor.office.sheets")}
      >
        {result.sheets.map((sheet, index) => (
          <button
            key={sheet.name}
            type="button"
            role="tab"
            aria-selected={index === activeSheet}
            title={sheet.name}
            onClick={() => onActiveSheetChange(index)}
          >
            <span dir="auto">{sheet.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function createSpreadsheetCellCssStyle(
  style: SpreadsheetCellStyle | undefined,
  frozenLeft: number | null,
): CSSProperties {
  const css: CSSProperties & Record<`--${string}`, string> = {};
  if (style?.backgroundColor) css.backgroundColor = style.backgroundColor;
  if (style?.color) css.color = style.color;
  if (style?.fontFamily) {
    css.fontFamily = spreadsheetFontFamilyCss(style.fontFamily);
  }
  if (style?.fontSize) css.fontSize = `${style.fontSize}px`;
  if (style?.bold) css.fontWeight = 700;
  if (style?.italic) css.fontStyle = "italic";
  if (style?.underline) css.textDecoration = "underline";
  if (style?.horizontalAlign) css.textAlign = style.horizontalAlign;
  if (style?.verticalAlign) css.verticalAlign = style.verticalAlign;
  if (style?.wrapText) css.whiteSpace = "normal";
  if (style?.borderTop) css.borderTop = spreadsheetBorderCss(style.borderTop);
  if (style?.borderRight) css.borderRight = spreadsheetBorderCss(style.borderRight);
  if (style?.borderBottom) css.borderBottom = spreadsheetBorderCss(style.borderBottom);
  if (style?.borderLeft) css.borderLeft = spreadsheetBorderCss(style.borderLeft);
  if (frozenLeft !== null) css["--office-sheet-frozen-left"] = `${frozenLeft}px`;
  return css;
}

function createSpreadsheetPresentationCssStyle(
  result: SpreadsheetPreviewResult,
): CSSProperties {
  const css: CSSProperties & Record<`--${string}`, string> = {};
  if (result.defaultFontFamily) {
    css["--office-sheet-default-font-family"] = spreadsheetFontFamilyCss(
      result.defaultFontFamily,
    );
  }
  if (result.defaultFontSize) {
    css["--office-sheet-default-font-size"] = `${result.defaultFontSize}px`;
  }
  return css;
}

function spreadsheetFontFamilyCss(fontFamily: string): string {
  const safeFamily = fontFamily.replaceAll('"', "");
  return `"${safeFamily}", "Aptos", "Calibri", "Segoe UI", Arial, sans-serif`;
}

function spreadsheetBorderCss(border: SpreadsheetCellBorder): string {
  return `${border.width}px ${border.style} ${border.color}`;
}

function spreadsheetColumnLabel(columnIndex: number): string {
  let value = Math.max(0, columnIndex) + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function createSpreadsheetPreviewNotes(
  result: SpreadsheetPreviewResult,
  sheet: SpreadsheetSheet,
  t: MessageFormatter,
  formatList: ReturnType<typeof useLocalization>["formatList"],
): string[] {
  const notes: string[] = [];
  if (result.budget.truncated) {
    const reasons = result.budget.truncationReasons.map((reason) => t(
      reason === "materialized-cell-limit"
        ? "editor.office.budget.cellCount"
        : "editor.office.budget.textMemory",
    ));
    notes.push(t("editor.office.budgetStopped", { reasons: formatList(reasons) }));
  }
  if (result.truncatedSheetCount > 0) {
    notes.push(t("editor.office.visibleSheets", {
      visible: result.sheets.length,
      total: result.totalVisibleSheets,
    }));
  }
  if (result.hiddenSheetCount > 0) {
    notes.push(t("editor.office.hiddenSheetsOmitted", { count: result.hiddenSheetCount }));
  }
  if (sheet.truncatedRows) {
    notes.push(t("editor.office.visibleRows", { visible: sheet.rows.length, total: sheet.totalVisibleRows }));
  }
  if (sheet.truncatedColumns) {
    notes.push(t("editor.office.visibleColumns", {
      visible: sheet.columns.length,
      total: sheet.totalVisibleColumns,
    }));
  }
  if (sheet.hiddenRowCount > 0) {
    notes.push(t("editor.office.hiddenRowsOmitted", { count: sheet.hiddenRowCount }));
  }
  if (sheet.hiddenColumnCount > 0) {
    notes.push(t("editor.office.hiddenColumnsOmitted", { count: sheet.hiddenColumnCount }));
  }
  return notes;
}

function OfficeEmptyState({
  title,
  message,
  documentPath,
  openExternalFile,
}: {
  title: string;
  message: string;
  documentPath?: string;
  openExternalFile?: (path: string) => Promise<void>;
}) {
  const { t } = useLocalization();
  const [externalOpenError, setExternalOpenError] = useState<string | null>(null);
  const openExternally = () => {
    if (!documentPath || !openExternalFile) return;
    setExternalOpenError(null);
    void Promise.resolve().then(() => openExternalFile(documentPath)).catch((error) => {
      setExternalOpenError(error instanceof Error ? error.message : String(error));
    });
  };

  return (
    <div className="office-preview-empty">
      <strong>{title}</strong>
      <span dir="auto">{message}</span>
      {documentPath && openExternalFile && (
        <button type="button" data-po-interaction="navigation" onClick={openExternally}>
          {t("editor.openDefaultApp")}
        </button>
      )}
      {externalOpenError && (
        <span role="alert">
          {t("editor.office.openDesktopFailed", { detail: bidiIsolate(externalOpenError) })}
        </span>
      )}
    </div>
  );
}

async function loadOfficePreview({
  fileUrl,
  filename,
  extension,
  path,
  maxSourceBytes,
  convertOfficeDocumentToDocx,
  signal,
}: {
  fileUrl?: string | null;
  filename: string;
  extension: string;
  path: string;
  maxSourceBytes: number;
  convertOfficeDocumentToDocx?: OfficeViewerProps["convertOfficeDocumentToDocx"];
  signal?: AbortSignal;
}): Promise<OfficePreviewResult> {
  if (NATIVE_DOCX_CONVERTIBLE_EXTENSIONS.has(extension)) {
    if (!convertOfficeDocumentToDocx) {
      return unsupportedNativeConversionMessage(extension);
    }

    let convertedBuffer: ArrayBuffer;
    try {
      const result = await convertOfficeDocumentToDocx(path, { signal });
      signal?.throwIfAborted();
      convertedBuffer = result.arrayBuffer;
    } catch (error) {
      if (isAbortError(error)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      return {
        kind: "unsupported",
        code: "conversion-failed",
        extension,
        detail: reason,
      };
    }

    const packageRejection = getOfficePackageRejection("docx", convertedBuffer);
    if (packageRejection) return packageRejection;
    try {
      const validatedBuffer = await validateOfficePackageForPreview(
        convertedBuffer,
        "docx",
        DOCX_DECOMPRESSION_BUDGET,
        signal,
      );
      return { kind: "word", arrayBuffer: validatedBuffer };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return unsafeOfficePackageMessage("converted-word", error);
    }
  }

  if (LEGACY_PRESENTATION_EXTENSIONS.has(extension)) {
    return {
      kind: "unsupported",
      code: "legacy-presentation",
    };
  }

  if (!fileUrl) {
    return {
      kind: "unsupported",
      code: "resource-unavailable",
    };
  }

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await fetchOfficeArrayBuffer(fileUrl, {
      signal,
      maxBytes: maxSourceBytes,
    });
  } catch (error) {
    if (error instanceof OfficeResourceLimitError) {
      return {
        kind: "unsupported",
        code: "resource-rejected",
        detail: error.message,
      };
    }
    throw error;
  }

  const packageRejection = getOfficePackageRejection(extension, arrayBuffer);
  if (packageRejection) return packageRejection;

  if (isWordExtension(extension)) {
    try {
      arrayBuffer = await validateOfficePackageForPreview(
        arrayBuffer,
        "docx",
        DOCX_DECOMPRESSION_BUDGET,
        signal,
      );
      return { kind: "word", arrayBuffer };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return unsafeOfficePackageMessage("word", error);
    }
  }
  if (isSpreadsheetExtension(extension)) {
    try {
      return await parseSpreadsheetInWorker(arrayBuffer, {
        archiveKind: getSpreadsheetArchiveKind(extension),
        signal,
      });
    } catch (error) {
      if (isZipPreflightError(error)) {
        return {
          kind: "unsupported",
          code: "unsafe-package",
          subject: "spreadsheet",
          detail: error.message,
        };
      }
      throw error;
    }
  }
  if (isPresentationExtension(extension)) {
    try {
      arrayBuffer = await validateOfficePackageForPreview(
        arrayBuffer,
        "ooxml",
        PRESENTATION_DECOMPRESSION_BUDGET,
        signal,
      );
      return { kind: "presentation", arrayBuffer };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return unsafeOfficePackageMessage("presentation", error);
    }
  }
  if (isOpenDocumentExtension(extension)) {
    try {
      arrayBuffer = await validateOfficePackageForPreview(
        arrayBuffer,
        "zip",
        OPEN_DOCUMENT_DECOMPRESSION_BUDGET,
        signal,
      );
      return await parseOpenDocument(arrayBuffer, filename, signal);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return unsafeOfficePackageMessage("opendocument", error);
    }
  }

  return {
    kind: "unsupported",
    code: "unsupported-format",
  };
}

async function validateOfficePackageForPreview(
  arrayBuffer: ArrayBuffer,
  profile: "zip" | "ooxml" | "docx",
  budget: {
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
    maxDocxXmlStartTags?: number;
  },
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const result = await validateOfficePackageInWorker(arrayBuffer, {
    profile,
    budget,
    signal,
  });
  return result.arrayBuffer;
}

function unsafeOfficePackageMessage(
  subject: OfficePackageSubject,
  error: unknown,
): Extract<OfficePreviewResult, { kind: "unsupported" }> {
  return {
    kind: "unsupported",
    code: "unsafe-package",
    subject,
    detail: error instanceof Error ? error.message : String(error),
  };
}

function formatOfficeUnsupported(result: OfficeUnsupportedResult, t: MessageFormatter): string {
  switch (result.code) {
    case "conversion-failed":
      return t("editor.office.unsupported.conversionFailed", {
        extension: bidiIsolate(`.${result.extension ?? "doc"}`),
        detail: bidiIsolate(result.detail ?? t("editor.office.unknownError")),
      });
    case "legacy-presentation":
      return t("editor.office.unsupported.legacyPresentation");
    case "resource-unavailable":
      return t("editor.office.resourceUnavailable");
    case "resource-rejected":
      return t("editor.office.unsupported.resourceRejected", {
        detail: bidiIsolate(result.detail ?? t("editor.office.unknownError")),
      });
    case "unsafe-package":
      return t("editor.office.unsupported.unsafePackage", {
        subject: t(`editor.office.subject.${result.subject ?? "office"}`),
        detail: bidiIsolate(result.detail ?? t("editor.office.unknownError")),
      });
    case "legacy-word":
      return t("editor.office.unsupported.legacyWord");
    case "rich-text-converter":
      return t("editor.office.unsupported.richTextConverter");
    case "unsupported-format":
    default:
      return t("editor.office.unsupported.format");
  }
}

async function parsePresentationText(
  arrayBuffer: ArrayBuffer,
  signal?: AbortSignal,
): Promise<OfficePreviewResult> {
  const result = await extractOfficeTextFallbackInWorker(arrayBuffer, {
    operation: "extract-presentation-text",
    signal,
  });
  return {
    kind: "presentationText",
    slides: result.slides,
    truncatedSlideCount: result.report.truncatedSlideCount,
  };
}

async function parseOpenDocument(
  arrayBuffer: ArrayBuffer,
  filename: string,
  signal?: AbortSignal,
): Promise<OfficePreviewResult> {
  const result = await extractOfficeTextFallbackInWorker(arrayBuffer, {
    operation: "extract-opendocument-text",
    signal,
  });
  return {
    kind: "opendocument",
    title: filename,
    lines: result.lines,
    truncatedLines: result.report.truncatedLines,
  };
}

function getExtension(filename: string): string {
  const match = /\.([^.]+)$/.exec(filename.toLowerCase());
  return match ? match[1] : "";
}

function getOfficePreviewSurfaceKind(
  extension: string,
): "word" | "spreadsheet" | "presentation" | "document" {
  if (["ppt", "pps", "pptx", "ppsx", "odp", "otp"].includes(extension)) {
    return "presentation";
  }
  if (isSpreadsheetExtension(extension)) return "spreadsheet";
  if (["doc", "docx", "rtf", "odt", "ott"].includes(extension)) return "word";
  return "document";
}

function isWordExtension(extension: string): boolean {
  return extension === "docx";
}

function isSpreadsheetExtension(extension: string): boolean {
  return extension === "xlsx"
    || extension === "xls"
    || extension === "xlsm"
    || extension === "xlsb"
    || extension === "ods"
    || extension === "ots";
}

function isPresentationExtension(extension: string): boolean {
  return extension === "pptx" || extension === "ppsx";
}

function isOpenDocumentExtension(extension: string): boolean {
  return extension === "odt" || extension === "ods" || extension === "odp" || extension === "ott" || extension === "ots" || extension === "otp";
}

function unsupportedNativeConversionMessage(extension: string): OfficePreviewResult {
  if (LEGACY_WORD_EXTENSIONS.has(extension)) {
    return {
      kind: "unsupported",
      code: "legacy-word",
    };
  }

  return {
    kind: "unsupported",
    code: "rich-text-converter",
  };
}

function getOfficePackageRejection(
  extension: string,
  arrayBuffer: ArrayBuffer,
): Extract<OfficePreviewResult, { kind: "unsupported" }> | null {
  try {
    if (OOXML_PACKAGE_EXTENSIONS.has(extension)) {
      preflightOoxmlPackage(arrayBuffer);
    } else if (OPEN_DOCUMENT_PACKAGE_EXTENSIONS.has(extension)) {
      preflightZipCentralDirectory(arrayBuffer);
    }
    return null;
  } catch (error) {
    if (!(error instanceof ZipPreflightError)) throw error;
    return {
      kind: "unsupported",
      code: "unsafe-package",
      subject: "office",
      detail: error.message,
    };
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function isZipPreflightError(error: unknown): error is Error {
  return error instanceof ZipPreflightError
    || (error instanceof Error && error.name === "ZipPreflightError");
}
