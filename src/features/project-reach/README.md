# Project Reach Experience

This folder owns the opt-in gate that lets the Project Reach presentation ship
beside the established surfaces instead of replacing them.

Product authority for the concepts and the user-facing wording is
[Product Philosophy](https://github.com/puppyone-ai/puppy-issues/blob/main/document/product-philosophy.md).

## The single decision point

`useProjectReachExperience()` is the only reader of
`experimentalSettings.enableProjectReach`. Surfaces never read the experimental
settings object directly, so the experience has exactly one definition and one
place to retire.

## Fork convention

Fork **only at an entry point**, and keep the new presentation in new files:

```tsx
const reach = useProjectReachExperience();
return reach ? <NewSurface … /> : <EstablishedSurface … />;
```

- The established component keeps its behaviour. The only admissible change to
  it is the one render condition above, placed in its caller.
- Never push a condition down into a leaf component. A fork inside the tree
  multiplies the regression matrix along the whole subtree; the gate exists to
  stop it.
- Only the presentation layer forks. Both paths read the same share and Git
  data sources, so the two paths can never disagree about facts.

The allowlist of entry points lives in `scripts/check-project-reach-gate.mjs`.
Adding an entry point means adding one line there in the same change.

## Retirement

The two paths are temporary by contract:

1. **Stage one — off by default.** Internal use only. The established path stays
   byte-identical so it remains a valid comparison baseline.
2. **Stage two — on by default.** The reach presentation becomes the default and
   the switch becomes the way back.
3. **Stage three — single path.** The established components, the switch, the
   settings row, this gate, and this folder are deleted in a dedicated cleanup
   change.

The experience must not stay forked indefinitely. Stage three is a deliverable,
not an intention.
