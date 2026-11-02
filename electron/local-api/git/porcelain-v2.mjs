/** Parse `git status --porcelain=v2 -z --branch` output into the desktop model. */
export function parseGitPorcelainV2Status(output) {
  const entries = [];
  const headers = {};
  const records = output.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("# ")) {
      const spaceIndex = record.indexOf(" ", 2);
      if (spaceIndex > 2) headers[record.slice(2, spaceIndex)] = record.slice(spaceIndex + 1);
      continue;
    }

    const type = record[0];
    if (type === "1") {
      const entry = parseOrdinaryRecord(record);
      if (entry) entries.push(entry);
      continue;
    }
    if (type === "2") {
      const { entry, consumedNext } = parseRenameRecord(record, records[index + 1]);
      if (entry) entries.push(entry);
      if (consumedNext) index += 1;
      continue;
    }
    if (type === "u") {
      const entry = parseUnmergedRecord(record);
      if (entry) entries.push(entry);
      continue;
    }
    if (type === "?") {
      const filePath = record.slice(2);
      if (filePath) {
        entries.push({
          path: filePath,
          oldPath: null,
          staged: "?",
          unstaged: "?",
          status: "untracked",
        });
      }
    }
  }

  return { headers, entries };
}

function parseOrdinaryRecord(record) {
  const fields = splitRecord(record, 8);
  if (fields.length < 9) return null;
  const xy = fields[1] || "  ";
  const filePath = fields[8];
  if (!filePath) return null;
  return buildStatusEntry({
    path: filePath,
    oldPath: null,
    staged: xy[0] || " ",
    unstaged: xy[1] || " ",
  });
}

function parseRenameRecord(record, nextRecord) {
  const fields = splitRecord(record, 9);
  if (fields.length < 10) return { entry: null, consumedNext: false };

  const xy = fields[1] || "  ";
  const pathText = fields[9] || "";
  const tabIndex = pathText.indexOf("\t");
  const filePath = tabIndex >= 0 ? pathText.slice(0, tabIndex) : pathText;
  const oldPathFromRecord = tabIndex >= 0 ? pathText.slice(tabIndex + 1) : null;
  const oldPathFromNext = oldPathFromRecord ?? nextRecord ?? null;
  const consumedNext = Boolean(!oldPathFromRecord && oldPathFromNext);

  return {
    consumedNext,
    entry: filePath
      ? buildStatusEntry({
        path: filePath,
        oldPath: oldPathFromNext,
        staged: xy[0] || " ",
        unstaged: xy[1] || " ",
      })
      : null,
  };
}

function parseUnmergedRecord(record) {
  const fields = splitRecord(record, 10);
  if (fields.length < 11) return null;
  const xy = fields[1] || "UU";
  const filePath = fields[10];
  if (!filePath) return null;
  return buildStatusEntry({
    path: filePath,
    oldPath: null,
    staged: xy[0] || "U",
    unstaged: xy[1] || "U",
    conflict: true,
  });
}

function splitRecord(record, fixedFieldCount) {
  const fields = [];
  let cursor = 0;
  for (let index = 0; index < fixedFieldCount; index += 1) {
    const nextSpace = record.indexOf(" ", cursor);
    if (nextSpace < 0) {
      fields.push(record.slice(cursor));
      return fields;
    }
    fields.push(record.slice(cursor, nextSpace));
    cursor = nextSpace + 1;
  }
  fields.push(record.slice(cursor));
  return fields;
}

function buildStatusEntry({ path, oldPath, staged, unstaged, conflict = false }) {
  const normalizedStaged = normalizeStatusCode(staged);
  const normalizedUnstaged = normalizeStatusCode(unstaged);
  return {
    path,
    oldPath: oldPath || null,
    staged: normalizedStaged,
    unstaged: normalizedUnstaged,
    status: conflict
      ? "conflict"
      : getStatusLabel(normalizedStaged ?? " ", normalizedUnstaged ?? " "),
    ...(conflict ? { conflict: true } : {}),
  };
}

function normalizeStatusCode(code) {
  if (!code || code === " " || code === ".") return null;
  return code.trim() || null;
}

function getStatusLabel(staged, unstaged) {
  const code = `${staged}${unstaged}`;
  if (code.includes("?")) return "untracked";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("M")) return "modified";
  return "changed";
}
