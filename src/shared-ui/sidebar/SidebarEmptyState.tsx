import { forwardRef, type HTMLAttributes } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarEmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
  layout?: "inline" | "vertical";
  tone?: "neutral" | "danger";
};

export const SidebarEmptyState = forwardRef<HTMLDivElement, SidebarEmptyStateProps>(function SidebarEmptyState(
  { className, compact = false, layout = "inline", tone = "neutral", children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinSidebarClassNames(
        "po-sidebar-empty",
        compact && "compact",
        layout === "vertical" && "vertical",
        tone === "danger" && "danger",
        className,
      )}
      data-po-scrollbar="sidebar"
      {...props}
    >
      {children}
    </div>
  );
});
