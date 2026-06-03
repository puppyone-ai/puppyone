# PuppyOne Docs

PuppyOne is a Git-native cloud filesystem for AI agents and teams.

Read in this order:

0. [Getting Started (developers & contributors)](getting-started.md)
1. [Architecture Vision](architecture/00-vision.md)
2. [Version Engine](architecture/01-version-engine.md)
3. [Access Points](architecture/02-access-points.md)
4. [CLI](architecture/03-cli.md)
5. [Connectors](architecture/04-connectors.md)
6. [Git Remote Access Point Flow](architecture/05-git-remote-accesspoint.md)
7. [Gateway And Access Boundary](architecture/06-gateway-access-point-split.md)
8. [Shadow Snapshots](architecture/08-shadow-snapshots.md)
9. [Context Entry Points](architecture/10-context-entrypoints.md)
10. [Context Entry Point Data Model](architecture/11-context-entrypoint-data-model.md)

For product onboarding (install CLI, first project), see the [root README](../README.md).

The current source of truth for versioning is `backend/src/version_engine/`.
Old protocol-era architecture notes were removed from the active docs so they
cannot be mistaken for implementation guidance.
