# Third-party notices

## DuckDB Node Neo

Read-only database previews use `@duckdb/node-api` 1.5.5-r.5 and its matching
native bindings, redistributed under the MIT License. Copyright 2018–2025
Stichting DuckDB Foundation. Complete license notices ship in the packaged
`node_modules/@duckdb/` dependencies, including `node-api/LICENSE`.
Upstream source: https://github.com/duckdb/duckdb-node-neo

SQLite previews use Electron's bundled Node.js `node:sqlite` binding and SQLite
engine; their notices are included with the Electron distribution.

## jsdiff

Agent edit previews use the `diff` package (jsdiff), redistributed under the
BSD 3-Clause License. The complete license and copyright notices are included
in `node_modules/diff/LICENSE` with the packaged dependency.
Upstream source: https://github.com/kpdecker/jsdiff

## Open Sans

The built-in GitHub Theme Pack includes Open Sans font files. Copyright 2020
The Open Sans Project Authors. The fonts are redistributed under the SIL Open
Font License, Version 1.1; the complete license text is distributed at
`public/fonts/open-sans/OFL.txt`.

## PT Serif

The built-in Newspaper Theme Pack includes PT Serif font files. Copyright
ParaType Ltd. The fonts are redistributed under the SIL Open Font License,
Version 1.1, with the reserved font names stated in the license; the complete
license text is distributed at `public/fonts/pt-serif/OFL.txt`.

## B00merang Windows-XP icon theme

The Windows XP interface Style includes seven 128px toolbar assets and ten
hand-tuned 16px Explorer folder/file assets from the
`B00merang-Artwork/Windows-XP` icon theme at immutable commit
`24e95ad2b12c55dd11883ee7066525527d944039`: `gtk-directory.png`,
`dotNETconnectedtechnology.png`, `gnome-system.png`, `emblem-system.png`,
`gnome-remote-desktop.png`, `utilities-terminal.png`, and `gnobots2.png`.
The Explorer assets are the 16px `places/gtk-directory.png`,
`status/stock_open.png`, and the `mimetypes` assets `gtk-file.png`, `html.png`,
`gnome-mime-image.png`, `gnome-mime-audio.png`, `video-x-generic.png`,
`application-pdf.png`, `zip.png`, and `application-x-executable.png`; their
original PNG payloads are embedded without pixel modification in
text-reviewable SVG containers. The assets are
redistributed under the GNU General Public License, version 2. The complete
license text is distributed at
`src/styles/interfaces/windows-xp/assets/B00MERANG-WINDOWS-XP-GPL-2.0.txt`.
Upstream source: https://github.com/B00merang-Artwork/Windows-XP

## B00merang Windows-XP Luna caption buttons

The Windows XP interface Style includes the normal, hover, and pressed 21x21
minimize, maximize, and close caption-button assets from
`B00merang-Project/Windows-XP` at immutable commit
`7637830906823af40a3cd7e7079be753d8b7d679`. The source files are the
`Windows XP Luna/metacity-1/minimize*.png`, `maximize*.png`, and `close*.png`
state images. Their original PNG payloads are embedded without pixel
modification in text-reviewable SVG containers and are restricted to the
Windows XP Style Pack.

The assets are redistributed under the GNU General Public License, version 3.
The complete license text is distributed at
`src/styles/interfaces/windows-xp/assets/B00MERANG-WINDOWS-XP-THEME-GPL-3.0.txt`.
Upstream source: https://github.com/B00merang-Project/Windows-XP

## Git official logomark

The Windows XP interface Style includes the official orange Git logomark by
Jason Long. The SVG is redistributed without modification; PuppyOne applies
only a CSS drop shadow when it is painted in the toolbar. The mark is licensed
under the Creative Commons Attribution 3.0 Unported License.
Official source: https://git-scm.com/community/logos.html
License: https://creativecommons.org/licenses/by/3.0/

## GNOME gitg classic icon

The Windows XP interface Style uses the 256px `gitg` application icon from
the official GNOME gitg v0.3.3 tag. The unmodified PNG is redistributed under
the GNU General Public License, version 2. The complete license text is at
`src/styles/interfaces/windows-xp/assets/GITG-GPL-2.0.txt`.
Upstream source: https://github.com/GNOME/gitg/blob/v0.3.3/data/icons/hicolor_apps_256x256_gitg.png

## Crystal Clear configure icon

The Windows XP interface Style uses the 128px `Action configure` icon from
Everaldo Coelho's Crystal Clear icon set for Settings. The asset is
redistributed without modification under the GNU Lesser General Public
License, version 2.1 or later. The complete LGPL 2.1 text is distributed at
`src/styles/interfaces/windows-xp/assets/CRYSTAL-CLEAR-LGPL-2.1.txt`.
Icon source: https://www.iconarchive.com/show/crystal-clear-icons-by-everaldo/Action-configure-icon.html
Icon-set archive and license record: https://commons.wikimedia.org/wiki/Crystal_Clear

