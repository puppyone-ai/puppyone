import { useEffect, useRef, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useNativeSurfaceOcclusionLease } from "../features/native-surfaces";

const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type DesktopDialogDismissalPolicy = "dismissible" | "action-required";

export function DesktopDialogRoot({
  children,
  onClose,
  dismissalPolicy = "dismissible",
  dismissOnBackdrop = true,
  className = "",
}: {
  children: ReactNode;
  onClose?: () => void;
  dismissalPolicy?: DesktopDialogDismissalPolicy;
  dismissOnBackdrop?: boolean;
  className?: string;
}) {
  useNativeSurfaceOcclusionLease();

  const pointerStartedOnBackdropRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissalPolicyRef = useRef(dismissalPolicy);
  dismissalPolicyRef.current = dismissalPolicy;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const surface = root.querySelector<HTMLElement>("[role='dialog']");
    const initialFocus = surface?.querySelector<HTMLElement>("[data-desktop-dialog-initial-focus='true'], [autofocus]")
      ?? surface;
    initialFocus?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDesktopDialog(root)) return;
      if (event.key === "Escape") {
        if (event.isComposing) return;
        if (dismissalPolicyRef.current === "action-required") return;
        if (!onCloseRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !surface) return;
      const focusable = getDialogFocusableElements(surface);
      if (focusable.length === 0) {
        event.preventDefault();
        surface.focus({ preventScroll: true });
        return;
      }
      const active = document.activeElement;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!surface.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (active === surface) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const clickedBackdrop = event.target === event.currentTarget;
    if (
      dismissalPolicy === "dismissible"
      && dismissOnBackdrop
      && pointerStartedOnBackdropRef.current
      && clickedBackdrop
    ) {
      onClose?.();
    }
    pointerStartedOnBackdropRef.current = false;
  };

  return (
    <div
      ref={rootRef}
      className={`desktop-dialog-backdrop ${className}`.trim()}
      data-desktop-dialog-root="true"
      data-native-surface-occluder="true"
      data-window-no-drag="true"
      role="presentation"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      {children}
    </div>
  );
}

export function DesktopDialogSurface({
  children,
  className = "",
  width,
  style,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  width?: number | string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const surfaceStyle = {
    ...(width === undefined ? null : { "--desktop-dialog-width": typeof width === "number" ? `${width}px` : width }),
    ...style,
  } as CSSProperties;

  return (
    <div
      className={`desktop-dialog-surface ${className}`.trim()}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={surfaceStyle}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function getDialogFocusableElements(surface: HTMLElement) {
  return Array.from(surface.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
    .filter((element) => element.tabIndex >= 0 && element.getAttribute("aria-hidden") !== "true" && !element.hidden);
}

function isTopmostDesktopDialog(root: HTMLElement) {
  const dialogs = document.querySelectorAll<HTMLElement>("[data-desktop-dialog-root='true']");
  return dialogs[dialogs.length - 1] === root;
}

export function DesktopDialogCloseButton({
  title = "Close",
  className = "",
  disabled,
  onClick,
}: {
  title?: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`desktop-dialog-icon-button ${className}`.trim()}
      type="button"
      disabled={disabled}
      aria-label={title}
      data-tooltip={title}
      onClick={onClick}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M5 5L11 11M11 5L5 11"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
