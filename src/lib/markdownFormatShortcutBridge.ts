import {
  MARKDOWN_FORMAT_ACTIVE_EVENT,
  MARKDOWN_FORMAT_SHORTCUT_EVENT,
  isMarkdownShortcutCommand,
} from "@puppyone/shared-ui";

export function startMarkdownFormatShortcutBridge(): () => void {
  const onActive = (event: Event) => {
    const active = event instanceof CustomEvent && event.detail?.active === true;
    window.puppyoneDesktop?.setMarkdownFormatShortcutsActive?.({ active });
  };
  window.addEventListener(MARKDOWN_FORMAT_ACTIVE_EVENT, onActive);

  const stopShortcutListener = window.puppyoneDesktop?.onMarkdownFormatShortcut?.((payload) => {
    if (!isMarkdownShortcutCommand(payload?.type)) return;
    window.dispatchEvent(new CustomEvent(MARKDOWN_FORMAT_SHORTCUT_EVENT, {
      detail: { type: payload.type },
    }));
  });

  return () => {
    window.removeEventListener(MARKDOWN_FORMAT_ACTIVE_EVENT, onActive);
    stopShortcutListener?.();
    window.puppyoneDesktop?.setMarkdownFormatShortcutsActive?.({ active: false });
  };
}
