import { useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { HTML_STYLE_PROPERTIES, type HtmlEditOperation, type HtmlStyleProperty } from "./htmlEditCompiler";

export function HtmlInspector({ tag, text, image, alt, styles, disabled, canImport, apply, startText, importImage }: {
  tag: string; text: boolean; image: boolean; alt: string; disabled: boolean; canImport: boolean;
  styles: Record<string, string | boolean>;
  apply: (operation: HtmlEditOperation) => boolean; startText: () => void; importImage: (file: File) => void;
}) {
  const { t } = useLocalization();
  const [property, setProperty] = useState<HtmlStyleProperty>("color");
  const [value, setValue] = useState(String(styles.color ?? ""));
  const [altValue, setAltValue] = useState(alt);
  return <aside className="html-editor-inspector" aria-label={t("editor.html.properties")}>
    <strong>{`<${tag}>`}</strong>
    {text && <button type="button" disabled={disabled} onClick={startText}>{t("editor.html.editText")}</button>}
    {image && <>
      <label>{t("editor.html.replaceImage")}<input type="file" accept="image/png,image/jpeg,image/gif,image/webp"
        disabled={disabled || !canImport} onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
          if (file) importImage(file);
        }} /></label>
      <form onSubmit={(event) => { event.preventDefault(); apply({ kind: "attribute", name: "alt", value: altValue }); }}>
        <label>{t("editor.html.altText")}<input value={altValue} disabled={disabled} onChange={(event) => setAltValue(event.target.value)} /></label>
        <button type="submit" disabled={disabled}>{t("editor.html.apply")}</button>
      </form>
    </>}
    <form onSubmit={(event) => { event.preventDefault(); apply({ kind: "style", property, value }); }}>
      <label>{t("editor.html.styleProperty")}<select value={property} disabled={disabled} onChange={(event) => {
        const next = event.target.value as HtmlStyleProperty;
        setProperty(next); setValue(String(styles[next.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())] ?? ""));
      }}>
        {HTML_STYLE_PROPERTIES.map((name) => <option key={name} value={name}>{t(`editor.html.style.${name}`)}</option>)}
      </select></label>
      <label>{t("editor.html.styleValue")}<input value={value} disabled={disabled} placeholder={t("editor.html.styleHint")}
        onChange={(event) => setValue(event.target.value)} /></label>
      <button type="submit" disabled={disabled}>{t("editor.html.apply")}</button>
      <button type="button" disabled={disabled} onClick={() => { if (apply({ kind: "style", property, value: "" })) setValue(""); }}>{t("editor.html.removeStyle")}</button>
    </form>
    <small>{t("editor.html.elementStyleHint")}</small>
  </aside>;
}
