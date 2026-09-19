import { generate, lexer, parse, walk } from "css-tree";

export const TEXT_SELECTION_TOKEN_PAIRS = Object.freeze({
  application: [
    ["--po-text-selection-bg", "--po-text-selection-inactive-bg"],
    ["--po-terminal-selection", "--po-terminal-selection-inactive"],
  ],
  markdown: [["--po-md-selection-bg", "--po-md-selection-inactive-bg"]],
  csv: [["--po-csv-selection-bg", "--po-csv-selection-inactive-bg"]],
});

/** Validate only the selection dependency closure; other theme roles retain
 * their existing contract. Parse CSS grammar rather than guessing via regex. */
export function validateSelectionColors(root, { target, publicColors, inheritedColors }) {
  const pairs = TEXT_SELECTION_TOKEN_PAIRS[target];
  if (!pairs) return;
  const common = new Map();
  const dark = new Map();
  const declarations = [];
  root.walkRules((rule) => {
    const mode = /(?:^|[^a-z0-9_-])\.dark(?:[^a-z0-9_-]|$)/i.test(rule.selector) ? dark : common;
    for (const node of rule.nodes) {
      if (node.type !== "decl") continue;
      mode.set(node.prop, node.value);
      declarations.push({ mode, property: node.prop, value: node.value, unconditional: rule.parent.type === "root" });
    }
  });
  // Dependency edges for omitted product defaults. Actual paint formulas live
  // in the shared CSS contract, not in this compiler.
  const defaults = new Map([
    ["--po-text-selection-bg", "var(--po-accent)"],
    ["--po-text-selection-inactive-bg", "var(--po-text-selection-bg)"],
    ["--po-terminal-selection", "var(--po-text-selection-bg)"],
    ["--po-terminal-selection-inactive", "var(--po-terminal-selection)"],
    ...pairs.flatMap(([active, inactive]) => target === "application" ? [] : [
      [active, "var(--po-text-selection-bg)"], [inactive, `var(${active})`],
    ]),
  ]);
  const selectionTokens = new Set(pairs.flat());
  const optionalPairs = Object.values(TEXT_SELECTION_TOKEN_PAIRS).flat()
    .filter(([active]) => active !== "--po-text-selection-bg");
  const optionalTokens = new Set(optionalPairs.flat());
  for (const mode of [common, dark]) {
    const values = new Map([...defaults, ...common, ...(mode === dark ? dark : [])]);
    // Conditional dependencies must be safe too. Conservatively validate every
    // authored alternative, even if another rule usually wins the cascade.
    const alternatives = new Map();
    const definite = new Set();
    for (const entry of declarations) {
      if (entry.mode !== common && mode !== dark) continue;
      const entries = alternatives.get(entry.property) ?? new Set();
      entries.add(entry.value);
      alternatives.set(entry.property, entries);
      if (entry.unconditional) definite.add(entry.property);
    }
    for (const [active, inactive] of optionalPairs) {
      if (!alternatives.has(inactive)) {
        values.set(inactive, `var(${alternatives.has(active) ? active : "--po-text-selection-inactive-bg"})`);
      }
    }
    let visits = 0;
    const validate = (value, ancestry = []) => {
      if (++visits > 4096 || ancestry.length > 32 || value.length > 16_384) {
        throw new TypeError("Selection color dependency limit exceeded.");
      }
      const ast = parse(value, { context: "value", parseCustomProperty: true });
      walk(ast, {
        visit: "Function",
        enter(node, item, list) {
          if (node.name.toLowerCase() !== "var") return;
          const children = node.children.toArray();
          const name = children[0]?.type === "Identifier" ? children[0].name : "";
          if (!publicColors.has(name)) throw new TypeError(`Selection color references unknown color token: ${name}.`);
          const definitelyAvailable = definite.has(name)
            || optionalPairs.some(([active, inactive]) => name === inactive && definite.has(active))
            || (inheritedColors.has(name) && !optionalTokens.has(name));
          if (!definitelyAvailable && children.length === 1) {
            throw new TypeError(`Selection color requires a value or fallback for ${name}.`);
          }
          if (ancestry.includes(name)) throw new TypeError(`Selection color dependency cycle: ${[...ancestry, name].join(" -> ")}.`);
          if (children.length > 1) {
            if (children.length !== 3 || children[1].type !== "Operator" || children[1].value !== "," || children[2].type !== "Value") {
              throw new TypeError("Selection color contains an invalid var() fallback.");
            }
            validate(generate(children[2]), [...ancestry, name]);
          }
          const optionalMissing = optionalTokens.has(name) && !alternatives.has(name)
            && !optionalPairs.some(([active, inactive]) => name === inactive && alternatives.has(active));
          if (optionalMissing) {
            // Adapter fallbacks are not CSS declarations. An absent optional
            // override cannot be referenced as if it were a defined alias.
            if (children.length === 1) throw new TypeError(`Selection color requires a value or fallback for ${name}.`);
          } else if (alternatives.has(name)) {
            for (const alternative of alternatives.get(name)) validate(alternative, [...ancestry, name]);
          } else if (values.has(name)) validate(values.get(name), [...ancestry, name]);
          else if (!inheritedColors.has(name) && children.length === 1) {
            throw new TypeError(`Selection color requires a value or fallback for ${name}.`);
          }
          // A verified color dependency can stand for one color production.
          // Keep the original var() in output so it resolves in its own host.
          list.replace(item, { data: { type: "Hash", value: "000" } });
          return this.skip;
        },
      });
      walk(ast, (node) => {
        if (node.type === "Identifier" && lexer.matchType("system-color", node.name).matched) {
          throw new TypeError("Selection colors cannot depend on operating-system colors.");
        }
        if (node.type === "Function" && !supportedColorFunctions.has(node.name.toLowerCase())) {
          throw new TypeError(`Unsupported selection color function: ${node.name}.`);
        }
      });
      if (!lexer.matchType("color", ast).matched) throw new TypeError(`Selection color must be a CSS color: ${value}.`);
    };
    for (const token of selectionTokens) {
      if (optionalTokens.has(token) && !alternatives.has(token)) continue;
      validate(values.get(token), [token]);
    }
    // Check earlier and conditional selection declarations too; last-value
    // validation alone could miss a branch activated by @media / @supports.
    for (const entry of declarations) {
      if ((entry.mode === common || mode === dark) && selectionTokens.has(entry.property)) {
        validate(entry.value, [entry.property]);
      }
    }
  }
}

// The host ships Chromium. Do not accept experimental grammar that it cannot
// paint and then silently expose a browser default selection.
const supportedColorFunctions = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch",
  "color", "color-mix", "light-dark", "calc", "min", "max", "clamp",
]);

export function completeSelectionPairs(root, target) {
  const pairs = TEXT_SELECTION_TOKEN_PAIRS[target] ?? [];
  root.walkRules((rule) => {
    for (const [active, inactive] of pairs) {
      const declarations = rule.nodes.filter((node) => node.type === "decl");
      if (declarations.some((node) => node.prop === active) && !declarations.some((node) => node.prop === inactive)) {
        rule.append({
          prop: inactive,
          value: `color-mix(in srgb, var(${active}) var(--po-text-selection-inactive-ratio), transparent)`,
        });
      }
    }
  });
}
