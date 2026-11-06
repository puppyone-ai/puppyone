import { createNotionApi, requireNotionId, notionTitle, portableTitle } from '../notion/api.mjs';
import { materializeNotion } from '../notion/materialize.mjs';

export function createImportSource({ fetchImpl = globalThis.fetch, connectNotion = async () => { throw new Error('Notion authorization service is not configured.'); } } = {}) {
  return Object.freeze({
    mode: 'remote',
    connect: async context => ({ ...await connectNotion(context), starterFiles: context.starterFiles ?? [] }),
    async listResources({ connection, parentId, cursor }) {
      if (parentId !== null && parentId !== undefined) throw new Error('Choose a page from the authorized Notion resource list.');
      const request = createNotionApi({ ...connection, fetchImpl });
      const page = await request('/search', { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      if (!Array.isArray(page.results)) throw new Error('Notion returned an invalid resource list.');
      connection.resources ??= new Map();
      const items = page.results.filter(item => ['page', 'data_source'].includes(item.object) && !item.in_trash && !item.archived).map(item => {
        requireNotionId(item.id);
        connection.resources.set(item.id, item.object);
        return { id: item.id, name: notionTitle(item), kind: item.object === 'page' ? 'document' : 'database' };
      });
      if (page.has_more && (typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === cursor)) throw new Error('Notion returned an invalid pagination cursor.');
      return { items, nextCursor: page.has_more ? page.next_cursor : null };
    },
    async inspect(source, { connection, signal }) {
      const id = requireNotionId(source.resourceId);
      const kind = connection.resources?.get(id) === 'data_source' ? 'data_sources' : 'pages';
      const root = await createNotionApi({ ...connection, fetchImpl, signal })('/' + kind + '/' + id);
      return { name: portableTitle(notionTitle(root)) + ' ' + id, source: { resourceId: id, root, includeSubpages: source.includeSubpages !== false } };
    },
    materialize: options => materializeNotion({ ...options, fetchImpl }),
  });
}
