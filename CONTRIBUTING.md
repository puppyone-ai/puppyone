# Contributing

Thanks for considering contributing to puppyone desktop.

## Setup

```bash
git clone https://github.com/puppyone-ai/puppyone.git
cd puppyone-desktop
npm install
npm run dev
```

## Checks

Run these before opening a pull request:

```bash
npm run build
```

For macOS package smoke testing:

```bash
npm run dist:mac
```

Unsigned macOS packages are for internal testing only.

## Pull Requests

- Branch from `main`.
- Keep changes focused.
- Include a concise description and test plan.
- Do not commit generated release artifacts from `dist/` or `release/`.
- Do not commit real secrets, certificates, provisioning profiles, or `.env`
  files.

## Code Style

- Follow the existing TypeScript, React, CSS, and Electron patterns.
- Keep local filesystem and Git operations behind the Electron/local API
  boundary.
- Prefer small, reviewable changes.

## License

By submitting a contribution, you agree that your contribution is licensed to
the project and its users under the Apache License 2.0, including the patent
grant described in Section 3 of the license.

No separate Contributor License Agreement is required at this time. Section 5
of the Apache 2.0 license governs inbound contributions.
