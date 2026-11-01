<div align="center">
  <img src="assets/brand/puppy/puppy-app-image.png" alt="puppyone Logo" width="88" height="88" />

  <h1>puppyone</h1>

  <p>The (local & cloud) folder built for your agents.</p>

  
  <p>
    <a href="https://www.puppyone.ai"><img src="https://img.shields.io/badge/Website-puppyone.ai-39BC66?style=flat-square" alt="Website" /></a>
    <a href="https://www.puppyone.ai/doc"><img src="https://img.shields.io/badge/Docs-Read-D7F3FF?style=flat-square&logo=readthedocs&logoColor=black" alt="Documentation" /></a>
    <a href="https://discord.gg/zwJ9Y3Uvpd"><img src="https://img.shields.io/badge/Discord-Join-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
    <a href="https://x.com/puppyone_ai"><img src="https://img.shields.io/badge/X-(Twitter)-000000?style=flat-square&logo=x&logoColor=white" alt="X" /></a>
  </p>
</div>

puppyone started with a very simple question:

You have a bunch of files on your computer. How do you let the agent on your phone edit them, or your teammates' agents edit them, or an agent on another computer edit them?
So we built puppyone, a local & cloud folder for agents. Put your files in the cloud folder, and you and every agent in your organization can read and write them.
![A folder open in puppyone](public/assets/media/screenshots/puppyone-editor-overview.png)

## Get started

1. **Get puppyone.**

   <a href="https://www.puppyone.ai/download"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/download-macos-dark.svg"><img src="assets/readme/download-macos-light.svg" alt="Download for macOS" width="196"></picture></a>
   <a href="https://www.puppyone.ai/download"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/download-windows-dark.svg"><img src="assets/readme/download-windows-light.svg" alt="Download for Windows" width="196"></picture></a>

2. **Open a folder and start.** Your files stay on your computer. No account needed.

3. **Put it in the cloud (optional).** By default, puppyone Cloud hosts it, so all your agents can reach the same folder. Copy the folder's link into ChatGPT (Web), Grok Bot, Muse or Manus, or invite your teammates.

   Want to self-host? [Deploy puppyone Cloud by yourself](https://github.com/puppyone-ai/puppyone-cloud#self-host).

## Does it work with my agent?

It depends on which agent you use and where your folder is.

- **In puppyone Cloud:** Any agent can reach it through MCP, the CLI or SSH.
- **Only on your computer:** Cloud agents can't reach it. Local agents can, in their own apps or in puppyone.

| Agent | puppyone Local | puppyone Cloud |
| --- | --- | --- |
| <img src="assets/readme/agents/chatgpt.png" alt="" height="24" align="absmiddle"> ChatGPT Web | / | ✅ In app |
| <img src="assets/readme/agents/claude.png" alt="" height="24" align="absmiddle"> Claude | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/codex.png" alt="" height="24" align="absmiddle"> Codex | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/cursor.png" alt="" height="24" align="absmiddle"> Cursor | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/grok.png" alt="" height="24" align="absmiddle"> Grok Bot | / | ✅ In app |
| <img src="assets/readme/agents/hermes.png" alt="" height="24" align="absmiddle"> Hermes | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/manus.png" alt="" height="24" align="absmiddle"> Manus | / | ✅ In app |
| <img src="assets/readme/agents/muse.png" alt="" height="24" align="absmiddle"> Muse | / | ✅ In app |
| <img src="assets/readme/agents/opencode.png" alt="" height="24" align="absmiddle"> OpenCode | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/pi.png" alt="" height="24" align="absmiddle"> Pi | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/viktor.png" alt="" height="24" align="absmiddle"> Viktor | / | ✅ In app |
| <img src="assets/readme/agents/workbuddy.png" alt="" height="24" align="absmiddle"> WorkBuddy | ✅ In app & in puppyone | ✅ In app |
| <img src="assets/readme/agents/puppyone.png" alt="" height="24" align="absmiddle"> Built-in agent | ✅ In puppyone | ✅ In puppyone |

- **In puppyone:** Use the agent directly in the puppyone app, powered by that agent.
- **In app:** Use the agent in its own app, connected to your puppyone folder.

## What files can puppyone open?

| | Formats |
| --- | --- |
| First-class support | Markdown, CSV, HTML |
| Official support | DOCX, DOC, ODT, RTF, XLSX, XLS, XLSM, ODS, PPTX, PPSX, ODP, PDF, PNG, JPG, SVG, WEBP, GIF, MP3, WAV, MP4, WEBM, TXT, JSON, JSONL, YAML, TOML, CSS, JS, TS, TSX |
| Community support | GLB, ZIP, TAR.GZ |

## What if an agent breaks something?

No problem. puppyone folders run on Git, so you can revert to any earlier version. Folders hosted on puppyone Cloud work the same way.


## License

Code is licensed under the [Apache License 2.0](LICENSE).

## Privacy

puppyone sends basic product analytics, and you can turn them off in **Settings → Privacy**. Read the full [privacy notice](PRIVACY.md).

## Trademarks

The puppyone name, logos, icons, product marks, and related brand assets are
trademarks or service marks of puppyone and are not licensed under the Apache
License 2.0.

You may use the puppyone name only to refer to the original project or to
accurately describe compatibility with it. You may not use puppyone branding to
imply endorsement, affiliation, or official distribution of a modified build
without prior written permission.

Forks and redistributed builds should use their own product name, app icon, and
branding unless they have explicit permission to use puppyone marks.
