# Project Templates

Built-in starter projects shown in the "Create Project" picker and used by
the post-signup demo seed.

## Quick: add a new template

1. Create a folder under `builtin/`:

   ```text
   builtin/
   └── my-template/
       ├── manifest.toml
       └── content/
           ├── README.md
           └── (any other folders / files)
   ```

2. Write `manifest.toml`:

   ```toml
   id = "my-template"
   name = "My Template"
   description = "One-line blurb shown in the picker."
   icon = "✨"

   # Optional
   version = "1.0.0"
   author = "Your Team"
   tags = ["onboarding"]
   order = 50  # lower → appears first
   ```

3. Drop content files under `content/`. The folder layout mirrors what gets
   created in the new project. Subfolders are supported.

4. Restart the backend. Your template appears in the picker automatically.

## Manifest schema

| Field         | Required | Type     | Notes                                           |
| ------------- | :------: | -------- | ----------------------------------------------- |
| `id`          |   yes    | string   | Stable id, also the folder name                 |
| `name`        |   yes    | string   | Display name in the picker                      |
| `description` |   yes    | string   | One-line blurb (keep under ~80 chars)           |
| `icon`        |   yes    | string   | Single emoji shown on the template card         |
| `version`     |    no    | string   | Defaults to `"1.0.0"`. Bump on content change.  |
| `author`      |    no    | string   | `"PuppyOne"`, a team name, or a GitHub handle   |
| `tags`        |    no    | string[] | Reserved for future filtering in the picker     |
| `order`       |    no    | int      | Sort key. Defaults to 100. Lower = first.       |

`id` must match the folder name and must be unique across all templates.

## File-type conventions

The frontend infers the editor by extension:

| Extension          | Renderer                           |
| ------------------ | ---------------------------------- |
| `.md`              | Markdown editor (Milkdown)         |
| `.json`            | JSON editor (tree / vanilla / table) |
| anything else      | Generic file viewer                 |

So name your files accordingly.

## Authoring conventions

- **Use absolute URLs** for external links (e.g. `https://puppyone.ai/doc/...`).
  Relative links like `/foo` will not resolve inside a project.
- **No MDX components.** Pure Markdown only.
- **Keep files small and focused.** One topic per file. Group with folders.
- **Use a `## 📚 Read more` section at the bottom** for outbound links to the
  docs site, separated from the in-product content with a `---` rule.
- **Prefer ASCII over Unicode for diagrams.** Box-drawing characters don't
  always render consistently across editors.

## Built-in templates today

| Folder                  | Purpose                                               |
| ----------------------- | ----------------------------------------------------- |
| `builtin/get-started/`  | Demo project seeded for every new user on first login |
| `builtin/invoice-processing/` | Pre-structured workspace for an accounting agent |
| `builtin/seo-management/`     | Brand guidelines + keywords for an SEO agent     |

## Why files instead of Python strings

Earlier these templates lived as triple-quoted Python literals in a single
file. We moved to filesystem layout because:

- Editors get real Markdown preview, syntax highlighting, and spell check.
- Diffs are clean — no Python escaping noise.
- Adding a template = create a folder. No `.py` change required.
- Translators can localize without touching Python.
- We can add `i18n/<locale>/content/` siblings later without rewriting the
  loader.

## Future: marketplace

Today the loader only sees `builtin/`. When we add a community marketplace
(DB-backed, with submissions, ratings, etc.), the loader will gain extra
sources but **the manifest schema and on-disk layout stay the same**, so
templates authored today are forward-compatible.
