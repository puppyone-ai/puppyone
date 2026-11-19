# Changes made elsewhere

This domain owns how changes produced on another workbench — a second Mac, a
Cloud workspace, an Agent — are presented to the person sitting in front of this
one.

Product authority for the concepts and the wording is
[Product Philosophy](https://github.com/puppyone-ai/puppy-issues/blob/main/document/product-philosophy.md):
incoming changes always come back as changes waiting for review, and nothing
rewrites local files on their own.

## A receipt is a projection, not a second copy

`getIncomingChangeReceipt()` derives everything it shows — who, how many files,
which files, when — from the Git facts in the status snapshot. Keeping it a
projection is what makes the pending state survive a restart for free: the
fetched commits stay in the repository until the user applies them.

The only state worth persisting is therefore the user's decision, and
`incomingReviewLedger.ts` keeps exactly that, keyed by the commit the receipt is
about. A later change produces a new receipt instead of reusing an answer that
was given about different work.

## Setting aside is not discarding

Setting a receipt aside hides it and writes one ledger entry. It never touches
the repository, so the changes remain exactly where they were and the receipt
can be restored — after a window close or an application restart included.
Applying is the only action that writes to the working tree, and only when the
user asks for it.

## Review happens in the surface that already exists

Selecting a file hands a remote-origin selection to the Source Control sidebar,
which opens its established diff. This domain adds no second diff viewer and no
second sync surface.

## Boundaries

- This domain reads Git facts and renders them. It performs no Git operations
  itself; applying is the `pull` action its host passes in.
- It must not import from another feature domain. The host (Source Control)
  imports this one, so a dependency back would be a cycle.
- It is reached through the Project Reach experience fork in the Source Control
  sidebar; see `src/features/project-reach/README.md`.
