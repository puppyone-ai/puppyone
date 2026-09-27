import { Tooltip } from "@puppyone/shared-ui";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type FormEvent,
} from "react";
import {
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  DesktopDialogCloseButton,
  DesktopDialogRoot,
  DesktopDialogSurface,
} from "../../components/DesktopDialog";
import {
  DesktopOverlayPortal,
  type DesktopOverlayPortalProps,
} from "./DesktopOverlayPortal";
import "./desktop-help-launcher.css";

type SubmissionState = "idle" | "sending" | "sent" | "error";
type AttachmentState = "idle" | "processing" | "error";
type FeedbackScreenshotMimeType = "image/jpeg" | "image/png" | "image/webp";
type FeedbackScreenshot = {
  bytes: ArrayBuffer;
  mimeType: FeedbackScreenshotMimeType;
  previewUrl: string;
};

const FEEDBACK_MAX_LENGTH = 2_000;
const FEEDBACK_EMAIL_MAX_LENGTH = 254;
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const MAX_SOURCE_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const MAX_SCREENSHOT_EDGE = 1_920;
const SUPPORTED_SCREENSHOT_TYPES = new Set<FeedbackScreenshotMimeType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/**
 * A deliberately quiet, shell-level feedback affordance. Its trigger lives in
 * the active navigation utility slot; the dialog remains in the global overlay.
 */
export type DesktopHelpLauncherProps = Omit<DesktopOverlayPortalProps, "children">;

