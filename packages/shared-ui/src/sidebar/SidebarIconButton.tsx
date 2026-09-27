import { Tooltip } from "../primitives/Tooltip";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { joinSidebarClassNames } from "./classNames";

export type SidebarIconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "title"> & {
  label: string;
  icon: ReactNode;
  tone?: "neutral" | "primary" | "danger";
  tooltip?: string | null;
};

export const SidebarIconButton = forwardRef<HTMLButtonElement, SidebarIconButtonProps>(function SidebarIconButton(
  { className, icon, label, tooltip = label, tone = "neutral", type = "button", ...props },
  ref,
) {
  return (
    <Tooltip content={tooltip}><button
      ref={ref}
      className={joinSidebarClassNames(
        "po-sidebar-icon-button",
        tone !== "neutral" && tone,
        className,
      )}
      type={type}
      aria-label={label}
      {...props}
                               >
      {icon}
    </button></Tooltip>
  );
});
