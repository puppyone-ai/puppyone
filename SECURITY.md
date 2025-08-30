# Security Policy

Reporting a vulnerability
- Please email security@puppyagent.com with details and steps to reproduce.

Secrets and environment variables
- Do not commit `.env` files or real secrets. `.env` files are globally ignored.
- Use `.env.example` templates to document variables.
- If a secret is leaked:
  1) Rotate the key immediately with the provider
  2) Purge history (see issue instructions: git-filter-repo or BFG)
  3) Verify GitHub secret scanning and push protection

Dependency security
- Keep dependencies up to date; we use lockfiles and pinned versions where possible
- Enable GitHub Dependabot alerts and code scanning
