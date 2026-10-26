<div align="center">
  <img src="public/assets/brand/puppy/puppy-dark.svg" alt="puppyone Logo" width="72" height="72" />

  <h1>puppyone</h1>

  <p>The (local/cloud) folder built for your agents.</p>

  
  <p>
    <a href="https://www.puppyone.ai/download"><b>Download for macOS</b></a> ·
    <a href="https://www.puppyone.ai/download"><b>Download for Windows</b></a>
  </p>

  <p>
    <a href="https://www.puppyone.ai"><img src="https://img.shields.io/badge/Website-puppyone.ai-39BC66?style=flat-square" alt="Website" /></a>
    <a href="https://www.puppyone.ai/doc"><img src="https://img.shields.io/badge/Docs-Read-D7F3FF?style=flat-square&logo=readthedocs&logoColor=black" alt="Documentation" /></a>
    <a href="https://discord.gg/zwJ9Y3Uvpd"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
    <a href="https://x.com/puppyone_ai"><img src="https://img.shields.io/badge/X-(Twitter)-000000?style=flat-square&logo=x&logoColor=white" alt="X" /></a>
  </p>
</div>


![A folder open in puppyone](public/assets/media/screenshots/puppyone-editor-overview.png)

puppyone opens any folder on your computer. Your documents, spreadsheets, slides,
PDFs and web pages stay as ordinary files you can just open — nothing to upload,
nothing to migrate. Let AI agents work in that folder: every change is tracked in
Git, down to a redline view for Word documents, and anything can be rolled back.
When you need it online, put the folder in puppyone Cloud and it stays on after
you close your laptop.

**Agents come and go. Your folder stays.**

## It's a folder. Everything's already in it.

Open a folder you already have — no import, no migration. Documents, spreadsheets,
slides, PDFs, images, audio and video, 3D models and web pages all render in place,
instead of showing up as a list of filenames.

| | Formats |
| --- | --- |
| Documents | DOCX, DOC, ODT, RTF |
| Spreadsheets | XLSX, XLS, XLSM, ODS, CSV |
| Slides | PPTX, PPSX, ODP |
| PDF | PDF |
| Images | PNG, JPG, SVG, WEBP, GIF |
| Audio and video | MP3, WAV, MP4, WEBM |
| Text and data | Markdown, TXT, JSON, JSONL, YAML, TOML |
| Code and web | HTML, CSS, JS, TS, TSX |
| 3D | GLB |
| Archives | ZIP, TAR.GZ |

Files stay on your disk. Nothing leaves the folder unless you put it in puppyone Cloud.

## Let AI work in it. See every change. Undo any of it.

Git is built in — nothing to configure. After an agent works, you get a change
list, a history timeline and per-commit detail in the sidebar:

- **Text** — line-by-line diffs.
- **Word documents** — a redline view, so you can read what an agent rewrote the
  way you would read tracked changes.
- **Binary files** — a change summary.

If something looks wrong, roll back a single file or the whole folder to any
earlier version.

![Agent working in a folder](public/assets/media/screenshots/editor-agent-light.png)

## Works with 10+ agents

Swap the agent; keep the folder.

| How it connects | Agents | Notes |
| --- | --- | --- |
| Built in | puppyone Agent | Sign in with email. Every account gets trial credit, then pay as you go — or bring your own API key or local model and use no credit at all. |
| Bundled with the app | WorkBuddy | macOS, Windows |
| Your installed CLI | Claude Code, Codex, OpenCode, Pi | macOS, Linux, Windows |
| Your installed CLI | Cursor | macOS, Linux |
| Companion runtime | Hermes | macOS, Linux |
| Via puppyone Cloud | ChatGPT, Claude, Manus, Viktor, Grok | Or any MCP client |

## Need it online? puppyone Cloud.

Put the folder in puppyone Cloud and it stays on after you close your laptop.
An agent on any device — your laptop, a server, CI, ChatGPT or Claude — opens the
same files and picks up where the last one left off. Each agent gets its own key,
scoped to only the paths it needs.

> Cloud connection in the app is Early Access.

## Install

Download the installer for [macOS or Windows](https://www.puppyone.ai/download).

Or install from npm:

```bash
npm install --global puppyone
```

## Start

```bash
puppyone
```

## Development checks

See the [test directory and commands](tests/README.md) for unit, component,
integration, Electron and performance checks.

For the local Agent payment test, run `npm run dev:agent-sandbox -- --check`,
then `npm run dev:agent-sandbox` after closing the previous development instance.
This starts the source build against qubits Cloud and Polar Sandbox; it does not
reconfigure an installed Desktop. Model calls still use real provider credit.
The canonical [sandbox runbook](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppypay/operations/desktop-agent-sandbox.md)
and [architecture](https://github.com/puppyone-ai/puppy-issues/blob/main/document/puppyone/architecture/control-plane/desktop-agent-inference.md)
are maintained in `puppy-issues` alongside this task branch.

## License

Code is licensed under the [Apache License 2.0](LICENSE).

## Privacy

Eligible Stable builds send Basic product analytics after showing the current
notice. You can turn analytics off in **Settings → Privacy**. Development and
Internal builds do not send these events.

Basic analytics measure installations and application usage, not people. They
contain two events: `desktop_first_run`, at most once for a fresh installation,
and `desktop_daily_active`, at most once per UTC day while the app is
foregrounded. Existing installations are not counted as new installations
when they upgrade.

Events include the UTC activity day, application version, operating system
family and major version, processor architecture, notice version, a random
retry identifier, and a monthly rotating pseudonymous installation ID. A
separate pseudonymous retention ID links activity during the installation's
first 100 lifecycle days; the first-run event also includes the onboarding
version. These IDs come from a random local secret, not an account or hardware
identifier. The [event catalog](shared/desktop-telemetry-contract.mjs) lists the
exact permitted fields.

Events never include account identifiers, credentials, files or file paths,
Git metadata, prompts, Agent replies, terminal content, hardware serial
numbers, raw IP addresses, or full User-Agent strings. Cloudflare processes
connection metadata to deliver requests; the analytics Worker does not read
it into analytics records or store it in the database, and invocation logs
are disabled.

| Analytics records | Retention |
| --- | --- |
| Retry receipts | 8 days |
| Daily pseudonymous activity | 35 days |
| Monthly pseudonymous activity | 62 days |
| First-run and retention activity details | 100 days |
| Aggregate counts without identifiers | Long term |

Turning analytics off clears the local queue and identity secret. Already
submitted records expire on the schedule above; the service has no mapping
from these IDs to a Puppyone account. Opting back in does not count the
installation as a new first run.

Privacy questions: [guanqun.real@puppyone.ai](mailto:guanqun.real@puppyone.ai).

The puppyone name, logo, icons, and other brand assets are not granted under
the Apache License. See [TRADEMARK.md](TRADEMARK.md).
