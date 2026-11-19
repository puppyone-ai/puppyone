import type { AppLocale } from "./types";

type DateValue = Date | number | string;

function toDate(value: DateValue): Date {
  return value instanceof Date ? value : new Date(value);
}

function optionsKey(options: object | undefined): string {
  return options ? JSON.stringify(options) : "default";
}

export function createLocaleFormatters(locale: AppLocale) {
  const numberFormatters = new Map<string, Intl.NumberFormat>();
  const dateFormatters = new Map<string, Intl.DateTimeFormat>();
  const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
  const listFormatters = new Map<string, Intl.ListFormat>();
  const collators = new Map<string, Intl.Collator>();

  return Object.freeze({
    formatNumber(value: number | bigint, options?: Intl.NumberFormatOptions) {
      const key = optionsKey(options);
      let formatter = numberFormatters.get(key);
      if (!formatter) {
        formatter = new Intl.NumberFormat(locale, options);
        numberFormatters.set(key, formatter);
      }
      return formatter.format(value);
    },
    formatDate(value: DateValue, options?: Intl.DateTimeFormatOptions) {
      const key = optionsKey(options);
      let formatter = dateFormatters.get(key);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, options);
        dateFormatters.set(key, formatter);
      }
      return formatter.format(toDate(value));
    },
    formatRelativeTime(
      value: number,
      unit: Intl.RelativeTimeFormatUnit,
      options?: Intl.RelativeTimeFormatOptions,
    ) {
      const key = optionsKey(options);
      let formatter = relativeTimeFormatters.get(key);
      if (!formatter) {
        formatter = new Intl.RelativeTimeFormat(locale, options);
        relativeTimeFormatters.set(key, formatter);
      }
      return formatter.format(value, unit);
    },
    formatList(values: readonly string[], options?: Intl.ListFormatOptions) {
      const key = optionsKey(options);
      let formatter = listFormatters.get(key);
      if (!formatter) {
        formatter = new Intl.ListFormat(locale, options);
        listFormatters.set(key, formatter);
      }
      return formatter.format(values);
    },
    getCollator(options?: Intl.CollatorOptions) {
      const key = optionsKey(options);
      let collator = collators.get(key);
      if (!collator) {
        collator = new Intl.Collator(locale, options);
        collators.set(key, collator);
      }
      return collator;
    },
  });
}

export type LocaleFormatters = ReturnType<typeof createLocaleFormatters>;
