import { listFolderChildren, workspaceFromPath } from "../local-api/workspace.mjs";

const rootPath = process.argv[2] ?? process.cwd();
const workspace = await workspaceFromPath(rootPath);
const children = await listFolderChildren(workspace.path, null);

console.log(JSON.stringify({
  workspace,
  childCount: children.length,
  firstChildren: children.slice(0, 8).map((node) => ({
    name: node.name,
    type: node.type,
    size: node.size,
  })),
}, null, 2));