## Third-party product marks

Agent, Terminal, and Cloud integration surfaces include local marks solely to
identify user-selected third-party products. These include Codex, ChatGPT,
Claude Code, Cursor, OpenCode, Hermes, Manus, Pi, Gmail, Google Calendar,
Google Docs, Google Sheets, Airtable, Notion, Linear, Supabase, Slack, and Git.
All product names and marks belong to their respective owners. Their appearance
does not imply sponsorship or endorsement.

The Codex mark is a size-optimized copy of the official Codex application icon;
the Claude mark follows Anthropic's published product identity, the Cursor mark
follows Cursor's official application/brand asset, and the OpenCode mark comes
from `packages/identity/mark.svg` in the official OpenCode repository. PuppyOne
ships bounded local copies so opening a menu never performs a remote image
request.

## OpenCode

PuppyOne Desktop can connect to a user's own OpenCode installation through its
Agent Client Protocol endpoint. PuppyOne does not redistribute an OpenCode
binary and does not use OpenCode as the managed kernel behind PuppyOne Agent.
OpenCode remains owned, configured, authenticated, and updated by the user.

## Pi SDK

PuppyOne Agent embeds the exact production dependency
`@earendil-works/pi-coding-agent@0.85.1` from source commit
`d981de1229ef899957bbe968bc8dcda02a21f477`. PuppyOne uses the official SDK
session runtime and RPC mode as its execution kernel while retaining a separate
PuppyOne product identity, managed profile, permission policy, and session
store. It does not execute the user's Pi binary or load the user's Pi profile.

Pi is Copyright (c) 2025 Mario Zechner and licensed under the MIT License. The
complete license and immutable source-adoption record are distributed at
`vendor/pi-kernel/LICENSE` and `vendor/pi-kernel/SOURCE_ADOPTION.json`.

## Claude Agent SDK

PuppyOne Desktop uses the exact-version
`@anthropic-ai/claude-agent-sdk@0.3.159` as the control layer for the native
Claude Code backend. PuppyOne does not redistribute the SDK's optional
platform executable; the backend uses the user's canonical Claude Code
installation. The SDK is © Anthropic PBC, all rights reserved, and its use is
subject to Anthropic's applicable legal agreements. The package license notice is retained at
`vendor/claude-agent-sdk/LICENSE.md`; current terms are linked from
https://code.claude.com/docs/en/legal-and-compliance.

Anthropic's published authentication policy does not permit third-party
products to route traffic through users' Free, Pro or Max Claude subscription
credentials. PuppyOne therefore requires an Anthropic API key or a supported
cloud-provider credential for this backend and does not copy Claude credential
files. Claude Agent SDK usage may be subject to Anthropic's documented data
collection, usage and retention policies.

## Claudian frontend reference

PuppyOne Desktop selectively adapts interaction, presentation and native
protocol orchestration patterns from `YishenTu/claudian` at immutable commit
`7d7cc84c60a77431aaccda7ff49a2f1f4ae1c2ab`. The adopted runtime patterns are
the persistent Claude SDK message channel, Electron-safe CLI spawning, and ACP
method compatibility/event normalization. PuppyOne rewrites these patterns
under its own typed `AgentRuntimePort`, canonical workspace boundary, approval
policy, React design tokens, accessibility behavior and virtualization.
Claudian credential stores, prompts, conversation persistence and Obsidian
integration are not included.

Claudian is licensed under the MIT License. The complete license, source map and
CycloneDX record are distributed in `vendor/claudian/LICENSE`,
`vendor/claudian/SOURCE_ADOPTION.md` and `vendor/claudian/SBOM.cdx.json`.

## saxes

PuppyOne Desktop uses saxes 6.0.0 to parse namespace-aware WordprocessingML.
saxes is licensed under the ISC License:

> Copyright (c) Contributors
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
> WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
> SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
> OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
> CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

saxes was forked from sax, whose included code is also licensed under the ISC
License with this notice:

> Copyright (c) Isaac Z. Schlueter and Contributors
>
> Permission to use, copy, modify, and/or distribute this software for any
> purpose with or without fee is hereby granted, provided that the above
> copyright notice and this permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
> WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
> MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
> SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
> WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
> OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
> CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## parse5 and entities

The static HTML editor uses parse5 8.0.0 for source positions and HTML parsing,
and its entities dependency for character references. Their license notices
are reproduced below because they are bundled into the renderer.

### parse5 (MIT)

Copyright (c) 2013-2019 Ivan Nikulin (ifaaan@gmail.com, https://github.com/inikulin)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

### entities (BSD 2-Clause)

Copyright (c) Felix Böhm
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS,
EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
