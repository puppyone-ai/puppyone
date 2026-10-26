# Project Reach Experience

This folder owns the opt-in switch that lets the "who can reach this project"
presentation ship **beside** the established surfaces instead of replacing them.

The canonical contract, the registry of entry points and new-path homes, and the
retirement plan live in puppy-issues
`document/puppyone-desktop/platform/experimental-path-forks.md`. Product authority
for the concepts and the user-facing wording is `document/product-philosophy.md`
in the same repository. This file is the short version, kept next to the code.

## The single decision point

`useProjectReachExperience()` is the only reader of
`experimentalSettings.enableProjectReach`. Surfaces never read the experimental
settings object directly, so the experience has one definition and one place to
retire.

## Fork convention

Fork **only at an entry point**, and keep the new presentation in new files:

```tsx
const reach = useProjectReachExperience();
return reach ? <NewSurface … /> : <EstablishedSurface … />;
```

- The established component keeps its behaviour. The only admissible change to it
  is the one render condition above, placed in its caller.
- Never push the condition down into a leaf component. A fork inside the tree
  multiplies the regression matrix along the whole subtree; the gate exists to
  stop that.
- Only presentation forks. Both paths read the same share and Git data owners, so
  they can never disagree about facts.

The allowlist of entry points, their decision counts and the registered new-path
directories live in `scripts/check-project-reach-gate.mjs`. Adding an entry point
means adding one line there in the same change.

## Retirement

The two paths are temporary by contract:

1. **Stage one — off by default.** Internal use only. The established path stays
   byte-identical so it remains a valid comparison baseline.
2. **Stage two — on by default.** The new presentation becomes the default and the
   switch becomes the way back, for one release cycle.
3. **Stage three — single path.** The established components, the switch, the
   settings row, this gate and this folder are deleted in a dedicated cleanup
   change, created when stage two lands.

The experience must not stay forked indefinitely. Stage three is a deliverable,
not an intention.
