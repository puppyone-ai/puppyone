# Markdown add-ons

An add-on is an optional editor behavior a user can switch off. It is one
CodeMirror `Extension`, installed by `MarkdownCodeMirrorEditor` in its own
Compartment, and it owns all of its state, DOM, listeners, and styling. While it
is off, none of that exists.

This is different from a Feature. A Feature gives the Markdown dialect a
capability and is always composed; an add-on has no syntax, no plans, and no
widgets, and depends on a preference.

Dependencies point one way, and `check-markdown-architecture` enforces them:

- Only `MarkdownCodeMirrorEditor` imports an add-on, through its `index.ts`.
- An add-on reaches core through the small set of ports listed in that check.
  It never imports composition, a Feature, or rendering internals.
- Core never knows an add-on exists. Anything that must keep working after the
  add-on is removed, such as undoing a move it made, belongs in core.
