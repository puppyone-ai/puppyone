import postcss from "postcss";

/** Inspect each import edge as well as nested rules; a layered entry alone is insufficient. */
export function inspectStyleLayers(source, inheritedLayer = false) {
  const root = postcss.parse(source);
  const unlayeredRules = [];
  const imports = [];
  const inLayer = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.type === "atrule" && parent.name === "layer") return true;
    }
    return inheritedLayer;
  };
  root.walkRules(rule => {
    if (!inLayer(rule)) unlayeredRules.push(rule.selector);
  });
  root.walkAtRules("import", rule => {
    const match = rule.params.match(/^["']([^"']+)["']\s*(.*)$/);
    if (!match) throw new Error(`Unsupported CSS import contract: ${rule.params}`);
    imports.push({ path: match[1], layered: inLayer(rule) || /^layer(?:\(|\s|$)/.test(match[2]) });
  });
  return { unlayeredRules, imports };
}
