import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, ImagePlus, Type, RotateCcw } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { HtmlSelectionMessage } from "./htmlBridgeProtocol";
import type { HtmlEditOperation, HtmlStyleProperty } from "./htmlEditCompiler";

const COLORS = ["#111827", "#64748b", "#ffffff", "#ef4444", "#f97316", "#22c55e", "#14b8a6", "#2563eb", "#8b5cf6"];

/** Host-owned controls stay inside their pane; document styles cannot reach this toolbar. */
export function HtmlFloatingToolbar({ selection, viewport, text, image, alt, disabled, canImport, apply, importImage, dismiss, onNativeControl, onCompositionChange }: {
  selection: HtmlSelectionMessage; viewport: RefObject<HTMLDivElement>; text: boolean; image: boolean;
  alt: string; disabled: boolean; canImport: boolean; onNativeControl: (open: boolean) => void;
  onCompositionChange: (composing: boolean) => void;
  apply: (operation: HtmlEditOperation) => boolean; importImage: (file: File) => void; dismiss: () => void;
}) {
  const { t } = useLocalization();
  const toolbar = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<CSSProperties>({});
  const [palette, setPalette] = useState<"color" | "background-color" | "alt" | null>(null);
  const [altValue, setAltValue] = useState(alt);
  const altComposing = useRef(false);
  const styles = selection.styles;
  useEffect(() => {
    const element = toolbar.current;
    const release = () => onNativeControl(false);
    element?.addEventListener("cancel", release, true);
    window.addEventListener("focus", release);
    return () => { release(); onCompositionChange(false); element?.removeEventListener("cancel", release, true); window.removeEventListener("focus", release); };
  }, [onNativeControl, onCompositionChange]);
  useLayoutEffect(() => {
    const pane = viewport.current, element = toolbar.current;
    if (!pane || !element) return;
    const place = () => {
      const trigger = element.querySelector<HTMLElement>(`[data-palette="${palette}"]`);
      const paneRect = pane.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const center = trigger ? trigger.getBoundingClientRect().left + trigger.offsetWidth / 2 - elementRect.left : elementRect.width / 2;
      const minimum = paneRect.left + 8 - elementRect.left;
      const maximum = paneRect.right - 8 - elementRect.left - 154;
      setPopoverPosition({ left: Math.max(minimum, Math.min(center - 77, Math.max(minimum, maximum))) });
    };
    place();
    const observer = new ResizeObserver(place); observer.observe(pane); observer.observe(element);
    return () => observer.disconnect();
  }, [viewport, palette]);
  const style = (property: HtmlStyleProperty, value: string) => apply({ kind: "style", property, value });
  const button = (label: string, icon: ReactNode, action: () => void, pressed?: boolean) => <button type="button"
    title={label} aria-label={label} disabled={disabled} aria-pressed={pressed} onClick={action}>{icon}</button>;
  const colorButton = (property: "color" | "background-color", value: string) => {
    const textColor = property === "color";
    return <button type="button" className="html-floating-toolbar__color-control"
      title={t(`editor.html.style.${property}`)} aria-label={t(`editor.html.style.${property}`)} disabled={disabled}
      data-palette={property} data-color-role={textColor ? "text" : "background"}
      aria-expanded={palette === property} aria-haspopup="dialog"
      onClick={() => setPalette(palette === property ? null : property)}>
      {textColor
        ? <span className="html-floating-toolbar__text-color" aria-hidden="true">
          <span className="html-floating-toolbar__text-color-glyph" style={{ color: value }}>A</span>
        </span>
        : <span className="html-floating-toolbar__background-color-value" aria-hidden="true">
          <span style={{ background: value }} />
        </span>}
    </button>;
  };
  const weight = Number.parseInt(String(styles.fontWeight), 10);
  const bold = weight >= 600 || styles.fontWeight === "bold";
  return <div ref={toolbar} className="html-floating-toolbar" data-html-control
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (palette) setPalette(null); else dismiss(); }
    }}
    onPointerDown={(event) => {
      // Keep the text caret/selection when clicking a formatting button. Inputs still receive focus.
      if ((event.target as Element).closest("button")) event.preventDefault();
      event.stopPropagation();
    }}>
    <div className="html-floating-toolbar__row" role="toolbar" aria-label={t("editor.html.formatText")}>
      {text && <>
        <select aria-label={t("editor.html.style.font-size")} title={t("editor.html.style.font-size")}
          value={String(styles.fontSize ?? "16px")} disabled={disabled}
          onPointerDown={() => onNativeControl(true)} onBlur={() => onNativeControl(false)}
          onKeyDown={(event) => { if (event.key === "Escape" || event.key === "Enter") onNativeControl(false); }}
          onChange={(event) => { onNativeControl(false); style("font-size", event.target.value); }}>
          {[...new Set([12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 72].map((size) => `${size}px`).concat(String(styles.fontSize ?? "16px")))]
            .sort((a, b) => parseFloat(a) - parseFloat(b)).map((value) => <option key={value} value={value}>{parseFloat(value)}</option>)}
        </select>
        <span className="html-floating-toolbar__divider" />
        {button(t("editor.html.bold"), <Bold size={16} />, () => style("font-weight", bold ? "400" : "700"), bold)}
        {colorButton("color", String(styles.color))}
      </>}
      {colorButton("background-color", String(styles.backgroundColor))}
      {text && <>
        <span className="html-floating-toolbar__divider" />
        {(["left", "center", "right"] as const).map((align) => <button key={align} type="button" disabled={disabled}
          title={t(`editor.html.align.${align}`)} aria-label={t(`editor.html.align.${align}`)}
          aria-pressed={styles.textAlign === align || styles.textAlign === "start" && align === "left"}
          onClick={() => style("text-align", align)}>
          {align === "left" ? <AlignLeft size={16} /> : align === "center" ? <AlignCenter size={16} /> : <AlignRight size={16} />}
        </button>)}
      </>}
      {image && <>
        <label className="html-floating-toolbar__image" title={t("editor.html.replaceImage")} aria-disabled={disabled || !canImport}>
          <ImagePlus size={16} /><span>{t("editor.html.replaceImage")}</span>
          <input type="file" aria-label={t("editor.html.replaceImage")} accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={disabled || !canImport} onClick={() => onNativeControl(true)} onChange={(event) => {
              onNativeControl(false);
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
              if (file) importImage(file);
            }} />
        </label>
        {button(t("editor.html.altText"), <Type size={16} />, () => setPalette(palette === "alt" ? null : "alt"), palette === "alt")}
      </>}
    </div>
    {palette && <div className="html-floating-toolbar__popover" style={popoverPosition} role="dialog"
      aria-label={t(palette === "alt" ? "editor.html.altText" : `editor.html.style.${palette}`)}>
      {palette === "alt" ? <input aria-label={t("editor.html.altText")} placeholder={t("editor.html.altText")}
        value={altValue} disabled={disabled} onChange={(event) => {
          setAltValue(event.target.value);
          if (!altComposing.current) apply({ kind: "attribute", name: "alt", value: event.target.value });
        }}
        onCompositionStart={() => { altComposing.current = true; onCompositionChange(true); }}
        onCompositionEnd={(event) => {
          altComposing.current = false; apply({ kind: "attribute", name: "alt", value: event.currentTarget.value }); onCompositionChange(false);
        }}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          apply({ kind: "attribute", name: "alt", value: altValue }); setPalette(null);
        } }} /> : <>
        <div className="html-floating-toolbar__swatches">
          {COLORS.map((color) => <button key={color} type="button" className="html-floating-toolbar__swatch"
            aria-label={t("editor.html.chooseColor", { color })} title={color} disabled={disabled} style={{ background: color }}
            onClick={() => { style(palette, color); setPalette(null); }} />)}
          <button type="button" className="html-floating-toolbar__reset" disabled={disabled}
            title={t("editor.html.removeStyle")} aria-label={t("editor.html.removeStyle")}
            onClick={() => { style(palette, ""); setPalette(null); }}><RotateCcw size={13} /></button>
        </div>
      </>}
    </div>}
  </div>;
}
