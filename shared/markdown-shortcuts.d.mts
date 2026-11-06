export type MarkdownShortcutDefinition = Readonly<{
  id: string; labelId: string; keys: readonly string[]; mac?: readonly string[]; menu: boolean;
}>;
export const MARKDOWN_SHORTCUT_DEFINITIONS: readonly MarkdownShortcutDefinition[];
export function isMarkdownShortcutCommand(value: unknown): value is string;
export function matchMarkdownShortcutInput(input: {
  type?: string; key?: string; code?: string; meta?: boolean; control?: boolean;
  alt?: boolean; shift?: boolean; isAutoRepeat?: boolean; isComposing?: boolean;
}, platform: string): string | null;
