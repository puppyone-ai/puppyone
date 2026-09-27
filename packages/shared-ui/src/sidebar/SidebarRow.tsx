import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarRowProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
};

export const SidebarRow = forwardRef<HTMLButtonElement, SidebarRowProps>(function SidebarRow(
  { active = false, className, icon, label, meta, title, type = "button", "aria-current": ariaCurrent, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={joinSidebarClassNames(
        "po-sidebar-row",
        active && "active",
        className,
      )}
      type={type}
      data-active={active || undefined}
      aria-current={ariaCurrent ?? (active ? "page" : undefined)}
      data-tooltip={title}
      {...props}
    >
      {icon != null && <span className="po-sidebar-row__icon" aria-hidden="true">{icon}</span>}
      <span className="po-sidebar-row__label">{label}</span>
      {meta != null && <span className="po-sidebar-row__meta">{meta}</span>}
    </button>
  );
});
