/** Semantic routing shared by projection and rendering; never infer from prose. */
export function isAgentToolActivity(part) {
  return part?.kind === "tool" || part?.kind === "command" || part?.kind === "file-change";
}

export function isAgentTranscriptActivity(part) {
  if (part?.kind === "notification") return false;
  return part?.kind !== "system" || part.detail?.category === "compaction";
}
