import {
  Children,
  forwardRef,
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import { Tooltip } from "./Tooltip";

export type FloatingNoticeTone = "neutral" | "info" | "success" | "warning" | "danger";
export type FloatingNoticePlacement = "top-end" | "bottom-end" | "top";

const TONE_GLYPHS: Readonly<Record<FloatingNoticeTone, ReactNode>> = {
  neutral: null,
  info: <Info size={15} strokeWidth={1.8} />,
  success: <CircleCheck size={15} strokeWidth={1.8} />,
  warning: <TriangleAlert size={15} strokeWidth={1.8} />,
  danger: <CircleAlert size={15} strokeWidth={1.8} />,
};

export type FloatingNoticeProps = Readonly<{
  children: ReactNode;
  tone?: FloatingNoticeTone;
  /** Replaces the tone glyph. Pass `null` for a text-only notice. */
  icon?: ReactNode;
  /** Inline commands such as Retry. They render before the dismiss control. */
  actions?: ReactNode;
  /** Renders a close control and enables Escape while focus is inside. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Defaults to `alert` for warning/danger and `status` otherwise. */
  role?: "alert" | "status";
  className?: string;
  dir?: "auto" | "ltr" | "rtl";
}>;

/**
 * The single visual contract for transient, non-modal feedback that floats
 * over a product surface. Position is owned by the caller's FloatingNoticeStack.
 */
export function FloatingNotice({
  children,
  tone = "neutral",
  icon,
  actions,
  onDismiss,
  dismissLabel,
  role,
  className,
  dir = "auto",
}: FloatingNoticeProps) {
  const { t } = useLocalization();
  const glyph = icon === undefined ? TONE_GLYPHS[tone] : icon;
  const resolvedRole = role ?? (tone === "danger" || tone === "warning" ? "alert" : "status");
  const resolvedDismissLabel = dismissLabel ?? t("shared-ui.notice.dismiss");
  const handleKeyDown = onDismiss
    ? (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }
    : undefined;

  return (
    <div
      className={["po-floating-notice", className].filter(Boolean).join(" ")}
      data-tone={tone}
      data-dismissible={onDismiss ? "true" : undefined}
      onKeyDown={handleKeyDown}
    >
      {glyph != null && (
        <span className="po-floating-notice__icon" aria-hidden="true">{glyph}</span>
      )}
      <div className="po-floating-notice__message" role={resolvedRole} dir={dir}>
        {children}
      </div>
      {actions && <div className="po-floating-notice__actions">{actions}</div>}
      {onDismiss && (
        <Tooltip content={resolvedDismissLabel}>
          <button
            type="button"
            className="po-floating-notice__dismiss"
            aria-label={resolvedDismissLabel}
            onClick={onDismiss}
          >
            <X size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}

/**
 * Locally dismisses a notice whose source state is owned elsewhere. A changed
 * notice value (including clear-then-recur) is presented again.
 */
export function useDismissibleNotice<T>(
  notice: T | null | undefined,
): readonly [visibleNotice: T | null, dismiss: () => void] {
  const [state, setState] = useState({ notice, dismissed: false });
  let current = state;
  if (!Object.is(state.notice, notice)) {
    current = { notice, dismissed: false };
    setState(current);
  }
  const dismiss = useCallback(() => {
    setState((previous) => ({ notice: previous.notice, dismissed: true }));
  }, []);
  return [current.dismissed || notice == null ? null : notice, dismiss] as const;
}

export type FloatingNoticeStackProps = Readonly<{
  children?: ReactNode;
  placement?: FloatingNoticePlacement;
  /** Owns the stack's offsets and z-index within its positioned surface. */
  className?: string;
}>;

/**
 * Stacks every floating notice of one surface in a single anchored column so
 * concurrent notices never overlap. The stack never intercepts input itself.
 * Pass its element to FloatingNoticePortal to let nested features present
 * into this same stack.
 */
export const FloatingNoticeStack = forwardRef<HTMLDivElement, FloatingNoticeStackProps>(
  function FloatingNoticeStack({ children, placement = "top-end", className }, ref) {
    return (
      <div
        ref={ref}
        className={["po-floating-notice-stack", className].filter(Boolean).join(" ")}
        data-placement={placement}
      >
        {children}
      </div>
    );
  },
);

/**
 * Presents notices in a surface-owned FloatingNoticeStack so one surface keeps
 * a single notice column. Without a stack the notices get their own.
 */
export function FloatingNoticePortal({
  children,
  stack,
  fallbackPlacement,
  fallbackClassName,
}: Readonly<{
  children?: ReactNode;
  stack: HTMLElement | null | undefined;
  fallbackPlacement?: FloatingNoticePlacement;
  fallbackClassName?: string;
}>) {
  if (Children.toArray(children).length === 0) return null;
  if (stack) return createPortal(children, stack);
  return (
    <FloatingNoticeStack placement={fallbackPlacement} className={fallbackClassName}>
      {children}
    </FloatingNoticeStack>
  );
}
