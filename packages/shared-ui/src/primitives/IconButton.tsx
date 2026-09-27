import { Tooltip } from "./Tooltip";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "title"> & {
  icon: ReactNode;
  label: string;
  tooltip?: string | null;
};

export function IconButton({
  icon,
  label,
  className,
  type = "button",
  tooltip = label,
  ...props
}: IconButtonProps) {
  const classes = ["po-icon-button", className].filter(Boolean).join(" ");
  return (
    <Tooltip content={tooltip}><button className={classes} type={type} aria-label={label} {...props}>
      {icon}
    </button></Tooltip>
  );
}
