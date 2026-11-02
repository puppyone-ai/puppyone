import { Facet, type Extension } from "@codemirror/state";
import { placeholder } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import type {
  AppLocale,
  AppTextDirection,
  MessageFormatter,
  MessageValues,
} from "@puppyone/localization/core";

export type MarkdownLocalization = Readonly<{
  direction: AppTextDirection;
  formatNumber: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  locale: AppLocale;
  t: MessageFormatter;
}>;

const missingFormatter: MessageFormatter = (messageId) => messageId;
const missingLocalization: MarkdownLocalization = Object.freeze({
  direction: "ltr",
  formatNumber: (value) => String(value),
  locale: "en",
  t: missingFormatter,
});

export const markdownLocalizationFacet = Facet.define<MarkdownLocalization, MarkdownLocalization>({
  combine(values) {
    return values.at(-1) ?? missingLocalization;
  },
});

export function markdownLocalizationExtension(
  localization: MarkdownLocalization,
  readOnly: boolean,
): Extension {
  return [
    markdownLocalizationFacet.of(localization),
    placeholder(readOnly ? "" : localization.t("editor.text.placeholder")),
  ];
}

export function getMarkdownMessage(
  view: EditorView,
  messageId: string,
  values?: MessageValues,
): string {
  return view.state.facet(markdownLocalizationFacet).t(messageId, values);
}

export function getMarkdownMessageFormatter(view: EditorView): MessageFormatter {
  return view.state.facet(markdownLocalizationFacet).t;
}

export function getMarkdownLocalization(view: EditorView): MarkdownLocalization {
  return view.state.facet(markdownLocalizationFacet);
}
