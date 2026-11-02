import { forwardRef, type HTMLAttributes } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarScrollAreaProps = HTMLAttributes<HTMLDivElement>;

export const SidebarScrollArea = forwardRef<HTMLDivElement, SidebarScrollAreaProps>(function SidebarScrollArea(
  { className, children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={joinSidebarClassNames("po-sidebar-scroll-area", className)}
      data-po-scrollbar="sidebar"
      {...props}
    >
      {children}
    </div>
  );
});
