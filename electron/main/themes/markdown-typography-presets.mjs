import { readFileSync } from "node:fs";
import postcss from "postcss";
import { DEFAULT_MARKDOWN_THEME_CSS } from "./markdown-theme-defaults.generated.mjs";

const contract = JSON.parse(readFileSync(
  new URL("../../../shared/markdown-theme-contract.json", import.meta.url), "utf8",
));
export const MARKDOWN_SIZE_PRESETS = Object.freeze(contract.sizePresets.choices);
export const MARKDOWN_DEFAULT_SIZE_PRESET = contract.sizePresets.default;
export const MARKDOWN_SIZE_ROLES = Object.freeze(
  contract.tokens.filter(({ sizePresets }) => sizePresets).map(({ name }) => name),
);

/** Complete a registered theme before scope/host projection. Numeric defaults
 * come only from the official Neutral file, including new-theme templates.
 * Legacy single sizes remain the Medium value; explicit presets take priority.
 * Partial dark/media rules inherit the completed base without resetting it. */
export function resolveMarkdownTypographyPresets(root, defaultsCss = DEFAULT_MARKDOWN_THEME_CSS) {
  const defaults = readDefaults(defaultsCss);
  let base = root.nodes.find(node => node.type === "rule" && isBaseRule(node));
  if (!base) {
    base = postcss.rule({ selector: ":root" });
    root.prepend(base);
  }

  root.walkRules(rule => {
    const declarations = new Map();
    rule.walkDecls(declaration => {
      declarations.set(declaration.prop.toLowerCase(), declaration);
    });

    for (const role of MARKDOWN_SIZE_ROLES) {
      const medium = `${role}-${MARKDOWN_DEFAULT_SIZE_PRESET}`;
      const legacy = declarations.get(role);
      const explicitMedium = declarations.get(medium);
      // Empty optional fields have the same semantics as omitted fields.
      if (explicitMedium && !explicitMedium.value.trim()) {
        explicitMedium.remove();
        declarations.delete(medium);
      }
      if (legacy?.value.trim() && !declarations.has(medium)
        && legacy.value.trim() !== `var(${medium})`) {
        const migrated = legacy.clone({ prop: medium });
        rule.append(migrated);
        declarations.set(medium, migrated);
      }

      for (const preset of MARKDOWN_SIZE_PRESETS) {
        const name = `${role}-${preset}`;
        const authored = declarations.get(name);
        if (authored && !authored.value.trim()) {
          authored.remove();
          declarations.delete(name);
        }
        if (rule === base && !declarations.has(name)) {
          rule.append({ prop: name, value: defaults.get(name) });
        }
      }

      // The adapter selects the active preset. Base roles remain aliases so
      // existing references between table/code/math sizes keep working.
      if (legacy) legacy.value = `var(${medium})`;
      else if (rule === base) rule.append({ prop: role, value: `var(${medium})` });
    }
  });
}

function readDefaults(css) {
  const root = postcss.parse(css);
  const values = new Map();
  root.walkRules(rule => {
    if (rule.parent !== root || !isBaseRule(rule)) return;
    rule.walkDecls(declaration => values.set(declaration.prop, declaration.value));
  });
  for (const role of MARKDOWN_SIZE_ROLES) {
    for (const preset of MARKDOWN_SIZE_PRESETS) {
      const name = `${role}-${preset}`;
      if (!values.get(name)?.trim()) {
        throw new TypeError(`Official Markdown typography defaults are missing ${name}.`);
      }
    }
  }
  return values;
}

function isBaseRule(rule) {
  return rule.selectors.some(selector => [":root", ".theme-root", "html", "body", "#write"].includes(selector.trim()));
}
