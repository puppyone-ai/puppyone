import { useCallback, useEffect, useRef, useState } from "react";
import { ipcErrorMessage } from "../../../core/ipcErrorMessage";
import type {
  AppPreviewController,
  AppPreviewResult,
} from "../../../core/types";
import type { AppPreviewViewState } from "./types";

type ActivationIntent = "start" | "restart";

/**
 * Owns the process-runtime half of App Preview.
 *
 * Presentation deliberately stays out of this hook: the editor renders the
 * returned URL as a sandboxed iframe, so normal DOM layout is the only source
 * of truth for position, clipping and size.
 */
export function useAppPreviewSession({
  appPreview,
  path,
  enabled = true,
}: {
  appPreview: AppPreviewController | null | undefined;
  path: string;
  enabled?: boolean;
}) {
  const [state, setState] = useState<AppPreviewViewState>({
    status: "idle",
    runtime: null,
    error: null,
  });
  const [logs, setLogs] = useState("");
  const [activationVersion, setActivationVersion] = useState(0);
  const nextIntentRef = useRef<ActivationIntent>("start");
  const requestVersionRef = useRef(0);
  const runtimeGenerationRef = useRef(0);
  const runtimeIdRef = useRef<string | null>(null);
  const runtimeSequenceRef = useRef(new Map<string, number>());

  const refreshLogs = useCallback(async () => {
    if (!appPreview?.getLogs) return;
    try {
      setLogs(await appPreview.getLogs(path));
    } catch (error) {
      setLogs(sanitizePreviewTransportError(error instanceof Error ? error.message : String(error)));
    }
  }, [appPreview, path]);

  const requestActivation = useCallback((intent: ActivationIntent) => {
    nextIntentRef.current = intent;
    setActivationVersion((value) => value + 1);
  }, []);

  const stop = useCallback(async () => {
    if (!appPreview?.stop) return;
    requestVersionRef.current += 1;
    try {
      const runtime = await appPreview.stop(path);
      setState({ status: "stopped", runtime, error: null });
      setLogs(runtime.logs ?? "");
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: {
          code: "start-failed",
          detail: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  }, [appPreview, path]);

  useEffect(() => {
    runtimeGenerationRef.current = 0;
    runtimeIdRef.current = null;
    runtimeSequenceRef.current.clear();
    if (!enabled) {
      requestVersionRef.current += 1;
      setLogs("");
      setState({ status: "idle", runtime: null, error: null });
    }
  }, [enabled, path]);

  useEffect(() => {
    if (!enabled || !appPreview?.subscribeRuntime) return;
    return appPreview.subscribeRuntime((runtime) => {
      if (runtime.path !== path) return;
      const generation = runtime.generation ?? 0;
      const runtimeId = runtime.runtimeId ?? `generation:${generation}`;
      const sequence = runtime.sequence ?? 0;
      if (generation < runtimeGenerationRef.current) return;
      if (sequence <= (runtimeSequenceRef.current.get(runtimeId) ?? -1)) return;
      if (
        generation === runtimeGenerationRef.current
        && runtimeIdRef.current
        && runtimeIdRef.current !== runtimeId
      ) return;
      runtimeGenerationRef.current = generation;
      runtimeIdRef.current = runtime.runtimeId ?? null;
      runtimeSequenceRef.current.set(runtimeId, sequence);
      setLogs(runtime.logs ?? "");
      setState({
        status: runtime.status,
        runtime,
        error: runtime.status === "error"
          ? { code: "start-failed", detail: runtime.message ?? null }
          : null,
      });
    });
  }, [appPreview, enabled, path]);

  useEffect(() => {
    if (!enabled) return;
    if (!appPreview?.start) {
      setState({
        status: "error",
        runtime: null,
        error: { code: "unavailable", detail: null },
      });
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const intent = nextIntentRef.current;
    nextIntentRef.current = "start";
    let disposed = false;

    setState((current) => ({ ...current, status: "starting", error: null }));

    const begin = async () => {
      try {
        const runtime = await activateRuntime(appPreview, path, intent);
        if (disposed || requestVersion !== requestVersionRef.current) return;
        runtimeGenerationRef.current = Math.max(
          runtimeGenerationRef.current,
          runtime.generation ?? 0,
        );
        runtimeIdRef.current = runtime.runtimeId ?? null;
        if (runtime.runtimeId) {
          runtimeSequenceRef.current.set(runtime.runtimeId, runtime.sequence ?? 0);
        }
        setLogs(runtime.logs ?? "");
        setState({
          status: runtime.status === "running" ? "running" : runtime.status,
          runtime,
          error: runtime.status === "error"
            ? { code: "start-failed", detail: runtime.message ?? null }
            : null,
        });
      } catch (error) {
        if (disposed || requestVersion !== requestVersionRef.current) return;
        const detail = error instanceof Error ? error.message : String(error);
        if (/cancel/i.test(detail)) {
          setState((current) => ({ ...current, status: "stopped", error: null }));
          return;
        }
        setState((current) => ({
          ...current,
          status: "error",
          error: { code: "start-failed", detail },
        }));
        void refreshLogs();
      }
    };

    void begin();
    return () => {
      disposed = true;
      requestVersionRef.current += 1;
    };
  }, [activationVersion, appPreview, enabled, path, refreshLogs]);

  return {
    state,
    logs,
    run: () => requestActivation("start"),
    restart: () => requestActivation("restart"),
    stop,
    refreshLogs,
  };
}

const pendingStarts = new WeakMap<
  AppPreviewController,
  Map<string, Promise<AppPreviewResult>>
>();

function activateRuntime(
  controller: AppPreviewController,
  path: string,
  intent: ActivationIntent,
): Promise<AppPreviewResult> {
  if (intent === "restart" && controller.restart) return controller.restart(path);

  let byPath = pendingStarts.get(controller);
  if (!byPath) {
    byPath = new Map();
    pendingStarts.set(controller, byPath);
  }
  const current = byPath.get(path);
  if (current) return current;

  const pending = Promise.resolve(controller.start(path)).finally(() => {
    if (byPath?.get(path) === pending) byPath.delete(path);
  });
  byPath.set(path, pending);
  return pending;
}

function sanitizePreviewTransportError(value: string): string {
  return ipcErrorMessage(value)
    .replace(/\b(?:ipc|rpc)[\w:-]*\b/gi, "preview service")
    .slice(0, 1_000);
}
