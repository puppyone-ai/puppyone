import { Tooltip } from "../primitives/Tooltip";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> & {
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  tooltip?: string;
};

export const SidebarRow = forwardRef<HTMLButtonElement, SidebarRowProps>(function SidebarRow(
  { active = false, className, icon, label, meta, tooltip, type = "button", "aria-current": ariaCurrent, ...props },
  ref,
) {
  return (
    <Tooltip content={tooltip}><button
      ref={ref}
      className={joinSidebarClassNames(
        "po-sidebar-row",
        active && "active",
        className,
      )}
      type={type}
      data-active={active || undefined}
      aria-current={ariaCurrent ?? (active ? "page" : undefined)}
      {...props}
                               >
      {icon != null && <span className="po-sidebar-row__icon" aria-hidden="true">{icon}</span>}
      <span className="po-sidebar-row__label">{label}</span>
      {meta != null && <span className="po-sidebar-row__meta">{meta}</span>}
    </button></Tooltip>
  );
});
