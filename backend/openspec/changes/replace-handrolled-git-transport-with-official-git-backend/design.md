## Context
Puppyone exposes scope-bound repositories over Git smart HTTP. Fetch already shells out to official `git upload-pack --stateless-rpc`, but push still used a local Python pkt-line parser plus manual pack unpacking. A real Access Point push exposed this gap: Apple Git sent a stateless receive-pack POST with a flush-only body before the pack path, and Puppyone returned HTTP 400 instead of behaving like a Git host.

## Goals / Non-Goals
- Goals: Make receive-pack robust for normal Git clients, large packs, chunked HTTP bodies, thin packs, empty stateless requests, and standard report-status responses.
- Goals: Keep Puppyone's Version Engine, scope/exclude validation, audit, CAS, and conflict policy as the canonical semantic layer.
- Non-Goals: Add full GitHub branch/tag semantics, pull-request semantics, or server-side merge behavior to scope remotes.
- Non-Goals: Change L2-L8 product write semantics or make Git force push a Puppyone merge proposal.

## Decisions
- Decision: HTTP routes spool receive-pack bodies to a temporary file by streaming `request.stream()`.
- Decision: Receive-pack runs `git receive-pack --stateless-rpc` against a temporary quarantine bare repo whose alternates point at the transport cache.
- Decision: The quarantine bare repo is never authoritative. Objects move into Puppyone's canonical object store only after Version Engine publish succeeds.
- Decision: The adapter still performs minimal command inspection to enforce Puppyone's single scope-bound `refs/heads/main` surface and to pass the proposed tree into the Version Engine.
- Decision: Product-level rejections after official Git acceptance are encoded as receive-pack `ng` responses rather than HTTP errors.
- Decision: For Access Points with excludes, the Git client pushes against a filtered view; Puppyone applies only the visible changed paths back onto the canonical scope tree so hidden files are preserved.

## Risks / Trade-offs
- Scope remotes still intentionally expose a narrower ref model than GitHub: only `refs/heads/main` is writable for an Access Point.
- Signed push certificates, multi-ref pushes, tags, and push options remain outside the Puppyone scope-remote contract until the product adds explicit storage semantics for them.
- A large push now relies on local disk spooling; deployments must provision temp space and normal request-size limits at the proxy layer.
- Excluded-scope pushes may promote accepted Git objects before the final scope CAS so the canonical tree can reference newly uploaded blob ids; rejected heads still do not advance.

## Validation
- Compile the changed Git transport modules.
- Run targeted receive-pack/parser/outcome tests.
- Run real Git CLI push/clone tests, including a large push with tiny `http.postBuffer`.
- Run the mixed Git/frontend E2E that exercises concurrent Git writes and product saves.
