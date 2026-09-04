import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { useNativeSurfaceOcclusionLease } from "../features/native-surfaces";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type DesktopMenuSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  ariaLabel?: string;
  className?: string;
  elevation?: "default" | "compact";
  style?: CSSProperties;
  tone?: "default" | "quiet";
  typographySurface?: "ui" | "header" | "editor" | "left-sidebar" | "right-sidebar";
};

export const DesktopMenuSurface = forwardRef<HTMLDivElement, DesktopMenuSurfaceProps>(function DesktopMenuSurface(
  {
    ariaLabel,
    children,
    className,
    elevation = "default",
    role = "menu",
    tone = "default",
    typographySurface = "ui",
    ...props
  },
  ref,
) {
  useNativeSurfaceOcclusionLease();

  return (
    <div
      ref={ref}
      className={cx("desktop-menu-surface", className)}
      role={role}
      aria-label={ariaLabel}
      data-menu-elevation={elevation === "compact" ? elevation : undefined}
      data-menu-tone={tone === "quiet" ? tone : undefined}
      data-menu-typography-surface={typographySurface}
      data-native-surface-occluder="true"
      data-po-scrollbar="menu"
      data-window-no-drag="true"
      {...props}
    >
      {children}
    </div>
  );
});

export function DesktopMenuSection({
  children,
  className,
  label,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  label?: ReactNode;
}) {
  return (
    <section className={cx("desktop-menu-section", className)} {...props}>
      {label !== undefined && <div className="desktop-menu-section-label">{label}</div>}
      <div className="desktop-menu-section-list">{children}</div>
    </section>
  );
}

export function DesktopMenuSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("desktop-menu-separator", className)} aria-hidden="true" {...props} />;
}

export type DesktopMenuItemProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  detail?: ReactNode;
  destructive?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  selected?: boolean;
  trailing?: ReactNode;
};

export type DesktopMenuIconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "children"
> & {
  icon: ReactNode;
  label: string;
};

export function DesktopMenuIconButton({
  className,
  icon,
  label,
  title = label,
  type = "button",
  ...props
}: DesktopMenuIconButtonProps) {
  return (
    <button
      className={cx("desktop-menu-icon-button", className)}
      type={type}
      aria-label={label}
      title={title}
      {...props}
    >
      {icon}
    </button>
  );
}

export const DesktopMenuItem = forwardRef<HTMLButtonElement, DesktopMenuItemProps>(function DesktopMenuItem(
  {
    className,
    detail,
    destructive,
    icon,
    label,
    role = "menuitem",
    selected,
    trailing,
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx("desktop-menu-item", selected && "selected", destructive && "danger", className)}
      type="button"
      role={role}
      {...props}
    >
      {icon !== undefined && <span className="desktop-menu-item-icon" aria-hidden="true">{icon}</span>}
      <span className="desktop-menu-item-body">
        <span className="desktop-menu-item-label">{label}</span>
        {detail !== undefined && <span className="desktop-menu-item-detail">{detail}</span>}
      </span>
      {trailing !== undefined && <span className="desktop-menu-item-trailing">{trailing}</span>}
    </button>
  );
});
