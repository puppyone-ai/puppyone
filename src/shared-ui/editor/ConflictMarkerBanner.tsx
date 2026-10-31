"use client";

import { useMemo, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  parseConflictMarkers,
  resolveConflictMarkers,
  type ConflictBlock,
} from "./conflictMarkers";

export type ConflictMarkerBannerProps = {
  content: string;
  onResolve?: (newContent: string) => void;
};

export function ConflictMarkerBanner({
  content,
  onResolve,
}: ConflictMarkerBannerProps) {
  const { t } = useLocalization();
  const blocks = useMemo<ConflictBlock[]>(() => parseConflictMarkers(content), [content]);
  const [expanded, setExpanded] = useState(false);

  if (blocks.length === 0) return null;

  const pickAll = (side: "ours" | "theirs") => {
    if (!onResolve) return;
    onResolve(resolveConflictMarkers(content, side));
  };

  const pickOne = (idx: number, side: "ours" | "theirs") => {
    if (!onResolve) return;
    onResolve(
      resolveConflictMarkers(content, (block) => {
        if (block !== blocks[idx]) return block.ours;
        return side === "ours" ? block.ours : block.theirs;
      }),
    );
  };

  return (
    <div className="conflict-marker-banner">
      <div className="conflict-marker-banner-row">
        <span className="conflict-marker-badge">{t("editor.conflict.badge")}</span>
        <span className="conflict-marker-copy">
          {t("editor.conflict.summary", { count: blocks.length })}
        </span>
        {onResolve && (
          <div className="conflict-marker-actions">
            <button type="button" onClick={() => pickAll("ours")}>
              {t("editor.conflict.keepServer")}
            </button>
            <button type="button" onClick={() => pickAll("theirs")}>
              {t("editor.conflict.keepIncoming")}
            </button>
          </div>
        )}
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("editor.conflict.hideBlocks") : t("editor.conflict.showBlocks")}
        </button>
      </div>

      {expanded && (
        <div className="conflict-marker-blocks">
          {blocks.map((block, index) => (
            <div className="conflict-marker-block" key={`${block.startLine}:${block.endLine}`}>
              <div className="conflict-marker-block-title">
                {t("editor.conflict.blockPosition", {
                  index: index + 1,
                  total: blocks.length,
                  line: block.startLine + 1,
                })}
              </div>
              <div className="conflict-marker-sides">
                <SideColumn
                  label={block.oursLabel || t("editor.conflict.current")}
                  content={block.ours}
                  onPick={onResolve ? () => pickOne(index, "ours") : undefined}
                />
                <SideColumn
                  label={block.theirsLabel || t("editor.conflict.incoming")}
                  content={block.theirs}
                  onPick={onResolve ? () => pickOne(index, "theirs") : undefined}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SideColumn({
  label,
  content,
  onPick,
}: {
  label: string;
  content: string;
  onPick?: () => void;
}) {
  const { t } = useLocalization();
  return (
    <div className="conflict-marker-side">
      <div className="conflict-marker-side-title">
        <span dir="auto">{label}</span>
        {onPick && (
          <button type="button" onClick={onPick}>
            {t("editor.conflict.pick")}
          </button>
        )}
      </div>
      <pre dir="auto" data-po-scrollbar="content">{content || " "}</pre>
    </div>
  );
}
