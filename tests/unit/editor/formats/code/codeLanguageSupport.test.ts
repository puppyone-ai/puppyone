import { getIndentUnit, language } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  loadCodeLanguageExtension,
  resolveCodeLanguageKey,
} from "../../../../../packages/shared-ui/src/editor/viewers/code/codeLanguageSupport";

describe("code language support", () => {
  it.each([
    ["javascript", "component.jsx", "jsx"],
    ["typescript", "component.tsx", "tsx"],
    ["python", "worker.py", "python"],
    ["bash", "deploy.sh", "shell"],
    ["yml", "workflow.yml", "yaml"],
    [null, "schema.sql", "sql"],
    [null, "pyproject.toml", "toml"],
    [null, "notes.txt", "plaintext"],
  ] as const)("resolves %s and %s to %s", (languageName, nodeName, expected) => {
    expect(resolveCodeLanguageKey(languageName, nodeName)).toBe(expected);
  });

  it.each([
    ["javascript", "const answer = 42"],
    ["python", "def greet(name):\n    return f'Hello {name}'"],
    ["json", "{\"ready\": true}"],
    ["yaml", "name: puppyone"],
    ["sql", "select * from documents"],
    ["shell", "echo $SHELL"],
    ["toml", "name = \"puppyone\""],
  ] as const)("loads real %s parsing support", async (languageKey, document) => {
    const extension = await loadCodeLanguageExtension(languageKey);
    const state = EditorState.create({ doc: document, extensions: extension });
    expect(state.facet(language)).not.toBeNull();
  });

  it("uses Python's conventional four-space indentation", async () => {
    const extension = await loadCodeLanguageExtension("python");
    const state = EditorState.create({ doc: "def greet():\n    pass", extensions: extension });
    expect(getIndentUnit(state)).toBe(4);
    expect(state.tabSize).toBe(4);
  });

  it("keeps tab rendering aligned with the language indentation width", async () => {
    const extension = await loadCodeLanguageExtension("typescript");
    const state = EditorState.create({ doc: "function greet() {\n\treturn 'hello'\n}", extensions: extension });
    expect(getIndentUnit(state)).toBe(2);
    expect(state.tabSize).toBe(2);
  });
});
