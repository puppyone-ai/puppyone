export const TYPOGRAPHY_CHANGE_EVENT = "puppyone:typography-change";

export type TypographyChangePhase = "applied" | "ready";

export type TypographyChangeDetail = {
  generation: number;
  phase: TypographyChangePhase;
};

export function dispatchTypographyChange(
  document: Document,
  detail: TypographyChangeDetail,
) {
  document.dispatchEvent(new CustomEvent<TypographyChangeDetail>(TYPOGRAPHY_CHANGE_EVENT, {
    detail,
  }));
}

export function subscribeTypographyChanges(
  document: Document,
  callback: (detail: TypographyChangeDetail) => void,
) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<TypographyChangeDetail>).detail;
    if (!detail) return;
    callback(detail);
  };
  document.addEventListener(TYPOGRAPHY_CHANGE_EVENT, listener);
  return () => document.removeEventListener(TYPOGRAPHY_CHANGE_EVENT, listener);
}
