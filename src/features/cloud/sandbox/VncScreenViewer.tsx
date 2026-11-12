import { useEffect, useRef } from "react";
import RFB from "@novnc/novnc";
import type { CloudScreenViewerProps } from "./screenTransports";

/**
 * noVNC over the backend's ticketed WebSocket. The remote display follows the
 * editor area (resizeSession), and clicking the screen sends keyboard input to
 * the Cloud Computer. Clipboard contents are never exchanged automatically.
 */
export function VncScreenViewer({ session, onStatus }: CloudScreenViewerProps) {
  const host = useRef<HTMLDivElement>(null);
  const status = useRef(onStatus);
  status.current = onStatus;

  useEffect(() => {
    const target = host.current;
    if (!target) return;
    status.current("connecting");
    const rfb = new RFB(target, session.url, { shared: true, wsProtocols: session.protocols });
    rfb.scaleViewport = true;
    rfb.resizeSession = true;
    rfb.focusOnClick = true;
    rfb.background = "transparent";
    rfb.qualityLevel = 7;
    rfb.compressionLevel = 2;
    const connected = () => status.current("connected");
    const disconnected = () => status.current("disconnected");
    rfb.addEventListener("connect", connected);
    rfb.addEventListener("disconnect", disconnected);
    return () => {
      rfb.removeEventListener("connect", connected);
      rfb.removeEventListener("disconnect", disconnected);
      rfb.disconnect();
    };
  }, [session]);

  return <div ref={host} className="cloud-screen-viewer" />;
}
