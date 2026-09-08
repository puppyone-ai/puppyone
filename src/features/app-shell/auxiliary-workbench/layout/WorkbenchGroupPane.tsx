import { useRef, type ReactNode } from "react";
import type { WorkbenchContentDropIntent } from "./workbenchTabMove";
import { useWorkbenchPaneContentHandleReveal } from "./useWorkbenchPaneContentHandleReveal";

export type WorkbenchGroupPaneProps = Readonly<{
  children: ReactNode;
  contentDropIntent: WorkbenchContentDropIntent | null;
  focused: boolean;
  groupId: string;
  header: ReactNode;
  moveHandle: ReactNode;
}>;

/**
 * Owns the structural boundary between Group chrome and its split target.
 * Header interactions never participate in content-edge hit testing or paint.
 */
export function WorkbenchGroupPane({
  children,
  contentDropIntent,
  focused,
  groupId,
  header,
  moveHandle,
}: WorkbenchGroupPaneProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const handleReveal = useWorkbenchPaneContentHandleReveal(
    contentRef,
    Boolean(contentDropIntent),
  );

  return (
    <section
      className="desktop-terminal-tab-group"
      data-terminal-group-pane-id={groupId}
      data-focused={focused ? "true" : undefined}
      data-handle-hot={handleReveal.revealed ? "true" : undefined}
    >
      {header}
      <div
        ref={contentRef}
        className="desktop-terminal-tab-group-content"
        data-terminal-content-drop-group-id={groupId}
        data-drop-target={contentDropIntent?.edge}
        onPointerMove={handleReveal.onPointerMove}
        onPointerLeave={handleReveal.onPointerLeave}
      >
        {children}
        {moveHandle}
        {contentDropIntent && (
          <div
            className="desktop-terminal-drop-preview"
            data-edge={contentDropIntent.edge}
            data-allowed={contentDropIntent.allowed ? "true" : "false"}
            data-operation={contentDropIntent.kind}
            aria-hidden="true"
          />
        )}
        <div className="desktop-terminal-pane-interaction-frame" aria-hidden="true" />
      </div>
    </section>
  );
}
