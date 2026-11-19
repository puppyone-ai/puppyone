import { forwardRef, type HTMLAttributes } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarListProps = HTMLAttributes<HTMLDivElement>;

export const SidebarList = forwardRef<HTMLDivElement, SidebarListProps>(function SidebarList(
  { className, children, ...props },
  ref,
) {
  return (
    <div ref={ref} className={joinSidebarClassNames("po-sidebar-list", className)} {...props}>
      {children}
    </div>
  );
});
