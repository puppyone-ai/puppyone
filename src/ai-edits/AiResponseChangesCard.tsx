import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AiEditFile, AiEditHunk, AiEditRequest } from "@puppyone/shared-ui";
import { bidiIsolate, useLocalization, type MessageFormatter } from "@puppyone/localization";

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
  const { t } = useLocalization();
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
    <section className="ai-response-changes-card" aria-label={t("source-control.aiChanges.ariaLabel")}>
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
            data-tooltip={file.path}
          >
            <span className="ai-response-changes-card__path" dir="ltr">{file.path}</span>
            <span className="ai-response-changes-card__stat" dir="ltr">
              <span className="ai-response-changes-card__stat-add">+{file.additions}</span>
              <span className="ai-response-changes-card__stat-delete">-{file.deletions}</span>
            </span>
          </button>
        ))}
        {request.files.length > MAX_VISIBLE_FILES && (
          <div className="ai-response-changes-card__more">
            {t("source-control.aiChanges.moreFiles", {
              count: request.files.length - MAX_VISIBLE_FILES,
            })}
          </div>
        )}
      </div>

      {reviewOpen && selectedFile && (
        <div
          className="ai-edit-review-popover"
          data-native-surface-occluder="true"
          role="dialog"
          aria-label={t("source-control.aiChanges.reviewFile", { path: bidiIsolate(selectedFile.path) })}
        >
          <header className="ai-edit-review-popover__header">
            <div>
              <strong data-tooltip={selectedFile.path} dir="ltr">{selectedFile.path}</strong>
              <span dir="ltr">+{selectedFile.additions} -{selectedFile.deletions}</span>
            </div>
            <button
              type="button"
              aria-label={t("source-control.aiChanges.closeReview")}
              onClick={() => setReviewOpen(false)}
            >
              <X size={14} />
            </button>
          </header>
          <AiEditFileDiff file={selectedFile} t={t} />
        </div>
      )}
    </section>
  );
}

function AiEditFileDiff({ file, t }: { file: AiEditFile; t: MessageFormatter }) {
  if (file.hunks.length === 0) {
    return <div className="ai-edit-review-popover__empty">{t("source-control.diff.noText")}</div>;
  }

  return (
    <div className="ai-edit-review-popover__hunks" data-po-scrollbar="content">
      {file.hunks.map((hunk) => (
        <AiEditHunkDiff key={hunk.id} hunk={hunk} t={t} />
      ))}
    </div>
  );
}

function AiEditHunkDiff({ hunk, t }: { hunk: AiEditHunk; t: MessageFormatter }) {
  const oldLines = splitReviewLines(hunk.oldText);
  const newLines = splitReviewLines(hunk.newText);
  const truncated = oldLines.length + newLines.length > MAX_VISIBLE_DIFF_LINES;
  const visibleOldLines = oldLines.slice(0, MAX_VISIBLE_DIFF_LINES);
  const remainingLineBudget = Math.max(0, MAX_VISIBLE_DIFF_LINES - visibleOldLines.length);
  const visibleNewLines = newLines.slice(0, remainingLineBudget);

  return (
    <section className="ai-edit-review-hunk">
      <header>
        <span>{hunkLabel(hunk, t)}</span>
        <small>{t("source-control.aiChanges.line", { line: hunk.newRange.startLine })}</small>
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
          <div className="ai-edit-review-hunk__truncated">{t("source-control.diff.truncated")}</div>
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
    <div className={`ai-edit-review-line ${kind}`} dir="ltr">
      <span className="ai-edit-review-line__number">{lineNumber > 0 ? lineNumber : ""}</span>
      <span className="ai-edit-review-line__prefix">{kind === "add" ? "+" : "-"}</span>
      <code>{text || " "}</code>
    </div>
  );
}

function hunkLabel(hunk: AiEditHunk, t: MessageFormatter): string {
  if (hunk.kind === "added") return t("source-control.diff.change.added");
  if (hunk.kind === "removed") return t("source-control.diff.change.deleted");
  return t("source-control.diff.change.modified");
}

function splitReviewLines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}
