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
// Product-owned discovery spinner (.desktop-terminal-launcher-discovery-spinner):
// an 11px ring with a 1.5px border whose top edge carries the current colour.
await writeFile(path.join(root, 'assets/icons', 'spinner-track.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="white" stroke-width="1.5"><circle cx="5.5" cy="5.5" r="4.75"/></svg>\n`);
await writeFile(path.join(root, 'assets/icons', 'spinner-arc.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="white" stroke-width="1.5"><path d="M2.141 2.141A4.75 4.75 0 0 1 8.859 2.141"/></svg>\n`);
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
