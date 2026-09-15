# Agent activity fixtures

Fixtures in this directory model provider payload shapes but must never be copied
from a developer machine without sanitization.

- Use `/workspace` as `cwd` and generic relative filenames such as `notes.md`.
- Use synthetic model, session, turn, conversation, generation and tool IDs.
- Set transcript paths to `null` and remove prompts, file contents and secrets.
- Never retain usernames, home directories, repository names or personal filenames.
- Keep the provider version in the directory name so schema drift is explicit.

`scripts/check-agent-activity-architecture.mjs` enforces the machine-checkable
parts of this policy during boundary checks and production builds.
