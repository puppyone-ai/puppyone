"use client";

import type { CSSProperties } from "react";
import { MarkdownCodeMirrorEditor } from "./MarkdownCodeMirrorEditor";

export type MarkdownPresentationPreviewProps = {
  value: string;
  ariaLabel: string;
  style?: CSSProperties;
};

/**
 * A read-only presentation sample rendered by the product Markdown editor.
 * Keeping this adapter in Shared UI prevents settings surfaces from creating
 * a second approximation of Live Preview typography and projection behavior.
 */
export function MarkdownPresentationPreview({
  value,
  ariaLabel,
  style,
}: MarkdownPresentationPreviewProps) {
  return (
    <section
      className="markdown-presentation-preview"
      aria-label={ariaLabel}
      style={style}
    >
      <MarkdownCodeMirrorEditor
        value={value}
        readOnly
        livePreview
        blockDragEnabled={false}
      />
    </section>
  );
}
