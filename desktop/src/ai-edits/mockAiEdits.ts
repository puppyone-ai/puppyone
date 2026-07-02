import { createAiEditRequest, type AiEditRequest } from "@puppyone/shared-ui";
import { changes, sessions } from "../lib/mockData";

export function buildMockAiEditRequest(workspaceId: string): AiEditRequest | null {
  if (workspaceId !== "client-files") return null;

  const session = sessions.find((item) => item.workspaceId === workspaceId) ?? sessions[0];
  if (!session) return null;

  const files = changes
    .filter((change) => change.before !== undefined || change.after !== undefined)
    .map((change) => ({
      requestId: `${session.id}:r1`,
      path: normalizeChangedPath(change.path),
      before: change.before ?? "",
      after: change.after ?? "",
      status: change.kind === "created"
        ? "created" as const
        : change.kind === "deleted"
          ? "deleted" as const
          : change.kind === "moved"
            ? "renamed" as const
            : "modified" as const,
    }));

  return createAiEditRequest({
    id: `${session.id}:r1`,
    sessionId: session.id,
    agentName: session.agent,
    title: "Updated client workspace notes",
    createdAt: session.endedAt,
    files,
  });
}

function normalizeChangedPath(path: string): string {
  const renameSeparator = " -> ";
  if (!path.includes(renameSeparator)) return path;
  const parts = path.split(renameSeparator);
  return parts[parts.length - 1] ?? path;
}

