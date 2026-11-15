import { useCallback, useMemo, useSyncExternalStore } from "react";
import type {
  LocalComputerRecord,
  LocalComputerRegisterRequest,
  LocalComputerScreenSession,
  LocalComputerSnapshot,
} from "../../../shared/local-computers/types";

const EMPTY_SNAPSHOT: LocalComputerSnapshot = Object.freeze({
  experimentalEnabled: false,
  runtime: Object.freeze({
    available: false,
    engine: "managed",
    limactlPath: null,
    architecture: "arm64",
    platform: "darwin",
  }),
  computers: Object.freeze([]),
});

let currentSnapshot: LocalComputerSnapshot = EMPTY_SNAPSHOT;
let initialized = false;
let bridgeCleanup: (() => void) | null = null;
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    listener();
  }
}

function updateSnapshot(next: LocalComputerSnapshot | null | undefined) {
  if (!next || !Array.isArray(next.computers)) return;
  currentSnapshot = next;
  notifyListeners();
}

function ensureBridgeSubscription() {
  if (initialized || typeof window === "undefined") return;
  const bridge = window.puppyoneDesktop?.localComputers;
  if (!bridge) return;
  initialized = true;
  bridgeCleanup = bridge.onChanged((next) => {
    updateSnapshot(next);
  });
  void bridge.getSnapshot().then(updateSnapshot).catch(() => undefined);
}

function subscribe(listener: () => void) {
  ensureBridgeSubscription();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  ensureBridgeSubscription();
  return currentSnapshot;
}

export function normalizeComputerWorkspacePath(folderPath: string | null | undefined): string {
  if (!folderPath) return "";
  const trimmed = folderPath.trim();
  if (trimmed.length <= 1) return trimmed;
  return trimmed.replace(/[/\\]+$/, "");
}

export function findLocalComputerForPath(
  computers: readonly LocalComputerRecord[],
  folderPath: string | null | undefined,
): LocalComputerRecord | null {
  const target = normalizeComputerWorkspacePath(folderPath);
  if (!target) return null;
  for (const item of computers) {
    if (normalizeComputerWorkspacePath(item.workspacePath) === target) {
      return item;
    }
  }
  return null;
}

export function resetLocalComputersCacheForTests() {
  bridgeCleanup?.();
  bridgeCleanup = null;
  initialized = false;
  currentSnapshot = EMPTY_SNAPSHOT;
  notifyListeners();
}

export function useLocalComputers() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);

  const registerComputer = useCallback(async (request: LocalComputerRegisterRequest) => {
    const bridge = window.puppyoneDesktop?.localComputers;
    if (!bridge) return currentSnapshot;
    const next = await bridge.register(request);
    updateSnapshot(next);
    return next;
  }, []);

  const wakeComputer = useCallback(async (id: string) => {
    const bridge = window.puppyoneDesktop?.localComputers;
    if (!bridge) return currentSnapshot;
    const next = await bridge.wake({ id });
    updateSnapshot(next);
    return next;
  }, []);

  const sleepComputer = useCallback(async (id: string) => {
    const bridge = window.puppyoneDesktop?.localComputers;
    if (!bridge) return currentSnapshot;
    const next = await bridge.sleep({ id });
    updateSnapshot(next);
    return next;
  }, []);

  const provisionDesktop = useCallback(async (id: string) => {
    const bridge = window.puppyoneDesktop?.localComputers;
    if (!bridge) return currentSnapshot;
    const next = await bridge.provisionDesktop({ id });
    updateSnapshot(next);
    return next;
  }, []);

  const removeComputer = useCallback(async (id: string) => {
    const bridge = window.puppyoneDesktop?.localComputers;
    if (!bridge) return currentSnapshot;
    const next = await bridge.remove({ id });
    updateSnapshot(next);
    return next;
  }, []);

  const connectScreen = useCallback(async (id: string): Promise<LocalComputerScreenSession> => {
    const bridge = window.puppyoneDesktop?.localComputers;
    if (!bridge) {
      return { transport: "managed-preview", url: "", width: 1280, height: 800 };
    }
    return bridge.connectScreen({ id });
  }, []);

  const computersByPath = useMemo(() => {
    const map = new Map<string, LocalComputerRecord>();
    for (const computer of snapshot.computers) {
      map.set(normalizeComputerWorkspacePath(computer.workspacePath), computer);
    }
    return map;
  }, [snapshot.computers]);

  return {
    snapshot,
    computers: snapshot.computers,
    runtime: snapshot.runtime,
    computersByPath,
    registerComputer,
    wakeComputer,
    sleepComputer,
    provisionDesktop,
    removeComputer,
    connectScreen,
  };
}

export function useLocalComputerForPath(workspacePath: string | null | undefined): LocalComputerRecord | null {
  const { computers } = useLocalComputers();
  return useMemo(
    () => findLocalComputerForPath(computers, workspacePath),
    [computers, workspacePath],
  );
}
