import { bidiIsolate, type MessageFormatter } from "@puppyone/localization/core";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal, type IDisposable } from "@xterm/xterm";
import type { TerminalCreateRequest, TerminalDataEvent } from "../../../types/electron";
import type { DesktopTerminalSessionStatus } from "../model/terminalSessions";
import type { DesktopTerminalLauncherId } from "../model/terminalLaunchers";
import { unwrapProjectSessionResult } from "../../../../shared/project-session-contract/schema.mjs";
import {
  applyTerminalAppearance,
  type TerminalAppearance,
  type TerminalDefaultColors,
} from "./terminalAppearance";
import { TerminalActivityController } from "./terminalActivity";
import { restoreXtermCheckpoint } from "../../../../shared/terminal-contract/xterm-checkpoint.mjs";

type TerminalSize = {
  cols: number;
  rows: number;
};

type TerminalExit = {
  code: number | null;
  signal: string | null;
};

export type TerminalMinimumViewportSize = Readonly<{
  width: number;
  height: number;
}>;

export type TerminalScrollbarState = {
  visible: boolean;
  canDecrement: boolean;
  canIncrement: boolean;
  position: number;
  viewportRatio: number;
};

const TERMINAL_COLUMNS_MIN = 20;
const TERMINAL_COLUMNS_MAX = 400;
const TERMINAL_ROWS_MIN = 8;
const TERMINAL_ROWS_MAX = 120;

const INITIAL_SCROLLBAR_STATE: TerminalScrollbarState = {
  visible: false,
  canDecrement: false,
  canIncrement: false,
  position: 0,
  viewportRatio: 1,
};

type TerminalRuntimeOptions = {
  bridge?: TerminalBridge;
  appearance: TerminalAppearance;
  projectContext?: import("../../../../shared/project-session-contract/types").ProjectSessionContext;
  sessionId: string;
  launcherId: DesktopTerminalLauncherId;
  workspacePath: string;
  getMessageFormatter: () => MessageFormatter;
  onStatus: (
    sessionId: string,
    status: DesktopTerminalSessionStatus,
    shell?: string | null,
    error?: string | null,
  ) => void;
};

export type TerminalDisplayData = TerminalDataEvent & { reset?: boolean; cols?: number; rows?: number; checkpointState?: unknown; acknowledge?: () => void };
export type TerminalBridge = Pick<NonNullable<Window["puppyoneDesktop"]>, "createTerminal" | "writeTerminal" | "resizeTerminal" | "updateTerminalAppearance" | "closeTerminal" | "onTerminalExit" | "openExternalUrl"> & {
  canonicalOutput?: boolean;
  onTerminalData: (callback: (event: TerminalDisplayData) => void) => () => void;
};

type TerminalPtyRequestOptions = Readonly<{
  sessionId: string;
  launcherId: DesktopTerminalLauncherId;
  workspacePath: string;
  cols: number;
  rows: number;
  defaultColors: TerminalDefaultColors | null;
}>;

/**
 * Builds the renderer-to-main process capability request for one PTY.
 *
 * Keeping this boundary pure and directly testable prevents a multi-Root
 * window from silently falling back to an ambiguous workspace selection when
 * several Terminal Tabs are started together.
 */
export function createTerminalPtyRequest({
  sessionId,
  launcherId,
  workspacePath,
  cols,
  rows,
  defaultColors,
}: TerminalPtyRequestOptions): TerminalCreateRequest {
  return {
    id: sessionId,
    rootPath: workspacePath,
    cwd: workspacePath,
    cols,
    rows,
    launcherId,
    defaultColors: defaultColors ?? undefined,
  };
}

