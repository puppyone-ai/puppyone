import { Check, ChevronDown, CircleAlert, Search } from "lucide-react";
import { bidiIsolate } from "@puppyone/localization/core";
import { useLocalization } from "@puppyone/localization/react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { DesktopMenuItem, DesktopMenuSection, DesktopMenuSurface } from "../../../components/DesktopMenu";
import { DesktopOverlayLayer } from "../../app-shell/DesktopOverlayPortal";
import { useAnchoredOverlayPosition } from "../../app-shell/useAnchoredOverlayPosition";
import { agentPickerLimits } from "./agent-picker-limits";
import {
  agentPickerMaxHeightPixels,
  agentPickerWidthPixels,
  type AgentPickerIndicator,
  type AgentPickerPlacement,
  type AgentPickerWidth,
} from "./agent-picker-presentation";
import { agentPickerOverlayGeometry } from "./agent-runtime-geometry";

export type AgentPickerOption = {
  id: string;
  label: string;
  description?: string;
  warning?: string;
  meta?: string;
  keywords?: string;
  selectable: boolean;
  selected?: boolean;
  icon?: ReactNode;
};

export type AgentPickerGroup = {
  id: string;
  label: string;
  options: AgentPickerOption[];
};

type AgentPickerPopoverProps = {
  ariaLabel: string;
  placeholder: string;
  valueLabel?: string | null;
  groups: AgentPickerGroup[];
  disabled?: boolean;
  placement?: AgentPickerPlacement;
  title?: string;
  triggerDescription?: string;
  triggerIcon?: ReactNode;
  indicator?: AgentPickerIndicator;
  width?: AgentPickerWidth;
  compactWhenSelected?: boolean;
  onSelect: (id: string) => void;
};

