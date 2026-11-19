import type { IframeHTMLAttributes } from "react";

const APP_FRAME_SANDBOX = "allow-forms allow-scripts allow-same-origin";
const APP_FRAME_PERMISSIONS = [
  "camera 'none'",
  "microphone 'none'",
  "geolocation 'none'",
  "display-capture 'none'",
  "midi 'none'",
  "payment 'none'",
  "usb 'none'",
  "serial 'none'",
  "clipboard-read 'none'",
  "clipboard-write 'none'",
].join("; ");

export function SandboxedAppFrame({
  url,
  title,
  busy,
  onLoad,
}: {
  url: string;
  title: string;
  busy: boolean;
  onLoad: IframeHTMLAttributes<HTMLIFrameElement>["onLoad"];
}) {
  return (
    <iframe
      className="app-preview-frame"
      data-puppyone-app-frame="true"
      src={url}
      aria-label={title}
      sandbox={APP_FRAME_SANDBOX}
      allow={APP_FRAME_PERMISSIONS}
      referrerPolicy="no-referrer"
      aria-busy={busy}
      onLoad={onLoad}
    />
  );
}

/**
 * Defense in depth for a URL that has already passed the main-process runtime
 * validator. `allow-scripts` plus `allow-same-origin` is required by real app
 * frameworks, so a same-origin embed must be rejected: such a frame could
 * otherwise reach the host document and remove its own sandbox attribute.
 */
export function resolveAppPreviewFrameUrl(
  value: string | null | undefined,
  hostOrigin = getHostOrigin(),
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
    if (!url.hostname || url.username || url.password) return null;
    if (hostOrigin && hostOrigin !== "null" && url.origin === hostOrigin) return null;
    return url.href;
  } catch {
    return null;
  }
}

function getHostOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.origin;
}
