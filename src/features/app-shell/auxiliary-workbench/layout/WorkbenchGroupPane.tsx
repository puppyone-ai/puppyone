import type { ReactNode } from "react";
import type { WorkbenchContentDropIntent } from "./workbenchTabMove";

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
  return (
    <section
      className="desktop-terminal-tab-group"
      data-terminal-group-pane-id={groupId}
      data-focused={focused ? "true" : undefined}
    >
      <div className="desktop-terminal-group-chrome">{moveHandle}{header}</div>
      <div
        className="desktop-terminal-tab-group-content"
        data-terminal-content-drop-group-id={groupId}
        data-drop-target={contentDropIntent?.edge}
      >
        {children}
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