export function AgentPickerPopover({
  ariaLabel,
  placeholder,
  valueLabel,
  groups,
  disabled = false,
  placement = "composer",
  title,
  triggerDescription,
  triggerIcon,
  indicator = "chevron",
  width = "wide",
  compactWhenSelected = false,
  onSelect,
}: AgentPickerPopoverProps) {
  const { locale, t } = useLocalization();
  const popupId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const typeaheadRef = useRef({ value: "", timer: 0 as number | undefined });
  const focusTimerRef = useRef(0 as number | undefined);
  const restoreTimerRef = useRef(0 as number | undefined);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOptionId, setActiveOptionId] = useState<string | null>(null);
  const matchedGroups = useMemo(() => filterGroups(groups, query, locale), [groups, locale, query]);
  const matchedOptionCount = useMemo(
    () => matchedGroups.reduce((count, group) => count + group.options.length, 0),
    [matchedGroups],
  );
  const filteredGroups = useMemo(() => limitGroups(matchedGroups, agentPickerLimits.maxRenderedOptions), [matchedGroups]);
  const flatOptions = useMemo(() => filteredGroups.flatMap((group) => group.options), [filteredGroups]);
  const truncated = matchedOptionCount > flatOptions.length;
  const searchable = groups.reduce((count, group) => count + group.options.length, 0) > 6;
  const compact = compactWhenSelected && Boolean(valueLabel);
  const preferredWidth = agentPickerWidthPixels[width];
  const { overlayRef, setOverlayRef, overlayPosition } = useAnchoredOverlayPosition({
    open,
    anchorRef: triggerRef,
    boundarySelector: ".desktop-agent-boundary",
    preferredWidth,
    preferredMaxHeight: agentPickerMaxHeightPixels,
    placementPreference: placement === "composer" ? "above" : "below",
  });

  useEffect(() => {
    if (!open) return undefined;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && (rootRef.current?.contains(event.target) || overlayRef.current?.contains(event.target))
      ) return;
      close(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    window.addEventListener("pointerdown", closeOnPointerDown, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOnPointerDown, true);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, overlayRef]);

  useEffect(() => () => {
    if (typeaheadRef.current.timer) window.clearTimeout(typeaheadRef.current.timer);
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    if (restoreTimerRef.current) window.clearTimeout(restoreTimerRef.current);
  }, []);

  const show = (focusDirection: "selected" | "first" | "last" = "selected") => {
    if (disabled) return;
    if (!open) {
      setOpen(true);
      setQuery("");
    }
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = undefined;
      const options = limitGroups(filterGroups(groups, "", locale), agentPickerLimits.maxRenderedOptions).flatMap((group) => group.options);
      const target = focusDirection === "last"
        ? options.at(-1)
        : focusDirection === "first"
          ? options[0]
          : options.find((option) => option.selected) ?? options[0];
      if (target) {
        setActiveOptionId(target.id);
        optionRefs.current.get(target.id)?.focus();
      }
    }, 0);
  };

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (focusTimerRef.current) window.clearTimeout(focusTimerRef.current);
    if (restoreTimerRef.current) window.clearTimeout(restoreTimerRef.current);
    if (restoreFocus) {
      restoreTimerRef.current = window.setTimeout(() => {
        restoreTimerRef.current = undefined;
        triggerRef.current?.focus();
      }, 0);
    }
  };

  const choose = (option: AgentPickerOption) => {
    if (!option.selectable) return;
    close(true);
    onSelect(option.id);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show(event.key === "ArrowUp" ? "last" : "first");
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLElement>, option: AgentPickerOption) => {
    const index = flatOptions.findIndex((entry) => entry.id === option.id);
    let nextIndex = index;
    if (event.key === "ArrowDown") nextIndex = Math.min(flatOptions.length - 1, index + 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = flatOptions.length - 1;
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(option);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      focusByTypeahead(event.key, flatOptions, optionRefs.current, typeaheadRef, locale);
      return;
    } else return;
    event.preventDefault();
    const target = flatOptions[nextIndex];
    if (target) {
      setActiveOptionId(target.id);
      optionRefs.current.get(target.id)?.focus();
    }
  };

  const renderOption = (option: AgentPickerOption) => (
    <DesktopMenuItem
      ref={(node) => {
        if (node) optionRefs.current.set(option.id, node);
        else optionRefs.current.delete(option.id);
      }}
      role="option"
      aria-selected={Boolean(option.selected)}
      aria-disabled={!option.selectable || undefined}
      tabIndex={option.id === activeOptionId ? 0 : -1}
      className="desktop-agent-picker-option"
      key={option.id}
      selected={option.selected}
      icon={option.icon === null ? undefined : option.icon || initial(option.label)}
      label={<bdi dir="auto">{option.label}</bdi>}
      detail={option.meta ? <bdi dir="auto">{option.meta}</bdi> : undefined}
      trailing={option.warning
        ? <span className="desktop-agent-picker-warning" title={option.warning} aria-label={option.warning}><CircleAlert size={14} strokeWidth={1.8} aria-hidden="true" /></span>
        : option.selected
          ? <Check className="desktop-agent-picker-check" size={14} aria-hidden="true" />
          : undefined}
      onClick={() => choose(option)}
      onFocus={() => setActiveOptionId(option.id)}
      onKeyDown={(event) => handleOptionKeyDown(event, option)}
    />
  );

  return (
    <div ref={rootRef} className={`desktop-agent-picker${placement === "header" ? " is-header" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className={`desktop-agent-picker-trigger${compact ? " is-compact" : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-description={triggerDescription || (compact && valueLabel
          ? t("agent.picker.selected", { value: bidiIsolate(valueLabel) })
          : undefined)}
        title={title}
        disabled={disabled}
        onClick={() => open ? close(false) : show()}
        onKeyDown={handleTriggerKeyDown}
      >
        {triggerIcon && <span className="desktop-agent-picker-trigger-mark">{triggerIcon}</span>}
        {!compact && <span className="desktop-agent-picker-trigger-value" dir="auto">{valueLabel || placeholder}</span>}
        {!compact && indicator === "chevron" && <ChevronDown size={12} aria-hidden="true" />}
      </button>
      {open && (
        <DesktopOverlayLayer>
          <DesktopMenuSurface
            ref={setOverlayRef}
            className="desktop-agent-overlay desktop-agent-picker-popover"
            elevation="compact"
            tone="quiet"
            typographySurface={placement === "header" ? "header" : "right-sidebar"}
            role="presentation"
            style={agentPickerOverlayGeometry(
              overlayPosition,
              preferredWidth,
              agentPickerMaxHeightPixels,
            )}
            data-positioned={overlayPosition ? "true" : "false"}
            data-placement={overlayPosition?.placement}
            data-window-no-drag="true"
          >
            {searchable && (
              <label className="desktop-agent-picker-search">
                <Search size={13} aria-hidden="true" />
                <span className="desktop-agent-visually-hidden">{t("agent.picker.search", { name: bidiIsolate(ariaLabel) })}</span>
                <input
                  value={query}
                  autoFocus
                  placeholder={t("agent.picker.search", { name: bidiIsolate(ariaLabel) })}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" || flatOptions.length === 0) return;
                    event.preventDefault();
                    setActiveOptionId(flatOptions[0].id);
                    optionRefs.current.get(flatOptions[0].id)?.focus();
                  }}
                />
              </label>
            )}
            <div
              id={popupId}
              className="desktop-agent-picker-list"
              data-po-scrollbar="content"
              role="listbox"
              aria-label={t("agent.picker.options", { name: bidiIsolate(ariaLabel) })}
            >
              {filteredGroups.length > 1 ? filteredGroups.map((group) => (
                <DesktopMenuSection
                  className="desktop-agent-picker-group"
                  role="group"
                  aria-label={group.label}
                  key={group.id}
                  label={<span aria-hidden="true">{group.label}</span>}
                >
                  {group.options.map(renderOption)}
                </DesktopMenuSection>
              )) : flatOptions.map(renderOption)}
              {flatOptions.length === 0 && <div className="desktop-agent-picker-empty">{t("agent.picker.noMatches")}</div>}
            </div>
            {truncated && (
              <div className="desktop-agent-picker-footer">
                <span role="status">{t("agent.picker.showing", { visible: flatOptions.length, total: matchedOptionCount })}</span>
              </div>
            )}
          </DesktopMenuSurface>
        </DesktopOverlayLayer>
      )}
    </div>
  );
}

