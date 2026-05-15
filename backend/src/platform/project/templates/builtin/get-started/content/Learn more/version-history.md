# Version history

Puppyone records writes as history.

That matters because agent work is useful only when it is inspectable. If an
agent changes a file, you should be able to see what changed and recover if the
change was wrong.

## What to check after the first task

After your agent creates `Agent Output/first-run.md`:

1. Open History in Puppyone.
2. Find the commit for the new file.
3. Open the file and confirm the output matches the task.

This is the safety loop:

```text
agent writes -> Puppyone records -> user can inspect
```
