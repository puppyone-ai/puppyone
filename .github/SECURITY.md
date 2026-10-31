# Security Policy

## Reporting a vulnerability

Please email security@puppyone.ai with details and steps to reproduce. Do not
open a public issue for a vulnerability that could put users or credentials at
risk.

## Secrets and environment variables

- Do not commit `.env` files or real secrets. `.env` files are globally ignored.
- Use `.env.example` templates to document variables.
- If a secret is leaked, rotate it immediately, purge it from Git history, and
  verify GitHub secret scanning and push protection.

## Dependency security

- Keep dependencies up to date; we use lockfiles and pinned versions where
  possible.
- Enable GitHub Dependabot alerts and code scanning.

## Trademarks and branding

- This project does not grant rights to use PuppyOne trademarks, service marks,
  or logos.
- Remove third-party brand assets unless explicitly licensed; prefer neutral
  icons.
