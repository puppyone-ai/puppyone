import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { EXPLORER_TREE_NODE_DRAG_TYPE, type Workspace } from "@puppyone/shared-ui";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

type RightTerminalPanelProps = {
  workspace: Workspace;
  active: boolean;
};

export function RightTerminalPanel({ workspace, active }: RightTerminalPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const activeRef = useRef(active);
  const [hasStarted, setHasStarted] = useState(active);

  const handleTerminalDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasExplorerNodePath(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleTerminalDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const nodePath = readExplorerNodePath(event.dataTransfer);
    if (!nodePath) return;

    event.preventDefault();
    event.stopPropagation();

    const sessionId = sessionIdRef.current;
    const bridge = window.puppyoneDesktop;
    if (!sessionId || !bridge?.writeTerminal) return;

    bridge.writeTerminal({
      id: sessionId,
      data: shellQuotePath(joinWorkspacePath(workspace.path, nodePath)),
    });
    terminalRef.current?.focus();
  }, [workspace.path]);

  useEffect(() => {
    activeRef.current = active;
    if (active) setHasStarted(true);
  }, [active]);

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !bodyRef.current) return;

    try {
      fitAddon.fit();
    } catch {
      return;
    }

    const sessionId = sessionIdRef.current;
    if (sessionId && window.puppyoneDesktop?.resizeTerminal) {
      window.puppyoneDesktop.resizeTerminal({
        id: sessionId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    }
  }, []);

  useEffect(() => {
    if (!hasStarted || !containerRef.current) return undefined;

    let disposed = false;
    const bridge = window.puppyoneDesktop;
    const terminalTheme = readTerminalTheme(containerRef.current);
    const terminal = new Terminal({
      customGlyphs: true,
      cursorBlink: true,
      cursorStyle: "block",
      convertEol: true,
      fontFamily: '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      fontWeight: 450,
      fontWeightBold: 700,
      letterSpacing: 0,
      lineHeight: 1.24,
      scrollback: 6000,
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    const sessionId = createTerminalId();
    const disposables: Array<{ dispose: () => void }> = [];
    let removeDataListener: (() => void) | undefined;
    let removeExitListener: (() => void) | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let fitTimer: number | undefined;

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    sessionIdRef.current = sessionId;

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    const writeSystemLine = (message: string) => {
      terminal.writeln(`\x1b[38;5;244m${message}\x1b[0m`);
    };

    if (!bridge?.createTerminal || !bridge.writeTerminal || !bridge.onTerminalData || !bridge.onTerminalExit) {
      writeSystemLine("Terminal bridge unavailable. Open this workspace in puppyone.");
      return () => {
        disposed = true;
        disposables.forEach((disposable) => disposable.dispose());
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
        sessionIdRef.current = null;
      };
    }

    removeDataListener = bridge.onTerminalData((event) => {
      if (event.id !== sessionId || disposed) return;
      terminal.write(event.data);
    });

    removeExitListener = bridge.onTerminalExit((event) => {
      if (event.id !== sessionId || disposed) return;
      const exitText = event.signal ? `signal ${event.signal}` : `code ${event.code ?? 0}`;
      terminal.writeln(`\r\n\x1b[38;5;244mProcess exited with ${exitText}.\x1b[0m`);
    });

    disposables.push(terminal.onData((data) => {
      bridge.writeTerminal({
        id: sessionId,
        data,
      });
    }));

    if (bodyRef.current) {
      resizeObserver = new ResizeObserver(() => {
        if (activeRef.current) fitAndResize();
      });
      resizeObserver.observe(bodyRef.current);
    }

    requestAnimationFrame(() => {
      if (disposed) return;
      fitAndResize();
      if (activeRef.current) terminal.focus();
    });

    fitTimer = window.setTimeout(() => {
      if (!disposed && activeRef.current) fitAndResize();
    }, 80);

    void bridge.createTerminal({
      id: sessionId,
      cwd: workspace.path,
      cols: terminal.cols,
      rows: terminal.rows,
    }).then((result) => {
      if (disposed) {
        void bridge.closeTerminal(result.id);
        return;
      }
      if (activeRef.current) terminal.focus();
    }).catch((error) => {
      if (disposed) return;
      writeSystemLine(formatTerminalError(error));
    });

    return () => {
      disposed = true;
      if (fitTimer !== undefined) window.clearTimeout(fitTimer);
      resizeObserver?.disconnect();
      removeDataListener?.();
      removeExitListener?.();
      disposables.forEach((disposable) => disposable.dispose());
      void bridge.closeTerminal(sessionId);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
    };
  }, [fitAndResize, hasStarted, workspace.path]);

  useEffect(() => {
    if (!hasStarted) return undefined;

    const applyTheme = () => {
      if (!containerRef.current || !terminalRef.current) return;
      terminalRef.current.options.theme = readTerminalTheme(containerRef.current);
    };
    const shell = containerRef.current?.closest(".app-shell");
    applyTheme();

    if (!shell) return undefined;
    const observer = new MutationObserver(applyTheme);
    observer.observe(shell, {
      attributes: true,
      attributeFilter: ["class", "data-theme-mode"],
    });
    return () => observer.disconnect();
  }, [hasStarted]);

  useEffect(() => {
    if (!active) return undefined;
    const frame = requestAnimationFrame(() => {
      fitAndResize();
      terminalRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [active, fitAndResize]);

  return (
    <section className="desktop-terminal-panel" aria-label="Terminal">
      <div className="desktop-terminal-body" ref={bodyRef}>
        <div
          className="desktop-terminal-xterm"
          ref={containerRef}
          onDragOver={handleTerminalDragOver}
          onDrop={handleTerminalDrop}
        />
      </div>
    </section>
  );
}

function hasExplorerNodePath(dataTransfer: DataTransfer) {
  return Array.from(dataTransfer.types).includes(EXPLORER_TREE_NODE_DRAG_TYPE);
}

function readExplorerNodePath(dataTransfer: DataTransfer) {
  const value = dataTransfer.getData(EXPLORER_TREE_NODE_DRAG_TYPE).trim();
  return value || null;
}

function joinWorkspacePath(rootPath: string, nodePath: string) {
  const cleanNodePath = nodePath.trim().replace(/^[/\\]+/, "");
  if (!cleanNodePath) return rootPath;
  const separator = /[/\\]$/.test(rootPath) ? "" : "/";
  return `${rootPath}${separator}${cleanNodePath}`;
}

function shellQuotePath(pathValue: string) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(pathValue)) return pathValue;
  return `'${pathValue.replace(/'/g, "'\\''")}'`;
}

function readTerminalTheme(element: HTMLElement): ITheme {
  return {
    background: cssColor(element, "--po-terminal-bg", cssColor(element, "--po-editor-bg", "#fbf6ed")),
    foreground: cssColor(element, "--po-terminal-fg", cssColor(element, "--po-text", "#2f2a23")),
    cursor: cssColor(element, "--po-terminal-cursor", cssColor(element, "--po-text", "#2f2a23")),
    selectionBackground: cssColor(element, "--po-terminal-selection", cssColor(element, "--po-selected", "rgba(73, 55, 35, 0.17)")),
    scrollbarSliderBackground: "transparent",
    scrollbarSliderHoverBackground: "transparent",
    scrollbarSliderActiveBackground: "transparent",
    overviewRulerBorder: "transparent",
    black: cssColor(element, "--po-terminal-black", cssColor(element, "--po-text", "#2f2a23")),
    red: cssColor(element, "--po-terminal-red", cssColor(element, "--po-danger", "#dc2626")),
    green: cssColor(element, "--po-terminal-green", cssColor(element, "--po-success", "#15803d")),
    yellow: cssColor(element, "--po-terminal-yellow", cssColor(element, "--po-warning", "#b45309")),
    blue: cssColor(element, "--po-terminal-blue", cssColor(element, "--po-accent", "#2563eb")),
    magenta: cssColor(element, "--po-terminal-magenta", cssColor(element, "--po-purple", "#8057a8")),
    cyan: cssColor(element, "--po-terminal-cyan", cssColor(element, "--po-info", "#0284c7")),
    white: cssColor(element, "--po-terminal-white", cssColor(element, "--po-inset", "#e6ded1")),
    brightBlack: cssColor(element, "--po-terminal-bright-black", cssColor(element, "--po-text-muted", "#70685e")),
    brightRed: cssColor(element, "--po-terminal-bright-red", cssColor(element, "--po-danger", "#dc2626")),
    brightGreen: cssColor(element, "--po-terminal-bright-green", cssColor(element, "--po-success", "#15803d")),
    brightYellow: cssColor(element, "--po-terminal-bright-yellow", cssColor(element, "--po-warning", "#b45309")),
    brightBlue: cssColor(element, "--po-terminal-bright-blue", cssColor(element, "--po-accent", "#2563eb")),
    brightMagenta: cssColor(element, "--po-terminal-bright-magenta", cssColor(element, "--po-purple", "#8057a8")),
    brightCyan: cssColor(element, "--po-terminal-bright-cyan", cssColor(element, "--po-info", "#0284c7")),
    brightWhite: cssColor(element, "--po-terminal-bright-white", cssColor(element, "--po-text", "#2f2a23")),
  };
}

function cssColor(element: HTMLElement, name: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return resolveCssColor(element, value || fallback);
}

function resolveCssColor(element: HTMLElement, color: string) {
  const probe = document.createElement("span");
  probe.style.color = color;
  if (!probe.style.color && !color.includes("var(") && !color.includes("color-mix(")) return color;

  probe.style.display = "none";
  element.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved || color;
}

function formatTerminalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No handler registered for 'terminal:create'")) {
    return "Terminal runtime was updated. Restart puppyone once so the native bridge can load.";
  }
  return message;
}

function createTerminalId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `terminal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