export interface TerminalRuntimeHandle {
  readonly inputShell?: string;
  readonly activity: boolean;
  readonly ready: boolean;
  readonly scrollbarState: TerminalScrollbarState;
  applyAppearance: (appearance?: TerminalAppearance) => void;
  dispose: () => void;
  close?: () => Promise<void>;
  focus: () => void;
  getMinimumViewportSize: () => TerminalMinimumViewportSize;
  mount: (container: HTMLDivElement) => void;
  scrollLines: (direction: -1 | 1) => void;
  scrollToRatio: (ratio: number) => void;
  unmount: (container: HTMLDivElement) => void;
  setFocused: (focused: boolean) => void;
  setPresented: (presented: boolean) => void;
  subscribeActivity: (listener: (active: boolean) => void) => () => void;
  subscribeReady: (listener: (ready: boolean) => void) => () => void;
  subscribeScrollbar: (listener: (state: TerminalScrollbarState) => void) => () => void;
  write: (data: string) => void;
}

export class TerminalRuntime implements TerminalRuntimeHandle {
  private readonly bridge: TerminalBridge | undefined;
  inputShell = "";
  private appearance: TerminalAppearance;
  private readonly projectContext: TerminalRuntimeOptions["projectContext"];
  private instanceId: string | undefined;
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private readonly sessionId: string;
  private readonly launcherId: DesktopTerminalLauncherId;
  private readonly workspacePath: string;
  private readonly getMessageFormatter: () => MessageFormatter;
  private readonly onStatus: TerminalRuntimeOptions["onStatus"];
  private readonly activityController: TerminalActivityController;
  private readonly activityListeners = new Set<(active: boolean) => void>();
  private readonly readyListeners = new Set<(ready: boolean) => void>();
  private readonly scrollbarListeners = new Set<(state: TerminalScrollbarState) => void>();
  private readonly disposables: IDisposable[] = [];
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private unicode11Addon: Unicode11Addon | null = null;
  private webglAddon: WebglAddon | null = null;
  private webglContextLossDisposable: IDisposable | null = null;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private terminalSidebarElement: Element | null = null;
  private sidebarTransitionEndListener: ((event: Event) => void) | null = null;
  private removeDataListener: (() => void) | null = null;
  private removeExitListener: (() => void) | null = null;
  private fitFrame: number | null = null;
  private revealFrame: number | null = null;
  private scrollbarIdleTimer: number | null = null;
  private pendingPtySize: TerminalSize | null = null;
  private lastPtySize: TerminalSize | null = null;
  private defaultColors: TerminalDefaultColors | null = null;
  private ptyReady = false;
  private pendingExit: TerminalExit | null = null;
  private presented = false;
  private focused = false;
  private hasBeenPresented = false;
  private disposed = false;
  private viewReady = false;
  private currentScrollbarState = INITIAL_SCROLLBAR_STATE;
  private measuredCellWidth = 8;
  private measuredCellHeight = 16;

  constructor({
    bridge = window.puppyoneDesktop,
    appearance,
    projectContext,
    sessionId,
    launcherId,
    workspacePath,
    getMessageFormatter,
    onStatus,
  }: TerminalRuntimeOptions) {
    this.bridge = bridge;
    this.appearance = appearance;
    this.projectContext = projectContext;
    this.sessionId = sessionId;
    this.launcherId = launcherId;
    this.workspacePath = workspacePath;
    this.getMessageFormatter = getMessageFormatter;
    this.onStatus = onStatus;
    this.activityController = new TerminalActivityController({
      launcherId,
      onChange: (activity) => {
        this.activityListeners.forEach((listener) => listener(activity));
      },
    });
  }

  get activity() {
    return this.activityController.active;
  }

  get ready() {
    return this.viewReady;
  }

  get scrollbarState() {
    return this.currentScrollbarState;
  }

  mount(container: HTMLDivElement) {
    if (this.disposed) return;
    if (this.container === container) return;
    if (this.container) this.unmount(this.container);
    this.container = container;
    if (this.terminal) {
      const terminalElement = this.terminal.element;
      if (terminalElement && terminalElement.parentElement !== container) {
        container.appendChild(terminalElement);
      }
      this.observeSize(container);
      this.observeSidebarTransition(container);
      this.applyAppearance();
      this.syncScrollbarPresentation();
      this.scheduleFit();
      return;
    }
    this.initializeTerminal(container);
  }

