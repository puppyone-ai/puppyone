import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  label: string;
  icon: ReactNode;
  tone?: "neutral" | "primary" | "danger";
};

export const SidebarIconButton = forwardRef<HTMLButtonElement, SidebarIconButtonProps>(function SidebarIconButton(
  { className, icon, label, title = label, tone = "neutral", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={joinSidebarClassNames(
        "po-sidebar-icon-button",
        tone !== "neutral" && tone,
        className,
      )}
      type={type}
      aria-label={label}
      data-tooltip={title}
      {...props}
    >
      {icon}
    </button>
  );
});
