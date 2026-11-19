import { forwardRef, type HTMLAttributes } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarRootProps = HTMLAttributes<HTMLElement>;

export const SidebarRoot = forwardRef<HTMLElement, SidebarRootProps>(function SidebarRoot(
  { className, children, ...props },
  ref,
) {
  return (
    <section
      ref={ref}
      className={joinSidebarClassNames("po-sidebar-root", className)}
      {...props}
    >
      {children}
    </section>
  );
});
