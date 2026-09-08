import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  classifyReferenceDataTransfer,
  hasFileReferenceDataTransferSource,
} from "@puppyone/shared-ui";
import type { TerminalRuntimeHandle } from "../runtime/terminalRuntime";
import { useLocalization } from "@puppyone/localization";
import { quoteTerminalPaths, resolveTerminalDropPaths } from "../interactions/terminalResourceDrop";

type TerminalSessionViewProps = {
  focused: boolean;
  labelledBy?: string;
  onFocus?: () => void;
  panelId?: string;
  presented: boolean;
  runtime: TerminalRuntimeHandle;
  workspacePath: string;
};

const SCROLLBAR_REPEAT_DELAY_MS = 320;
const SCROLLBAR_REPEAT_INTERVAL_MS = 54;

export function TerminalSessionView({
  focused,
  labelledBy,
  onFocus,
  panelId,
  presented,
  runtime,
  workspacePath,
}: TerminalSessionViewProps) {
  const { t } = useLocalization();
  const [dropFailed, setDropFailed] = useState(false);
  const dropEpoch = useRef(0);
  useEffect(() => () => { dropEpoch.current += 1; }, [runtime, workspacePath]);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const scrollbarDragRef = useRef<{ pointerId: number; offset: number } | null>(null);
  const repeatDelayRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);
  const [ready, setReady] = useState(runtime.ready);
  const [scrollbarState, setScrollbarState] = useState(runtime.scrollbarState);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const unsubscribeReady = runtime.subscribeReady(setReady);
    const unsubscribeScrollbar = runtime.subscribeScrollbar(setScrollbarState);
    runtime.mount(container);
    return () => {
      unsubscribeReady();
      unsubscribeScrollbar();
      runtime.unmount(container);
    };
  }, [runtime]);

  useLayoutEffect(() => {
    runtime.setPresented(presented);
    runtime.setFocused(focused);
  }, [focused, presented, runtime]);

  const stopScrollbarRepeat = useCallback(() => {
    if (repeatDelayRef.current !== null) window.clearTimeout(repeatDelayRef.current);
    if (repeatIntervalRef.current !== null) window.clearInterval(repeatIntervalRef.current);
    repeatDelayRef.current = null;
    repeatIntervalRef.current = null;
  }, []);

  useEffect(() => stopScrollbarRepeat, [stopScrollbarRepeat]);

  const beginScrollbarScroll = useCallback((
    event: ReactPointerEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    stopScrollbarRepeat();
    const scroll = () => runtime.scrollLines(direction);
    scroll();
    repeatDelayRef.current = window.setTimeout(() => {
      repeatIntervalRef.current = window.setInterval(scroll, SCROLLBAR_REPEAT_INTERVAL_MS);
    }, SCROLLBAR_REPEAT_DELAY_MS);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [runtime, stopScrollbarRepeat]);

  const scrollToPointer = useCallback((clientY: number, pointerOffset: number) => {
    const track = scrollbarTrackRef.current;
    const thumb = track?.querySelector<HTMLElement>(".desktop-terminal-classic-scrollbar-thumb");
    if (!track || !thumb) return;
    const trackRect = track.getBoundingClientRect();
    const thumbRect = thumb.getBoundingClientRect();
    const travel = Math.max(0, trackRect.height - thumbRect.height);
    const offset = Math.min(travel, Math.max(0, clientY - trackRect.top - pointerOffset));
    runtime.scrollToRatio(travel > 0 ? offset / travel : 0);
  }, [runtime]);

  const handleScrollbarTrackPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const thumb = event.currentTarget.querySelector<HTMLElement>(
      ".desktop-terminal-classic-scrollbar-thumb",
    );
    scrollToPointer(event.clientY, (thumb?.getBoundingClientRect().height ?? 0) / 2);
  }, [scrollToPointer]);

  const handleScrollbarThumbPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    scrollbarDragRef.current = {
      pointerId: event.pointerId,
      offset: event.clientY - event.currentTarget.getBoundingClientRect().top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleScrollbarThumbPointerMove = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const drag = scrollbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    scrollToPointer(event.clientY, drag.offset);
  }, [scrollToPointer]);

  const stopScrollbarDrag = useCallback(() => {
    scrollbarDragRef.current = null;
  }, []);

  const handleTerminalDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasTerminalDroppablePaths(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleTerminalDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const source = classifyReferenceDataTransfer(event.dataTransfer);
    if (source.kind !== "workspace-entries" && source.kind !== "files") return;
    event.preventDefault();
    event.stopPropagation();
    const epoch = dropEpoch.current;
    setDropFailed(false);
    void resolveTerminalDropPaths(source, workspacePath).then((paths) => {
      if (epoch !== dropEpoch.current || paths.length === 0) return;
      runtime.write(quoteTerminalPaths(paths, runtime.inputShell ?? ""));
      onFocus?.();
      runtime.focus();
    }).catch(() => {
      if (epoch === dropEpoch.current) setDropFailed(true);
    });
  }, [onFocus, runtime, workspacePath]);

  return (
    <div
      id={panelId}
      className={`desktop-terminal-session ${presented ? "is-presented" : ""} ${focused ? "is-focused" : ""} ${ready ? "is-ready" : ""}`}
      role={panelId ? "region" : undefined}
      aria-labelledby={labelledBy}
      aria-hidden={!presented}
      aria-busy={presented && !ready}
      onFocusCapture={onFocus}
      onPointerDownCapture={onFocus}
    >
      {dropFailed && <div className="desktop-terminal-drop-error" role="alert">{t("terminal.dropFailed")}</div>}
      <div
        className="desktop-terminal-xterm"
        dir="ltr"
        ref={containerRef}
        onDragOver={handleTerminalDragOver}
        onDrop={handleTerminalDrop}
      >
        <div
          className="desktop-terminal-classic-scrollbar-controls"
          data-visible={scrollbarState.visible ? "true" : "false"}
          aria-hidden="true"
          style={{
            "--desktop-terminal-scrollbar-position": scrollbarState.position,
            "--desktop-terminal-scrollbar-viewport-ratio": scrollbarState.viewportRatio,
          } as CSSProperties}
        >
          <button
            className="desktop-terminal-classic-scrollbar-button decrement"
            type="button"
            tabIndex={-1}
            disabled={!scrollbarState.canDecrement}
            onPointerDown={(event) => beginScrollbarScroll(event, -1)}
            onPointerUp={stopScrollbarRepeat}
            onPointerCancel={stopScrollbarRepeat}
            onLostPointerCapture={stopScrollbarRepeat}
          />
          <div
            ref={scrollbarTrackRef}
            className="desktop-terminal-classic-scrollbar-track"
            onPointerDown={handleScrollbarTrackPointerDown}
          >
            <div
              className="desktop-terminal-classic-scrollbar-thumb"
              onPointerDown={handleScrollbarThumbPointerDown}
              onPointerMove={handleScrollbarThumbPointerMove}
              onPointerUp={stopScrollbarDrag}
              onPointerCancel={stopScrollbarDrag}
              onLostPointerCapture={stopScrollbarDrag}
            />
          </div>
          <button
            className="desktop-terminal-classic-scrollbar-button increment"
            type="button"
            tabIndex={-1}
            disabled={!scrollbarState.canIncrement}
            onPointerDown={(event) => beginScrollbarScroll(event, 1)}
            onPointerUp={stopScrollbarRepeat}
            onPointerCancel={stopScrollbarRepeat}
            onLostPointerCapture={stopScrollbarRepeat}
          />
        </div>
      </div>
    </div>
  );
}

function hasTerminalDroppablePaths(dataTransfer: DataTransfer) {
  return hasFileReferenceDataTransferSource(dataTransfer);
}
