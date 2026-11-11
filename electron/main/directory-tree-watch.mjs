import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

/** Linux recursive fs.watch tracks file inodes and can lose an atomically
 * replaced file. Watch directories instead: their events include writes to
 * every replacement inode, without allocating a watch for every file. */
export function watchDirectoryTree(rootPath, listener, fsModule = fs) {
  const tree = new EventEmitter();
  const directories = new Map();
  let closed = false;
  const root = path.resolve(rootPath);
  const remove = (directory) => {
    for (const [name, entry] of directories) {
      if (name === directory || name.startsWith(`${directory}${path.sep}`)) {
        entry.watcher.close();
        directories.delete(name);
      }
    }
  };
  tree.close = () => {
    if (closed) return;
    closed = true;
    remove(root);
    tree.emit("close");
  };
  const scan = (directory) => {
    const children = new Set();
    for (const entry of fsModule.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      const child = path.join(directory, entry.name);
      children.add(child);
      attach(child);
    }
    for (const name of directories.keys()) {
      if (path.dirname(name) === directory && !children.has(name)) remove(name);
    }
  };
  const attach = (directory) => {
    const stat = fsModule.statSync(directory);
    const previous = directories.get(directory);
    if (previous?.ino === stat.ino && previous?.dev === stat.dev) return;
    if (previous) remove(directory);
    const watcher = fsModule.watch(directory, { recursive: false }, (eventType, filename) => {
      if (closed) return;
      const relative = typeof filename === "string"
        ? path.relative(root, path.join(directory, filename)).split(path.sep).join("/")
        : null;
      listener(eventType, relative);
      if (eventType === "rename") {
        try { scan(directory); }
        catch (error) {
          if (directory !== root && error.code === "ENOENT") remove(directory);
          else tree.emit("error", error);
        }
      }
    });
    directories.set(directory, { watcher, ino: stat.ino, dev: stat.dev });
    watcher.on("error", (error) => { if (!closed) tree.emit("error", error); });
    scan(directory);
  };
  try { attach(root); }
  catch (error) { tree.close(); throw error; }
  return tree;
}
