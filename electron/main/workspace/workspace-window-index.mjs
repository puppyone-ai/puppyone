/** Membership tracks open roots; it never chooses a user's destination window. */
export class WorkspaceWindowIndex {
  #windows = new Map();

  add(rootPath, window) {
    let members = this.#windows.get(rootPath);
    if (!members) { members = new Set(); this.#windows.set(rootPath, members); }
    members.add(window);
  }

  remove(rootPath, window) {
    const members = this.#windows.get(rootPath);
    if (!members) return;
    members.delete(window);
    if (!members.size) this.#windows.delete(rootPath);
  }

  has(rootPath) {
    const members = this.#windows.get(rootPath);
    if (!members) return false;
    for (const window of members) if (window.isDestroyed()) members.delete(window);
    if (!members.size) this.#windows.delete(rootPath);
    return members.size > 0;
  }
}
