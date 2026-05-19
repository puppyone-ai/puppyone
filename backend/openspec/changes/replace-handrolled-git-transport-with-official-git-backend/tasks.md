## 1. Implementation
- [x] 1.1 Spool receive-pack request bodies to disk in the Git HTTP router.
- [x] 1.2 Add an official `git receive-pack --stateless-rpc` quarantine path.
- [x] 1.3 Route receive-pack publishing through the official quarantine output while preserving Version Engine validation.
- [x] 1.4 Accept flush-only stateless receive-pack requests without HTTP 400.
- [x] 1.5 Keep Puppyone product rejections as Git receive-pack `ng` responses.
- [x] 1.6 Document the final Git push flow and authority boundary.
- [x] 1.7 Add real Git CLI coverage for large non-buffered/chunked pushes.
- [x] 1.8 Verify targeted Git transport and mixed Git/frontend suites.