  unmount(container: HTMLDivElement) {
    if (this.disposed || this.container !== container) return;
    this.presented = false;
    this.focused = false;
    this.stopObservingContainer();
    this.container = null;
  }

  setPresented(presented: boolean) {
    if (this.disposed || this.presented === presented) return;
    this.presented = presented;
    if (!presented) {
      if (this.fitFrame !== null) cancelAnimationFrame(this.fitFrame);
      this.fitFrame = null;
      return;
    }
    const reactivating = this.hasBeenPresented;
    this.hasBeenPresented = true;
    if (reactivating) this.activityController.beginPresentationRefresh();
    this.scheduleFit();
    if (this.focused) this.requestFocus();
  }

  setFocused(focused: boolean) {
    if (this.disposed || this.focused === focused) return;
    this.focused = focused;
    if (focused && this.presented) this.requestFocus();
  }

  focus() {
    if (!this.disposed) this.terminal?.focus();
  }

  getMinimumViewportSize(): TerminalMinimumViewportSize {
    this.updateMeasuredCellSize();
    return {
      width: Math.ceil(this.measuredCellWidth * TERMINAL_COLUMNS_MIN + 12),
      height: Math.ceil(this.measuredCellHeight * TERMINAL_ROWS_MIN),
    };
  }

  scrollLines(direction: -1 | 1) {
    if (this.disposed) return;
    this.terminal?.scrollLines(direction);
  }

  scrollToRatio(ratio: number) {
    if (this.disposed || !this.terminal) return;
    const maximumViewportY = Math.max(0, this.terminal.buffer.active.baseY);
    const nextViewportY = Math.round(
      maximumViewportY * Math.min(1, Math.max(0, ratio)),
    );
    this.terminal.scrollToLine(nextViewportY);
  }

  write(data: string) {
    if (this.disposed || data.length === 0) return;
    this.bridge?.writeTerminal?.({
      ...this.requestIdentity(),
      data,
    });
  }

  subscribeReady(listener: (ready: boolean) => void) {
    this.readyListeners.add(listener);
    listener(this.viewReady);
    return () => this.readyListeners.delete(listener);
  }

  subscribeActivity(listener: (active: boolean) => void) {
    this.activityListeners.add(listener);
    listener(this.activityController.active);
    return () => this.activityListeners.delete(listener);
  }

  subscribeScrollbar(listener: (state: TerminalScrollbarState) => void) {
    this.scrollbarListeners.add(listener);
    listener(this.currentScrollbarState);
    return () => this.scrollbarListeners.delete(listener);
  }

  applyAppearance(appearance = this.appearance) {
    if (this.disposed) return;
    this.appearance = appearance;
    if (!this.terminal) return;
    this.defaultColors = applyTerminalAppearance(this.terminal, appearance);
    this.syncDefaultColorsToPty();
    this.syncScrollbarPresentation();
    this.scheduleFit();
  }

  private requestIdentity() {
    return { id: this.sessionId, ...(this.instanceId ? { instanceId: this.instanceId } : {}), ...(this.projectContext ? { projectContext: this.projectContext } : {}) };
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closePromise = (async () => {
      await this.startPromise;
      if (this.instanceId || (!this.projectContext && this.ptyReady)) {
        const bridge = this.bridge;
        if (!bridge?.closeTerminal) throw new Error(this.message("terminal.bridgeUnavailable"));
        unwrapProjectSessionResult(await bridge.closeTerminal(this.requestIdentity()));
      }
      this.dispose();
    })().finally(() => { this.closePromise = null; });
    return this.closePromise;
  }

