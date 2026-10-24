// Run with: node tools/import-icons.mjs /path/to/puppyone/node_modules
// Geometry is from the same pinned Lucide package as the Electron product.
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const modules = path.resolve(process.argv[2] ?? '../node_modules');
const icons = ['house', 'laptop', 'message-square', 'settings', 'circle-help', 'chevron-right', 'chevron-down', 'file-text', 'folder', 'plus', 'arrow-up', 'asterisk', 'panel-left', 'sun', 'moon', 'git-branch', 'search', 'x', 'ellipsis', 'terminal', 'cloud', 'monitor', 'type', 'list-plus', 'shield-check', 'flask-conical', 'bot', 'plug', 'folder-cog', 'user-round', 'image-plus', 'history', 'refresh-cw', 'trash-2', 'pencil', 'copy', 'scissors', 'clipboard-paste', 'copy-plus', 'folder-open', 'external-link', 'link-2', 'folder-plus', 'file-plus-2', 'arrow-down', 'arrow-left', 'arrow-right', 'triangle-alert', 'circle-alert', 'rotate-ccw', 'unlink', 'check', 'loader-circle', 'chevron-up', 'chevron-left', 'forward', 'info', 'folder-input', 'folder-closed', 'file', 'image', 'paperclip', 'brain', 'sparkles', 'list-todo', 'key-round', 'download', 'circle', 'circle-slash-2', 'square-dashed', 'shield-alert', 'ellipsis-vertical', 'square-terminal', 'globe-2', 'list-tree', 'folder-search', 'wrench', 'minus', 'undo-2', 'server', 'credit-card', 'grip-vertical', 'square', 'search-code', 'file-search', 'file-pen-line', 'at-sign', 'lock-keyhole', 'workflow', 'layers', 'git-commit-horizontal', 'arrow-up-right', 'circle-check', 'circle-dot', 'list-tree', 'mouse-pointer-2', 'panel-right', 'columns-2', 'rows-2', 'hard-drive', 'cloud-off', 'arrow-down-right'];
await mkdir(path.join(root, 'assets/icons'), {recursive:true});
for (const name of icons) {
  // Lucide aliases re-export another file without __iconNode; import the canonical source.
  const aliases = {'circle-help': 'circle-question-mark', 'file-plus-2': 'file-plus-corner', 'globe-2': 'earth'};
  const sourceName = aliases[name] ?? name;
  const {__iconNode} = await import(pathToFileURL(path.join(modules, 'lucide-react/dist/esm/icons', `${sourceName}.js`)));
  const body = __iconNode.map(([tag, props]) => `<${tag} ${Object.entries(props).filter(([k])=>k!=='key').map(([k,v])=>`${k}="${v}"`).join(' ')}/>`).join('');
  const svg = stroke => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
  await writeFile(path.join(root, 'assets/icons', `${name}.svg`), svg(1.8));
  if (['house', 'settings', 'circle-help'].includes(name)) {
    await writeFile(path.join(root, 'assets/icons', `${name}-compact.svg`), svg(1.65));
  }
}
await copyFile(path.join(modules, 'lucide-react/LICENSE'), path.join(root, 'assets/icons/LICENSE'));
// Product-owned AgentEntryIcon (src/components/brand/AgentEntryIcon.tsx), same Lucide frame.
await writeFile(path.join(root, 'assets/icons', 'agent-entry.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12A4.5 4.5 0 0 1 22.5 8v5.5A4.5 4.5 0 0 1 18 18h-7l-3.9 3.05a1.1 1.1 0 0 1-1.77-.98l.25-2.55A4.5 4.5 0 0 1 1.5 13.5V8A4.5 4.5 0 0 1 6 3.5Z"/></svg>\n`);
// Product-owned FeedbackHelpIcon (src/features/app-shell/DesktopHelpLauncher.tsx), stroke-width 1.65.
await writeFile(path.join(root, 'assets/icons', 'feedback-help.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9.2C9.35 7.65 10.45 6.8 12 6.8C13.78 6.8 14.9 7.75 14.9 9.3C14.9 10.55 14.25 11.2 13.2 11.9C12.4 12.43 12 13 12 13.75"/><circle cx="12" cy="17" r="0.82" fill="white" stroke="none"/></svg>\n`);
// Product-owned TextEditorFrame mode icons (packages/shared-ui/src/editor/viewers/shared/TextEditorFrame.tsx).
const frame = body => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
await writeFile(path.join(root, 'assets/icons', 'editor-mode-edit.svg'), frame('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>'));
await writeFile(path.join(root, 'assets/icons', 'editor-mode-source.svg'), frame('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>'));
await writeFile(path.join(root, 'assets/icons', 'editor-mode-preview.svg'), frame('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'));
// Product-owned TreeDisclosureMarker (packages/shared-ui/src/data/ExplorerTree.tsx): a
// 12-unit chevron at stroke 1.6; the open state is the same path turned 90°.
const disclosure = d => `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>\n`;
await writeFile(path.join(root, 'assets/icons', 'tree-disclosure.svg'), disclosure('M4 2.5 7.5 6 4 9.5'));
await writeFile(path.join(root, 'assets/icons', 'tree-disclosure-open.svg'), disclosure('M9.5 4 6 7.5 2.5 4'));
// Product-owned `po-overflow-dots--vertical`: three 2px squares, 2px apart.
await writeFile(path.join(root, 'assets/icons', 'overflow-dots.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10" fill="white"><rect x="4" y="0" width="2" height="2"/><rect x="4" y="4" width="2" height="2"/><rect x="4" y="8" width="2" height="2"/></svg>\n`);
// Product-owned discovery spinner (.desktop-terminal-launcher-discovery-spinner):
// an 11px ring with a 1.5px border whose top edge carries the current colour.
await writeFile(path.join(root, 'assets/icons', 'spinner-track.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="white" stroke-width="1.5"><circle cx="5.5" cy="5.5" r="4.75"/></svg>\n`);
await writeFile(path.join(root, 'assets/icons', 'spinner-arc.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="white" stroke-width="1.5"><path d="M2.141 2.141A4.75 4.75 0 0 1 8.859 2.141"/></svg>\n`);
// VersionControlIcon (source-control): the product's Changes glyph.
await writeFile(path.join(root, 'assets/icons', 'version-control.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="6" r="3"/><path d="M5 9v12"/><circle cx="19" cy="18" r="3"/><path d="m15 9-3-3 3-3"/><path d="M12 6h5a2 2 0 0 1 2 2v7"/></svg>\n`);
// DesktopDialogCloseButton: its own 16-unit cross, drawn into a 12px box.
await writeFile(path.join(root, 'assets/icons', 'dialog-close.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="1.75" stroke-linecap="round"><path d="M5 5L11 11M11 5L5 11"/></svg>\n`);
// Chromium's `resize: vertical` grip (the Files pattern textarea), traced in
// device pixels at 2x: a 1px shadow pair (x+y=14, x+y=22) and, in dark
// schemes, a 1.4px highlight pair two pixels further out.
await writeFile(path.join(root, 'assets/icons', 'textarea-resizer.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="1"><path d="M14 0L0 14M14 8L8 14"/></svg>\n`);
await writeFile(path.join(root, 'assets/icons', 'textarea-resizer-highlight.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="white" stroke-width="1.4"><path d="M16 0L0 16M16 8L8 16"/></svg>\n`);
// Product-owned AgentToolGlyph frames (src/features/desktop-agent/ui/activity/AgentToolGlyph.tsx):
// 18-unit paths drawn at 16px with a non-scaling 1.8px stroke (2.025 units).
{
  const glyph = body => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="white" stroke-width="2.025" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
  const parts = {"agent-glyph-search": "<circle cx=\"7.25\" cy=\"7.25\" r=\"4.25\"/><path d=\"m10.45 10.45 4 4\"/>", "agent-glyph-read": "<path d=\"M4 2.5h6.25L14 6.25V15.5H4z\"/><path d=\"M10.25 2.5v3.75H14\"/><path d=\"M6.25 9h5.5M6.25 12h4.25\"/>", "agent-glyph-read-scan": "<path d=\"M5.75 8h6.5\"/>", "agent-glyph-edit-base": "<path d=\"M3.25 15h5.2\"/>", "agent-glyph-write-base": "<path d=\"M3.25 3h6.5M3.25 6h4.5\"/>", "agent-glyph-ink": "<path d=\"M3.5 14.25c1.6-.15 3.15-.55 4.55-1.2\"/>", "agent-glyph-pen": "<path d=\"m5.25 12.5.65-2.65 6.7-6.7 2.25 2.25-6.7 6.7z\"/><path d=\"m11.45 4.3 2.25 2.25\"/>"};
  parts['agent-glyph-edit'] = parts['agent-glyph-edit-base'] + parts['agent-glyph-ink'] + parts['agent-glyph-pen'];
  parts['agent-glyph-write'] = parts['agent-glyph-write-base'] + parts['agent-glyph-ink'] + parts['agent-glyph-pen'];
  for (const [name, body] of Object.entries(parts)) await writeFile(path.join(root, 'assets/icons', `${name}.svg`), glyph(body));
}
// Product-owned editable-table menu icons (packages/shared-ui/src/editor/table/editableTableMenuIcons.ts,
// drawn by EditableTableMenuIcon.tsx at stroke-width 1.75).
{
  const { readFile } = await import('node:fs/promises');
  const product = path.resolve(modules, '..');
  const source = await readFile(path.join(product, 'packages/shared-ui/src/editor/table/editableTableMenuIcons.ts'), 'utf8');
  const table = body => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
  for (const [, name, paths] of source.matchAll(/^\s*"?([a-z-]+)"?: icon\(((?:path\("[^"]*"\)(?:, )?)+)\),$/gm)) {
    const body = [...paths.matchAll(/path\("([^"]*)"\)/g)].map(([, d]) => `<path d="${d}"/>`).join('');
    await writeFile(path.join(root, 'assets/icons', `table-${name}.svg`), table(body));
  }
}
