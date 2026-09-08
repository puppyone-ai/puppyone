import type { ReferenceDataTransferSource } from "@puppyone/shared-ui";
import { isWorkspaceResourceReference } from "../../../../shared/workspace-resource-reference.mjs";
import { resolveResourceDropSource } from "../../../platform/resourceDragSession";

/** Capture DataTransfer before awaiting IPC; its store is unreadable after drop. */
export async function resolveTerminalDropPaths(source: ReferenceDataTransferSource, rootPath: string): Promise<string[]> {
  source = await resolveResourceDropSource(source, "terminal-path");
  const bridge = window.puppyoneDesktop;
  if (source.kind === "workspace-entries") {
    if (!bridge?.resolveResourceReferences) throw new Error("Resource resolution is unavailable.");
    const resolved = await bridge.resolveResourceReferences({
      resources: source.entries.map((entry) => entry.path),
      rootPath,
      ...(source.entries.some((entry) => !isWorkspaceResourceReference(entry.path))
        ? { sourceWorkspaceId: source.workspaceId ?? undefined } : {}),
    });
    return resolved.map((entry) => entry.absolutePath);
  }
  if (source.kind === "files") {
    return source.files.map((file) => {
      const path = bridge?.getPathForFile?.(file);
      if (!path) throw new Error("A dropped file has no local path.");
      return path;
    });
  }
  return [];
}

/** A path insertion is a literal argument, with no Enter or terminal control bytes. */
export function quoteTerminalPaths(paths: readonly string[], shell: string): string {
  const name = shell.split(/[/\\]/).at(-1)?.toLowerCase().replace(/\.exe$/, "");
  const posix = ["sh", "bash", "zsh", "dash", "ksh", "fish"].includes(name ?? "");
  const powershell = name === "powershell" || name === "pwsh";
  if (!posix && !powershell && name !== "cmd") throw new Error("The terminal shell does not support path insertion.");
  return paths.map((path) => {
    if (!path || /[\u0000-\u001f\u007f-\u009f]/u.test(path)) throw new Error("A path contains terminal control characters.");
    if (powershell) return `'${path.replace(/'/g, "''")}'`;
    if (name === "fish") return `'${path.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    if (name === "cmd") {
      // Expansion of %, ! and quotes depends on cmd's dynamic mode; fail closed.
      if (/[%!"\r\n]/u.test(path)) throw new Error("This path cannot be inserted literally into cmd.");
      return `"${path}"`;
    }
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(path)) return path;
    return `'${path.replace(/'/g, "'\\''")}'`;
  }).join(" ");
}
