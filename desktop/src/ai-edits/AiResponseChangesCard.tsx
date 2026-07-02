import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AiEditFile, AiEditHunk, AiEditRequest } from "@puppyone/shared-ui";

type AiResponseChangesCardProps = {
  request: AiEditRequest;
  activePath?: string | null;
  onOpenFile?: (path: string) => void;
};

const MAX_VISIBLE_FILES = 5;
const MAX_VISIBLE_DIFF_LINES = 80;

export function AiResponseChangesCard({
  request,
  activePath = null,
  onOpenFile,
}: AiResponseChangesCardProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const selectedFile = useMemo(() => {
    if (selectedFileId) {
      const explicitFile = request.files.find((file) => file.id === selectedFileId);
      if (explicitFile) return explicitFile;
    }
    if (activePath) {
      const activeFile = request.files.find((file) => file.path === activePath || file.oldPath === activePath);
      if (activeFile) return activeFile;
    }
    return request.files[0] ?? null;
  }, [activePath, request.files, selectedFileId]);

  useEffect(() => {
    if (!selectedFileId || request.files.some((file) => file.id === selectedFileId)) return;
    setSelectedFileId(null);
  }, [request.files, selectedFileId]);

  if (request.files.length === 0) return null;

  return (
    <section className="ai-response-changes-card" aria-label="AI response changes">
      <div className="ai-response-changes-card__files">
        {request.files.slice(0, MAX_VISIBLE_FILES).map((file) => (
          <button
            key={file.id}
            type="button"
            className={file.path === activePath || file.id === selectedFile?.id ? "active" : ""}
            onClick={() => {
              setSelectedFileId(file.id);
              setReviewOpen(true);
              onOpenFile?.(file.path);
            }}
            title={file.path}
          >
            <span className="ai-response-changes-card__path">{file.path}</span>
            <span className="ai-response-changes-card__stat">
              <span className="ai-response-changes-card__stat-add">+{file.additions}</span>
              <span className="ai-response-changes-card__stat-delete">-{file.deletions}</span>
            </span>
          </button>
        ))}
        {request.files.length > MAX_VISIBLE_FILES && (
          <div className="ai-response-changes-card__more">
            +{request.files.length - MAX_VISIBLE_FILES} more files
          </div>
        )}
      </div>

      {reviewOpen && selectedFile && (
        <div className="ai-edit-review-popover" role="dialog" aria-label={`Review changes in ${selectedFile.path}`}>
          <header className="ai-edit-review-popover__header">
            <div>
              <strong title={selectedFile.path}>{selectedFile.path}</strong>
              <span>+{selectedFile.additions} -{selectedFile.deletions}</span>
            </div>
            <button
              type="button"
              aria-label="Close review"
              onClick={() => setReviewOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          <AiEditFileDiff file={selectedFile} />
        </div>
      )}
    </section>
  );
}

function AiEditFileDiff({ file }: { file: AiEditFile }) {
  if (file.hunks.length === 0) {
    return <div className="ai-edit-review-popover__empty">No textual diff available.</div>;
  }

  return (
    <div className="ai-edit-review-popover__hunks">
      {file.hunks.map((hunk) => (
        <AiEditHunkDiff key={hunk.id} hunk={hunk} />
      ))}
    </div>
  );
}

function AiEditHunkDiff({ hunk }: { hunk: AiEditHunk }) {
  const oldLines = splitReviewLines(hunk.oldText);
  const newLines = splitReviewLines(hunk.newText);
  const truncated = oldLines.length + newLines.length > MAX_VISIBLE_DIFF_LINES;
  const visibleOldLines = oldLines.slice(0, MAX_VISIBLE_DIFF_LINES);
  const remainingLineBudget = Math.max(0, MAX_VISIBLE_DIFF_LINES - visibleOldLines.length);
  const visibleNewLines = newLines.slice(0, remainingLineBudget);

  return (
    <section className="ai-edit-review-hunk">
      <header>
        <span>{hunkLabel(hunk)}</span>
        <small>line {hunk.newRange.startLine}</small>
      </header>
      <div className="ai-edit-review-hunk__body">
        {visibleOldLines.map((line, index) => (
          <DiffLine
            key={`old-${index}`}
            kind="remove"
            lineNumber={hunk.oldRange.startLine + index}
            text={line}
          />
        ))}
        {visibleNewLines.map((line, index) => (
          <DiffLine
            key={`new-${index}`}
            kind="add"
            lineNumber={hunk.newRange.startLine + index}
            text={line}
          />
        ))}
        {truncated && (
          <div className="ai-edit-review-hunk__truncated">Diff truncated</div>
        )}
      </div>
    </section>
  );
}

function DiffLine({
  kind,
  lineNumber,
  text,
}: {
  kind: "add" | "remove";
  lineNumber: number;
  text: string;
}) {
  return (
    <div className={`ai-edit-review-line ${kind}`}>
      <span className="ai-edit-review-line__number">{lineNumber > 0 ? lineNumber : ""}</span>
      <span className="ai-edit-review-line__prefix">{kind === "add" ? "+" : "-"}</span>
      <code>{text || " "}</code>
    </div>
  );
}

function hunkLabel(hunk: AiEditHunk): string {
  if (hunk.kind === "added") return "Added";
  if (hunk.kind === "removed") return "Removed";
  return "Modified";
}

function splitReviewLines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
