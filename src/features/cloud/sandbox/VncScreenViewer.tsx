import { useEffect, useRef } from "react";
import RFB from "@novnc/novnc";
import type { CloudScreenViewerProps } from "./screenViewer";

/**
 * noVNC over the backend's ticketed WebSocket. Starts in read-only mode so the
 * outer pointer can move across the window freely; only forwards mouse, wheel,
 * and keyboard input while `interactive` is true ("taken over"). Clipboard
 * contents are never exchanged automatically.
 */
export function VncScreenViewer({
  session,
  interactive = false,
  onStatus,
}: CloudScreenViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const status = useRef(onStatus);
  status.current = onStatus;

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    status.current("connecting");
    const rfb = new RFB(target, session.url, { shared: true, wsProtocols: session.protocols });
    rfbRef.current = rfb;
    rfb.viewOnly = !interactiveRef.current;
    rfb.focusOnClick = interactiveRef.current;
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.background = "transparent";
    rfb.qualityLevel = 7;
    rfb.compressionLevel = 2;
    const connected = () => status.current("connected");
    const disconnected = () => status.current("disconnected");
    rfb.addEventListener("connect", connected);
    rfb.addEventListener("disconnect", disconnected);
    return () => {
      rfbRef.current = null;
      rfb.removeEventListener("connect", connected);
      rfb.removeEventListener("disconnect", disconnected);
      rfb.disconnect();
    };
  }, [session]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = !interactive;
    rfb.focusOnClick = interactive;
    if (interactive) {
      rfb.resizeSession = true;
      rfb.focus({ preventScroll: true });
    } else {
      rfb.blur();
    }
  }, [interactive]);

  return (
    <div
      ref={host}
      className="cloud-screen-viewer"
      data-interactive={interactive ? "true" : "false"}
    />
  );
}
