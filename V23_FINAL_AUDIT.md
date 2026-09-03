# Code Patcher V23.0.0 — Final Core Audit

## Scope
This release is a core-first hardening pass over V22. The audit covered patch planning/matching, deterministic replay, integrity, filesystem transactions, recovery, workspace boundaries, symbol/impact analysis, AST adapters, server routing, browser/server separation, tests, packaging metadata, and generated-file hygiene.

## Correctness fixes applied
- Exact/normalized patch matching retained fail-closed ambiguity behavior.
- Line/column location logic now recognizes LF, CRLF, and CR.
- Trailing-EOL matching uses an anchored EOL expression.
- Patch plans are bound to engine version, file identity, original/result hashes, patch-set hash, and policy hash at transaction preparation.
- Commit verifies plan bindings and hashes of both original content and result content before writing.
- Every file is rechecked immediately before its atomic replacement.
- Read-only targets are refused by default.
- Duplicate resolved filesystem targets are rejected.
- File mode bits are preserved during atomic replacement.
- Workspace paths are checked against the real workspace path; symlink targets are refused.
- Durable transaction journal and per-file snapshots are written before COMMITTING state.
- Crash recovery reconciles actual filesystem state instead of blindly restoring every journal entry.
- Rollback restores only files confirmed to have committed, and refuses to overwrite a post-commit external mutation.
- Project transaction results carry durable per-file commit status.
- Server prepared-record persistence uses the durable transaction journal.
- Legacy intelligence dependency-graph resolution now shares canonical path resolution with cross-file impact analysis.
- Python AST service output is normalized into the generic AST snapshot used by semantic diff and legacy compatibility tests.
- V10 language test contracts were updated to the actual compiler-backed parser identifiers.
- Browser UI labels distinguish staged/in-memory project changes from server filesystem commits.

## Verification performed in this environment
- 40 JavaScript/MJS source/test/tool files: syntax check PASS.
- Java helper compiled using the same filename normalization used by the production adapter: PASS.
- Go helper build: PASS.
- V7 AST suite: PASS.
- V8 language adapter suite: PASS.
- V10 compatibility language suite: PASS.
- V11 deep AST suite: PASS.
- V13 intelligence suite: PASS.
- V15 impact suite: PASS.
- V15 language adapters suite: PASS.
- V21 regression suite: PASS.
- V21 filesystem transaction suite: PASS.
- V22/V23 core-hardening transaction suite: PASS.
- Python AST suite: PASS.
- ZIP integrity: verified after packaging.

## Environment limitation
The current execution environment is Node 22.16.0 and does not contain the project's npm dependencies. A network-backed `npm ci` attempt timed out, so the complete dependency-backed `npm test` and `vite build` could not be truthfully marked PASS here. Tests that require `@babel/parser` therefore could not be executed in this environment. No PASS claim is made for those unavailable dependency-backed stages.

## Release principle
No claim of zero defects is made solely from static syntax or partial tests. The core transaction protocol is designed to fail closed, reject unsafe filesystem states, and move uncertain recovery cases to explicit `RECOVERY_REQUIRED` instead of overwriting user data.


## V23 post-audit hardening pass

The following issues were fixed after the original audit:

- Python validation no longer silently falls back to a weak structural check when the real AST service is unavailable; Node/server execution invokes the bundled CPython AST helper directly, while browser execution uses `/api/python-ast`.
- Vercel routing now preserves the Python AST endpoint instead of allowing the SPA catch-all to swallow it.
- Removed dynamic `new Function()` module loading from the validation path.
- Hardened policy normalization against prototype-pollution-style `__proto__` input by allowlisting policy keys and types.
- Transaction targets can no longer point at the transaction journal or workspace lock.
- Non-loopback compiler-server exposure now requires `CODE_PATCHER_AUTH_TOKEN`; CORS defaults to an explicit local allowlist instead of `*`.
- Health output no longer discloses the server workspace filesystem path.
- Project UI now separates **Prepare** from **Commit** and requires an explicit workspace-relative path before enabling filesystem commit.
- Verification scripts include the compiler-server and new V23 hardening tests.
- Release-facing V12/V21 labels were normalized to V23 where they described the active release.

### Verification performed in the repair environment

- Node syntax check: PASS for all `.js`/`.mjs` sources and tests.
- Python syntax check: PASS.
- CPython AST tests: PASS.
- Policy prototype-pollution hardening test: PASS.
- Workspace/journal path confinement tests: PASS.
- Full `npm ci`, dependency-backed test suite, and Vite production build could not be completed because registry access timed out in the repair environment; no green result is claimed for those checks.