export function DesktopHelpLauncher(overlayTheme: DesktopHelpLauncherProps) {
  const { locale, t } = useLocalization();
  const feedbackMessageId = useId();
  const feedbackEmailId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [submissionState, setSubmissionState] = useState<SubmissionState>("idle");
  const [attachmentState, setAttachmentState] = useState<AttachmentState>("idle");
  const [attachmentError, setAttachmentError] = useState("");
  const [screenshot, setScreenshot] = useState<FeedbackScreenshot | null>(null);
  const [draggingScreenshot, setDraggingScreenshot] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const screenshotRef = useRef<FeedbackScreenshot | null>(null);
  const submissionIdRef = useRef(0);
  const attachmentIdRef = useRef(0);
  const label = t("shell.feedback.label");

  const replaceScreenshot = useCallback((nextScreenshot: FeedbackScreenshot | null) => {
    const currentScreenshot = screenshotRef.current;
    if (
      currentScreenshot?.previewUrl
      && currentScreenshot.previewUrl !== nextScreenshot?.previewUrl
    ) {
      URL.revokeObjectURL(currentScreenshot.previewUrl);
    }
    screenshotRef.current = nextScreenshot;
    setScreenshot(nextScreenshot);
  }, []);

  const close = useCallback(() => {
    submissionIdRef.current += 1;
    attachmentIdRef.current += 1;
    setOpen(false);
    setMessage("");
    setEmail("");
    setSubmissionState("idle");
    setAttachmentState("idle");
    setAttachmentError("");
    setDraggingScreenshot(false);
    replaceScreenshot(null);
  }, [replaceScreenshot]);

  useEffect(() => () => {
    const previewUrl = screenshotRef.current?.previewUrl;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, []);

  const handleLauncherClick = () => {
    if (open) return;
    setSubmissionState("idle");
    setOpen(true);
  };

  const attachScreenshot = useCallback(async (file: File) => {
    const attachmentId = attachmentIdRef.current + 1;
    attachmentIdRef.current = attachmentId;
    setAttachmentState("processing");
    setAttachmentError("");

    try {
      const nextScreenshot = await prepareFeedbackScreenshot(file);
      if (attachmentIdRef.current !== attachmentId) {
        URL.revokeObjectURL(nextScreenshot.previewUrl);
        return;
      }
      replaceScreenshot(nextScreenshot);
      setAttachmentState("idle");
      textareaRef.current?.focus({ preventScroll: true });
    } catch (error) {
      if (attachmentIdRef.current !== attachmentId) return;
      setAttachmentState("error");
      setAttachmentError(
        error instanceof ScreenshotPreparationError && error.code === "unsupported"
          ? t("shell.feedback.screenshotUnsupported")
          : t("shell.feedback.screenshotTooLarge"),
      );
    }
  }, [replaceScreenshot, t]);

  const handleScreenshotInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (file) void attachScreenshot(file);
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const screenshotFile = Array.from(event.clipboardData.items)
      .find((item) => item.kind === "file" && item.type.startsWith("image/"))
      ?.getAsFile();
    if (!screenshotFile) return;
    event.preventDefault();
    void attachScreenshot(screenshotFile);
  };

  const handleDrop = (event: ReactDragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDraggingScreenshot(false);
    const screenshotFile = Array.from(event.dataTransfer.files)
      .find((file) => file.type.startsWith("image/"));
    if (screenshotFile) void attachScreenshot(screenshotFile);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedMessage = message.trim();
    const trimmedEmail = email.trim();
    const submitFeedback = window.puppyoneDesktop?.submitFeedback;
    if (
      !isValidFeedbackEmail(trimmedEmail)
      || !trimmedMessage
      || !submitFeedback
    ) {
      setSubmissionState("error");
      return;
    }

    const submissionId = submissionIdRef.current + 1;
    submissionIdRef.current = submissionId;
    setSubmissionState("sending");

    try {
      await submitFeedback({
        message: trimmedMessage,
        email: trimmedEmail,
        locale,
        ...(screenshot
          ? {
            screenshot: {
              bytes: screenshot.bytes,
              mimeType: screenshot.mimeType,
            },
          }
          : {}),
      });
      if (submissionIdRef.current !== submissionId) return;
      setSubmissionState("sent");
    } catch {
      if (submissionIdRef.current !== submissionId) return;
      setSubmissionState("error");
    }
  };

  const canSend =
    Boolean(email.trim())
    && Boolean(message.trim())
    && submissionState !== "sending"
    && submissionState !== "sent"
    && attachmentState !== "processing";
  const sendLabel =
    submissionState === "sending"
      ? t("shell.feedback.sending")
      : submissionState === "sent"
        ? t("shell.feedback.sent")
        : submissionState === "error"
          ? t("shell.feedback.error")
          : t("shell.feedback.send");
  const liveStatus =
    submissionState === "sending"
      ? t("shell.feedback.sending")
      : submissionState === "sent"
        ? t("shell.feedback.sent")
        : submissionState === "error"
          ? t("shell.feedback.error")
          : attachmentError;

  return (
    <div
      className="desktop-feedback"
      data-open={open ? "true" : undefined}
      data-window-no-drag="true"
    >
      {open ? (
        <DesktopOverlayPortal {...overlayTheme}>
          <DesktopDialogRoot
            className="desktop-feedback-dialog-backdrop"
            dismissOnBackdrop={false}
          >
            <DesktopDialogSurface
              className="desktop-feedback-dialog"
              width={640}
              ariaLabel={label}
            >
              <header className="desktop-dialog-header desktop-feedback-header">
                <div className="desktop-dialog-title-row">
                  <h2>{label}</h2>
                </div>
                <DesktopDialogCloseButton
                  className="desktop-feedback-close"
                  label={t("common.action.close")}
                  onClick={close}
                />
              </header>

              <form
                className="desktop-feedback-form"
                aria-busy={submissionState === "sending" || attachmentState === "processing"}
                onSubmit={handleSubmit}
                onDragEnter={(event) => {
                  if (!Array.from(event.dataTransfer.types).includes("Files")) return;
                  event.preventDefault();
                  setDraggingScreenshot(true);
                }}
                onDragOver={(event) => {
                  if (!Array.from(event.dataTransfer.types).includes("Files")) return;
                  event.preventDefault();
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDraggingScreenshot(false);
                }}
                onDrop={handleDrop}
              >
                <div className="desktop-feedback-fields">
                  <div className="desktop-feedback-message-field">
                    <label className="desktop-feedback-field-label" htmlFor={feedbackMessageId}>
                      {t("shell.feedback.messageLabel")}
                      <span className="desktop-feedback-required-marker" aria-hidden="true">*</span>
                    </label>
                    <div
                      className="desktop-feedback-composer"
                      data-dragging={draggingScreenshot ? "true" : undefined}
                    >
                      <textarea
                        ref={textareaRef}
                        id={feedbackMessageId}
                        value={message}
                        maxLength={FEEDBACK_MAX_LENGTH}
                        required
                        data-desktop-dialog-initial-focus="true"
                        disabled={submissionState === "sending" || submissionState === "sent"}
                        aria-label={t("shell.feedback.messageLabel")}
                        placeholder={t("shell.feedback.placeholder")}
                        onPaste={handlePaste}
                        onChange={(event) => {
                          setMessage(event.currentTarget.value);
                          if (submissionState === "error") setSubmissionState("idle");
                        }}
                      />
                    </div>

                    <div className="desktop-feedback-attachment-row">
                      <div className="desktop-feedback-attachment-slot">
                        <input
                          ref={fileInputRef}
                          className="desktop-feedback-file-input"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          tabIndex={-1}
                          onChange={handleScreenshotInput}
                        />
                        {screenshot ? (
                          <Tooltip content={t("shell.feedback.removeScreenshot")}><button
                            className="desktop-feedback-screenshot"
                            type="button"
                            aria-label={t("shell.feedback.removeScreenshot")}
                            disabled={submissionState === "sending" || submissionState === "sent"}
                            onClick={() => {
                              replaceScreenshot(null);
                              setAttachmentError("");
                              setAttachmentState("idle");
                            }}
                                                                                  >
                            <img src={screenshot.previewUrl} alt="" />
                            <span aria-hidden="true">
                              <Trash2 size={12} strokeWidth={1.9} />
                            </span>
                          </button></Tooltip>
                        ) : (
                          <Tooltip content={t("shell.feedback.attachScreenshot")}><button
                            className="desktop-feedback-attach"
                            type="button"
                            aria-label={t("shell.feedback.attachScreenshot")}
                            disabled={
                              attachmentState === "processing"
                              || submissionState === "sending"
                              || submissionState === "sent"
                            }
                            onClick={() => fileInputRef.current?.click()}
                                                                                  >
                            {attachmentState === "processing" ? (
                              <LoaderCircle
                                className="desktop-feedback-spinner"
                                size={16}
                                strokeWidth={1.8}
                                aria-hidden="true"
                              />
                            ) : (
                              <ImagePlus size={16} strokeWidth={1.7} aria-hidden="true" />
                            )}
                          </button></Tooltip>
                        )}
                        {attachmentState === "error" && attachmentError ? (
                          <Tooltip content={attachmentError}><span
                            className="desktop-feedback-attachment-error"
                            role="img"
                            aria-label={attachmentError}
                                                             >
                            <CircleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
                          </span></Tooltip>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="desktop-feedback-contact-field">
                    <label className="desktop-feedback-field-label" htmlFor={feedbackEmailId}>
                      {t("shell.feedback.contactLabel")}
                      <span className="desktop-feedback-required-marker" aria-hidden="true">*</span>
                    </label>
                    <input
                      className="desktop-feedback-contact-input"
                      id={feedbackEmailId}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      maxLength={FEEDBACK_EMAIL_MAX_LENGTH}
                      value={email}
                      disabled={submissionState === "sending" || submissionState === "sent"}
                      aria-label={t("shell.feedback.contactLabel")}
                      aria-invalid={Boolean(email.trim()) && !isValidFeedbackEmail(email.trim())}
                      placeholder={t("shell.feedback.contactPlaceholder")}
                      onChange={(event) => {
                        setEmail(event.currentTarget.value);
                        if (submissionState === "error") setSubmissionState("idle");
                      }}
                    />
                  </div>
                </div>

                <footer className="desktop-dialog-footer desktop-feedback-footer">
                  <span className="desktop-feedback-status" aria-live="polite">
                    {liveStatus}
                  </span>
                  <Tooltip content={sendLabel}><button
                    className="desktop-dialog-button primary desktop-feedback-submit"
                    type="submit"
                    aria-label={sendLabel}
                    data-state={submissionState}
                    disabled={!canSend}
                                               >
                    {submissionState === "sending" ? (
                      <LoaderCircle
                        className="desktop-feedback-spinner"
                        size={14}
                        strokeWidth={1.9}
                        aria-hidden="true"
                      />
                    ) : submissionState === "sent" ? (
                      <Check size={14} strokeWidth={2} aria-hidden="true" />
                    ) : submissionState === "error" ? (
                      <CircleAlert size={14} strokeWidth={1.9} aria-hidden="true" />
                    ) : null}
                    <span>{sendLabel}</span>
                  </button></Tooltip>
                </footer>
              </form>
            </DesktopDialogSurface>
          </DesktopDialogRoot>
        </DesktopOverlayPortal>
      ) : null}

      <Tooltip content={label}><button
        className="desktop-help-launcher"
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleLauncherClick}
                               >
        <span className="desktop-help-launcher-icon-slot" aria-hidden="true">
          <FeedbackHelpIcon />
        </span>
      </button></Tooltip>
    </div>
  );
}

/** Drawing axes share x=12; the launcher icon slot owns button-level centering. */
function FeedbackHelpIcon() {
  return (
    <svg
      className="desktop-feedback-help-icon"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle data-feedback-ring="true" cx="12" cy="12" r="10" />
      <path
        data-feedback-question-stem="true"
        d="M9.1 9.2C9.35 7.65 10.45 6.8 12 6.8C13.78 6.8 14.9 7.75 14.9 9.3C14.9 10.55 14.25 11.2 13.2 11.9C12.4 12.43 12 13 12 13.75"
      />
      <circle data-feedback-question-dot="true" cx="12" cy="17" r="0.82" fill="currentColor" stroke="none" />
    </svg>
  );
}

function isValidFeedbackEmail(value: string) {
  return value.length > 0
    && value.length <= FEEDBACK_EMAIL_MAX_LENGTH
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value);
}

