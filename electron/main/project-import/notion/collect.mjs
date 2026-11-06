import { checkCancelled, paginate, requireNotionId, notionTitle, portableTitle } from './api.mjs';

/** Traverse containment only. Ordinary links never expand the user's selection. */
export async function collectNotionContent({ root, request, includeSubpages, signal, addSnapshot, issues, maxPages = 1000 }) {
  const pages = []; const tables = []; const assets = []; const seen = new Set(); let blocksRead = 0;
  const note = (code, id, detail) => issues.push({ code, id, detail });
  const snapshot = async (name, value) => { await addSnapshot(name, value); return value; };
  async function descend(object, depth = 0) {
    checkCancelled(signal);
    const id = requireNotionId(object.id);
    const identity = object.object + ':' + id;
    if (seen.has(identity)) return;
    if (depth > 64 || seen.size >= maxPages) throw new Error('Notion import exceeds the page/depth limit. Choose a smaller subtree.');
    seen.add(identity);
    await snapshot(id + '.' + object.object + '.json', object);
    if (object.object === 'database') {
      for (const source of object.data_sources ?? []) await contained('data_sources', source.id, depth);
      if (!object.data_sources?.length) note('database_unavailable', id, 'No accessible data source was returned.');
      return;
    }
    const title = notionTitle(object);
    if (object.object === 'data_source') {
      const rows = [];
      let pageNumber = 0;
      for await (const page of paginate(request, '/data_sources/' + id + '/query', {})) {
        await snapshot(id + '.rows-' + pageNumber++ + '.json', page);
        rows.push(...page.results);
        if (rows.length > maxPages) throw new Error('Notion database exceeds the row limit.');
        for (const row of page.results) await descend(row, depth + 1);
      }
      tables.push({ id, title, rows, columns: Object.keys(object.properties ?? {}), path: 'content/' + portableTitle(title) + ' ' + id + '.csv' });
      return;
    }
    const markdown = await snapshot(id + '.markdown.json', await request('/pages/' + id + '/markdown?markdown_version=v2'));
    if (typeof markdown.markdown !== 'string') throw new Error('Notion returned invalid Markdown.');
    pages.push({ id, title, sourceUrl: object.url ?? 'https://www.notion.so/' + id, path: 'content/' + portableTitle(title) + ' ' + id + '.md', markdown: markdown.markdown });
    if (markdown.truncated || markdown.unknown_block_ids?.length) note('incomplete_page', id, 'Content is truncated or inaccessible: ' + (markdown.unknown_block_ids ?? []).join(', '));
    if (Object.values(object.properties ?? {}).some(p => p.has_more)) note('incomplete_properties', id, 'Some properties are paginated; the raw page response is retained.');
    collectAssets(object);
    await walkBlocks(id, depth, 0);
  }
  async function contained(kind, id, depth) {
    try { await descend(await request('/' + kind + '/' + requireNotionId(id)), depth + 1); }
    catch (error) {
      if (error.status === 403 || error.status === 404) note('inaccessible_resource', id, 'The selected subtree contains a resource not shared with this connection.');
      else throw error;
    }
  }
  async function walkBlocks(id, depth, blockDepth) {
    if (blockDepth > 64) throw new Error('Notion block depth limit exceeded.');
    let pageNumber = 0;
    for await (const page of paginate(request, '/blocks/' + id + '/children')) {
      await snapshot(id + '.blocks-' + pageNumber++ + '.json', page);
      for (const block of page.results) {
        if (++blocksRead > 50000) throw new Error('Notion block count limit exceeded.');
        collectAssets(block);
        if (block.type === 'child_page' || block.type === 'child_database') {
          if (includeSubpages) await contained(block.type === 'child_page' ? 'pages' : 'databases', block.id, depth);
        } else if (block.type === 'unsupported') note('unsupported_block', block.id, 'Notion does not expose this block through the content API.');
        else if (block.has_children) await walkBlocks(requireNotionId(block.id), depth, blockDepth + 1);
      }
    }
  }
  function collectAssets(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type === 'file' && typeof value.file?.url === 'string') assets.push({ url: value.file.url, name: value.name ?? null });
    if (value.type === 'external' && typeof value.external?.url === 'string') note('external_resource', root.id, 'External media remains a remote reference.');
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(collectAssets);
      else if (child && typeof child === 'object') collectAssets(child);
    }
  }
  await descend(root);
  return { pages, tables, assets };
}