function filterGroups(groups: AgentPickerGroup[], query: string, locale: string) {
  const normalized = query.trim().toLocaleLowerCase(locale);
  if (!normalized) return groups;
  return groups.flatMap((group) => {
    const options = group.options.filter((option) => (
      `${option.label} ${option.description || ""} ${option.meta || ""} ${option.keywords || ""}`
        .toLocaleLowerCase(locale)
        .includes(normalized)
    ));
    return options.length ? [{ ...group, options }] : [];
  });
}

function limitGroups(groups: AgentPickerGroup[], limit: number) {
  let remaining = limit;
  return groups.flatMap((group) => {
    if (remaining <= 0) return [];
    const options = group.options.slice(0, remaining);
    remaining -= options.length;
    return options.length ? [{ ...group, options }] : [];
  });
}

function focusByTypeahead(
  key: string,
  options: AgentPickerOption[],
  refs: Map<string, HTMLButtonElement>,
  state: React.MutableRefObject<{ value: string; timer: number | undefined }>,
  locale: string,
) {
  if (state.current.timer) window.clearTimeout(state.current.timer);
  state.current.value = `${state.current.value}${key}`.toLocaleLowerCase(locale);
  const target = options.find((option) => option.label.toLocaleLowerCase(locale).startsWith(state.current.value));
  if (target) refs.get(target.id)?.focus();
  state.current.timer = window.setTimeout(() => { state.current.value = ""; }, 500);
}

function initial(label: string) {
  return label.trim().slice(0, 1).toUpperCase();
}