  /** Releases the local screen after its project confirms native shutdown. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ptyReady = false;
    this.pendingExit = null;
    this.pendingPtySize = null;
    this.lastPtySize = null;
    this.setReady(false);
    this.activityController.dispose();
    this.activityListeners.clear();
    this.readyListeners.clear();
    this.currentScrollbarState = INITIAL_SCROLLBAR_STATE;
    this.scrollbarListeners.clear();

    if (this.fitFrame !== null) cancelAnimationFrame(this.fitFrame);
    if (this.revealFrame !== null) cancelAnimationFrame(this.revealFrame);
    if (this.scrollbarIdleTimer !== null) window.clearTimeout(this.scrollbarIdleTimer);
    this.fitFrame = null;
    this.revealFrame = null;
    this.scrollbarIdleTimer = null;
    this.container?.classList.remove("po-scrollbar-active");
    this.stopObservingContainer();
    this.removeDataListener?.();
    this.removeExitListener?.();
    this.removeDataListener = null;
    this.removeExitListener = null;
    safeDispose(this.webglContextLossDisposable);
    safeDispose(this.webglAddon);
    safeDispose(this.unicode11Addon);
    this.webglContextLossDisposable = null;
    this.webglAddon = null;
    this.unicode11Addon = null;
    this.disposables.splice(0).forEach(safeDispose);
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    this.container = null;
  }

  private initializeTerminal(container: HTMLDivElement) {
    const { theme, fontFamily, fontSize, defaultColors } = this.appearance;
    const terminal = new Terminal({
      allowProposedApi: true,
      customGlyphs: true,
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: true,
      fontFamily,
      fontSize,
      fontWeight: 450,
      fontWeightBold: 700,
      letterSpacing: 0,
      lineHeight: 1.24,
      linkHandler: {
        activate: (_event, href) => this.openExternalUrl(href),
        allowNonHttpProtocols: false,
      },
      rescaleOverlappingGlyphs: true,
      scrollback: 6000,
      theme,
    });
    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();

    this.terminal = terminal;
    if (this.bridge?.canonicalOutput) this.disposables.push(...suppressDisplayProtocolResponses(terminal));
    this.fitAddon = fitAddon;
    this.unicode11Addon = unicode11Addon;
    this.defaultColors = defaultColors;

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(unicode11Addon);
    terminal.loadAddon(new WebLinksAddon((_event, href) => this.openExternalUrl(href)));
    activateUnicode11(terminal);
    this.disposables.push(
      terminal.onRender(() => {
        this.setReady(true);
        this.syncScrollbarPresentation();
      }),
      terminal.onData((data) => this.write(data)),
      terminal.onResize(() => this.syncScrollbarPresentation()),
      terminal.onScroll(() => {
        this.markScrollbarActive();
        this.syncScrollbarPresentation();
      }),
      terminal.onTitleChange((title) => this.activityController.noteTitle(title)),
    );
    terminal.open(container);
    this.loadWebglRenderer();
    this.fitNow();
    this.setReady(true);
    this.observeSize(container);
    this.observeSidebarTransition(container);
    this.subscribeBridge();

    this.revealFrame = requestAnimationFrame(() => {
      this.revealFrame = null;
      if (this.disposed) return;
      this.fitNow();
      if (this.presented && this.focused) terminal.focus();
    });

    void document.fonts?.ready.then(() => {
      if (!this.disposed) this.scheduleFit();
    });

    this.startPty();
  }

  private markScrollbarActive() {
    const container = this.container;
    if (!container) return;
    container.classList.add("po-scrollbar-active");
    if (this.scrollbarIdleTimer !== null) window.clearTimeout(this.scrollbarIdleTimer);
    this.scrollbarIdleTimer = window.setTimeout(() => {
      this.scrollbarIdleTimer = null;
      container.classList.remove("po-scrollbar-active");
    }, 900);
  }

  private syncScrollbarPresentation() {
    const terminal = this.terminal;
    if (!terminal) return;

    const buffer = terminal.buffer.active;
    const totalLineCount = Math.max(terminal.rows, buffer.length);
    const maximumViewportY = Math.max(0, buffer.baseY);
    const nextState: TerminalScrollbarState = {
      visible: maximumViewportY > 0,
      canDecrement: buffer.viewportY > 0,
      canIncrement: buffer.viewportY < maximumViewportY,
      position: maximumViewportY > 0
        ? Math.min(1, Math.max(0, buffer.viewportY / maximumViewportY))
        : 0,
      viewportRatio: Math.min(1, terminal.rows / totalLineCount),
    };
    if (sameTerminalScrollbarState(this.currentScrollbarState, nextState)) return;
    this.currentScrollbarState = nextState;
    this.scrollbarListeners.forEach((listener) => listener(nextState));
  }

  private subscribeBridge() {
    const bridge = this.bridge;
    if (!bridge?.onTerminalData || !bridge.onTerminalExit) return;

    this.removeDataListener = bridge.onTerminalData((event) => {
      if (event.id !== this.sessionId || this.disposed) return;
      if (this.instanceId && event.instanceId && event.instanceId !== this.instanceId) return;
      this.activityController.noteOutput(event.data);
      const terminal = this.terminal;
      if (!terminal) return;
      if (event.reset) terminal.reset();
      if (event.cols && event.rows) terminal.resize(event.cols, event.rows);
      terminal.write(event.data, () => {
        if (event.checkpointState) restoreXtermCheckpoint(terminal, event.checkpointState);
        event.acknowledge?.();
      });
    });
    this.removeExitListener = bridge.onTerminalExit((event) => {
      if (event.id !== this.sessionId || this.disposed) return;
      if (this.instanceId && event.instanceId && event.instanceId !== this.instanceId) return;
      const terminalExit = { code: event.code, signal: event.signal };
      if (!this.ptyReady) {
        this.pendingExit = terminalExit;
        return;
      }
      this.handleExit(terminalExit);
    });
  }

  private startPty() {
    const bridge = this.bridge;
    this.onStatus(this.sessionId, "starting");
    if (!bridge?.createTerminal || !bridge.writeTerminal || !bridge.resizeTerminal) {
      const errorMessage = this.message("terminal.bridgeUnavailable");
      this.writeSystemLine(errorMessage);
      this.onStatus(this.sessionId, "error", undefined, errorMessage);
      return;
    }

    const terminal = this.terminal;
    if (!terminal) return;
    this.startPromise = bridge.createTerminal({ ...createTerminalPtyRequest({
      sessionId: this.sessionId,
      workspacePath: this.workspacePath,
      cols: terminal.cols,
      rows: terminal.rows,
      launcherId: this.launcherId,
      defaultColors: this.defaultColors,
    }), ...(this.projectContext ? { projectContext: this.projectContext } : {}) }).then(unwrapProjectSessionResult).then((result) => {
      this.instanceId = result.instanceId;
      if (this.disposed) {
        void bridge.closeTerminal(this.requestIdentity()).catch(() => {});
        return;
      }
      this.ptyReady = true;
      this.inputShell = result.inputShell;
      this.syncDefaultColorsToPty();
      this.onStatus(this.sessionId, "running", result.shell);
      this.syncSizeToPty(this.pendingPtySize ?? {
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (this.pendingExit) {
        const pendingExit = this.pendingExit;
        this.pendingExit = null;
        this.handleExit(pendingExit);
        return;
      }
      if (this.presented && this.focused) terminal.focus();
    }).catch((error) => {
      if (this.disposed) return;
      this.pendingExit = null;
      const errorMessage = this.launcherId === "shell"
        ? formatTerminalError(error, this.getMessageFormatter())
        : formatTerminalLaunchError(error, this.getMessageFormatter());
      this.onStatus(this.sessionId, "error", undefined, errorMessage);
      this.writeSystemLine(errorMessage);
    });
  }

  private syncDefaultColorsToPty() {
    if (!this.ptyReady || !this.defaultColors) return;
    this.bridge?.updateTerminalAppearance?.({
      ...this.requestIdentity(),
      defaultColors: this.defaultColors,
    });
  }

  private handleExit(event: TerminalExit) {
    this.activityController.reset();
    const exitText = event.signal
      ? this.message("terminal.processExitedSignal", { signal: bidiIsolate(event.signal) })
      : this.message("terminal.processExitedCode", { code: event.code ?? 0 });
    this.terminal?.writeln(`\r\n\x1b[38;5;244m${exitText}\x1b[0m`);
    this.ptyReady = false;
    this.onStatus(this.sessionId, "exited");
  }

  private observeSize(container: HTMLDivElement) {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.presented) this.scheduleFit();
    });
    this.resizeObserver.observe(container);
  }

  private observeSidebarTransition(container: HTMLDivElement) {
    if (this.terminalSidebarElement && this.sidebarTransitionEndListener) {
      this.terminalSidebarElement.removeEventListener(
        "transitionend",
        this.sidebarTransitionEndListener,
      );
    }
    this.terminalSidebarElement = container.closest(".desktop-right-sidebar");
    if (!this.terminalSidebarElement) return;
    this.sidebarTransitionEndListener = (event: Event) => {
      const transitionEvent = event as TransitionEvent;
      if (transitionEvent.target !== this.terminalSidebarElement) return;
      if (transitionEvent.propertyName !== "width" && transitionEvent.propertyName !== "flex-basis") {
        return;
      }
      if (this.presented) this.scheduleFit();
    };
    this.terminalSidebarElement.addEventListener(
      "transitionend",
      this.sidebarTransitionEndListener,
    );
  }

  private stopObservingContainer() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.terminalSidebarElement && this.sidebarTransitionEndListener) {
      this.terminalSidebarElement.removeEventListener(
        "transitionend",
        this.sidebarTransitionEndListener,
      );
    }
    this.terminalSidebarElement = null;
    this.sidebarTransitionEndListener = null;
  }

  private scheduleFit() {
    if (this.disposed || !this.presented || this.fitFrame !== null) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = null;
      if (this.presented) this.fitNow();
    });
  }

  private fitNow() {
    const terminal = this.terminal;
    const fitAddon = this.fitAddon;
    const container = this.container;
    if (!terminal || !fitAddon || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    try {
      fitAddon.fit();
    } catch {
      return;
    }
    const cols = clampInteger(terminal.cols, TERMINAL_COLUMNS_MIN, TERMINAL_COLUMNS_MAX);
    const rows = clampInteger(terminal.rows, TERMINAL_ROWS_MIN, TERMINAL_ROWS_MAX);
    if (cols !== terminal.cols || rows !== terminal.rows) terminal.resize(cols, rows);
    this.updateMeasuredCellSize();
    this.syncSizeToPty({ cols, rows });
  }

  private updateMeasuredCellSize() {
    const terminal = this.terminal;
    const screen = terminal?.element?.querySelector<HTMLElement>(".xterm-screen");
    const rect = screen?.getBoundingClientRect();
    if (!terminal || !rect || rect.width <= 0 || rect.height <= 0) return;
    if (terminal.cols > 0) this.measuredCellWidth = rect.width / terminal.cols;
    if (terminal.rows > 0) this.measuredCellHeight = rect.height / terminal.rows;
  }

  private syncSizeToPty(size: TerminalSize) {
    this.pendingPtySize = size;
    if (!this.ptyReady || this.disposed) return;
    if (sameTerminalSize(this.lastPtySize, size)) return;
    const bridge = this.bridge;
    if (!bridge?.resizeTerminal) return;
    const resizingExistingPty = this.lastPtySize !== null;
    this.lastPtySize = size;
    if (resizingExistingPty) this.activityController.beginPresentationRefresh();
    bridge.resizeTerminal({
      ...this.requestIdentity(),
      cols: size.cols,
      rows: size.rows,
    });
  }

  private loadWebglRenderer() {
    const terminal = this.terminal;
    if (!terminal) return;
    try {
      const addon = new WebglAddon();
      const contextLossDisposable = addon.onContextLoss(() => {
        safeDispose(this.webglContextLossDisposable);
        safeDispose(this.webglAddon);
        this.webglContextLossDisposable = null;
        this.webglAddon = null;
        this.scheduleFit();
      });
      terminal.loadAddon(addon);
      this.webglAddon = addon;
      this.webglContextLossDisposable = contextLossDisposable;
    } catch {
      safeDispose(this.webglContextLossDisposable);
      safeDispose(this.webglAddon);
      this.webglContextLossDisposable = null;
      this.webglAddon = null;
    }
  }

  private requestFocus() {
    requestAnimationFrame(() => {
      if (!this.disposed && this.presented && this.focused) this.terminal?.focus();
    });
  }

  private openExternalUrl(href: string) {
    const bridge = this.bridge;
    if (!bridge?.openExternalUrl) {
      this.writeSystemLine(this.message("terminal.bridgeUnavailable"));
      return;
    }
    void bridge.openExternalUrl(href).catch((error) => {
      this.writeSystemLine(formatTerminalError(error, this.getMessageFormatter()));
    });
  }

  private writeSystemLine(message: string) {
    this.terminal?.writeln(`\x1b[38;5;244m${message}\x1b[0m`);
  }

  private message(key: Parameters<MessageFormatter>[0], params?: Parameters<MessageFormatter>[1]) {
    return this.getMessageFormatter()(key, params);
  }

  private setReady(ready: boolean) {
    if (this.viewReady === ready) return;
    this.viewReady = ready;
    this.readyListeners.forEach((listener) => listener(ready));
  }

}

/** The utility's canonical parser alone answers device/window/status queries. */
function suppressDisplayProtocolResponses(terminal: Terminal): IDisposable[] {
  return [
    ...["c", "n"].flatMap((final) => [undefined, "?", ">", "="].map((prefix) => terminal.parser.registerCsiHandler({ final, prefix }, () => true))),
    ...[undefined, "?"].map((prefix) => terminal.parser.registerCsiHandler({ final: "p", intermediates: "$", prefix }, () => true)),
    terminal.parser.registerCsiHandler({ final: "t" }, () => true),
    terminal.parser.registerDcsHandler({ final: "q", intermediates: "$" }, () => true),
  ];
}

function clampInteger(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function sameTerminalSize(left: TerminalSize | null, right: TerminalSize) {
  return left?.cols === right.cols && left.rows === right.rows;
}

function sameTerminalScrollbarState(
  left: TerminalScrollbarState,
  right: TerminalScrollbarState,
) {
  return left.visible === right.visible
    && left.canDecrement === right.canDecrement
    && left.canIncrement === right.canIncrement
    && left.position === right.position
    && left.viewportRatio === right.viewportRatio;
}

function activateUnicode11(terminal: Terminal) {
  try {
    terminal.unicode.activeVersion = "11";
  } catch {
    // Keep the terminal usable if the proposed Unicode API is unavailable.
  }
}

function safeDispose(disposable: { dispose: () => void } | null | undefined) {
  try {
    disposable?.dispose();
  } catch {
    // Disposal should never break terminal teardown.
  }
}

function formatTerminalError(error: unknown, t: MessageFormatter) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No handler registered for 'terminal:create'")) {
    return t("terminal.runtimeRestartRequired");
  }
  return t("terminal.errorDetail", { detail: bidiIsolate(message) });
}

function formatTerminalLaunchError(error: unknown, t: MessageFormatter) {
  if (messageFrom(error).includes("No handler registered for 'terminal:create'")) {
    return t("terminal.runtimeRestartRequired");
  }
  return formatAgentLaunchError(error, t);
}

function formatAgentLaunchError(error: unknown, t: MessageFormatter) {
  const message = messageFrom(error);
  if (message.includes("TERMINAL_AGENT_UNAVAILABLE")) {
    return t("terminal.launcher.agentUnavailable");
  }
  if (message.includes("TERMINAL_AGENT_START_FAILED")) {
    return t("terminal.launcher.agentStartFailed");
  }
  return t("terminal.launcher.agentStartFailed");
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
