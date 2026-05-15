# Start here

This repo is a small playground for your first Puppyone loop.

The goal is simple:

1. Give this repo to a coding agent.
2. Let the agent read the files in `Context/`.
3. Let the agent write one file back into `Agent Output/`.
4. Come back to Puppyone and check that the file appears.

When that happens, the loop is complete:

```text
context -> agent -> write-back -> version history
```

## The fastest path

Use the setup prompt from Puppyone and paste it into Claude Code, Codex, or
Cursor.

Then ask the agent:

```text
Complete the task in Agent task.md.
```

The agent should create:

```text
Agent Output/first-run.md
```

After it writes the file, open History in Puppyone. You should see the change
recorded as a commit.

## What to open next

- `Agent task.md` is the instruction for your agent.
- `Context/` contains the data the agent should use.
- `Agent Output/` is where the agent should write its result.
- `Learn more/` explains what to try after the first loop works.
