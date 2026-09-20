import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useLocalization } from "@puppyone/localization/react";

export function HtmlTextInput({ initial, style, apply, finish, registerPrepare }: {
  initial: string; style: CSSProperties; apply: (value: string) => boolean; finish: () => void;
  registerPrepare: (prepare: (() => void) | null) => void;
}) {
  const { t } = useLocalization();
  const [value, setValue] = useState(initial);
  const composing = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const applyRef = useRef(apply); applyRef.current = apply;
  const valueRef = useRef(value); valueRef.current = value;
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
    registerPrepare(() => {
      if (composing.current) input.current?.blur();
      if (composing.current) throw new Error(t("editor.html.finishComposition"));
      if (!applyRef.current(valueRef.current)) throw new Error(t("editor.html.editFailed"));
    });
    return () => registerPrepare(null);
  }, [registerPrepare, t]);
  return <textarea ref={input} className="html-editor-text-input" style={style} value={value}
    aria-label={t("editor.html.editText")} spellCheck
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={(event) => { composing.current = false; valueRef.current = event.currentTarget.value; apply(event.currentTarget.value); }}
    onChange={(event) => {
      valueRef.current = event.target.value; setValue(event.target.value);
      if (!composing.current) apply(event.target.value);
    }}
    onBlur={(event) => {
      if (!composing.current) {
        apply(valueRef.current);
        if (!(event.relatedTarget instanceof Element) || !event.relatedTarget.closest("[data-html-control]")) finish();
      }
    }}
    onKeyDown={(event) => {
      if (composing.current || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); finish(); }
      else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish(); }
      else if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "z" || event.ctrlKey && event.key.toLowerCase() === "y")) {
        // The surface owns the single document history; native textarea history must not diverge.
        event.preventDefault(); finish();
      }
    }} />;
}