class ScreenshotPreparationError extends Error {
  constructor(readonly code: "unsupported" | "too-large") {
    super(code);
  }
}

async function prepareFeedbackScreenshot(file: File): Promise<FeedbackScreenshot> {
  const mimeType = normalizeScreenshotMimeType(file.type);
  if (!mimeType || file.size <= 0 || file.size > MAX_SOURCE_SCREENSHOT_BYTES) {
    throw new ScreenshotPreparationError(
      mimeType ? "too-large" : "unsupported",
    );
  }

  let screenshotBlob: Blob = file;
  if (file.size > MAX_SCREENSHOT_BYTES) {
    screenshotBlob = await compressFeedbackScreenshot(file);
  }
  if (screenshotBlob.size > MAX_SCREENSHOT_BYTES) {
    throw new ScreenshotPreparationError("too-large");
  }

  return {
    bytes: await screenshotBlob.arrayBuffer(),
    mimeType: normalizeScreenshotMimeType(screenshotBlob.type) || mimeType,
    previewUrl: URL.createObjectURL(screenshotBlob),
  };
}

async function compressFeedbackScreenshot(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== "function") {
    throw new ScreenshotPreparationError("too-large");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      MAX_SCREENSHOT_EDGE / bitmap.width,
      MAX_SCREENSHOT_EDGE / bitmap.height,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ScreenshotPreparationError("too-large");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const compressed = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.8);
    });
    if (!compressed) throw new ScreenshotPreparationError("too-large");
    return compressed;
  } finally {
    bitmap.close();
  }
}

function normalizeScreenshotMimeType(value: string): FeedbackScreenshotMimeType | null {
  const normalized = value.trim().toLowerCase();
  return SUPPORTED_SCREENSHOT_TYPES.has(normalized as FeedbackScreenshotMimeType)
    ? normalized as FeedbackScreenshotMimeType
    : null;
}
