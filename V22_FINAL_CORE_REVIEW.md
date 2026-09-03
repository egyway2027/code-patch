# Code Patcher V23.0.0 — Final Core Hardening Review

## Scope
This release is a one-pass hardening of the core patching and transaction engine. The objective is not feature accumulation; it is deterministic, safe code modification.

## Core invariants
1. Prepare never writes to the workspace.
2. A PatchPlan is deterministic and hash-bound.
3. Every target file is protected by its original SHA-256.
4. No filesystem commit occurs until all preconditions pass.
5. Filesystem writes are atomic per file and durably journaled.
6. A multi-file commit is recoverable after process interruption.
7. Rollback preflights all targets before restoring any file.
8. Post-commit rollback refuses to overwrite files changed by an external actor.
9. Transaction identifiers are deterministic and include file paths/types, source hashes, result hashes, and plan hashes.
10. Impact analysis uses both before/after graphs and propagates transitive consumers.
11. JavaScript/TypeScript symbols use real Babel AST when the parser dependency is installed; other languages use conservative language-specific adapters/fallbacks.

## Fixes implemented
- Durable transaction journal with states: PREPARED → COMMITTING → COMMITTED / ROLLED_BACK / RECOVERY_REQUIRED.
- Startup recovery for interrupted COMMITTING transactions.
- Workspace lock with stale-process lock reclamation.
- File and journal fsync plus directory fsync where supported.
- Immutable PatchPlan snapshots with SHA-256 binding.
- Pre-commit result-hash verification.
- True idempotent committed-transaction replay through durable journal state.
- Full preflight before rollback to prevent partial rollback.
- External post-commit mutation protection during rollback.
- Safe workspace-root path enforcement.
- Improved Go exported symbols/methods/imports.
- Real Babel-AST symbol extraction for JS/TS, with conservative fallback when unavailable.
- Cross-file impact checks using both before/after dependency graphs.
- Transitive impact for consumers of changed providers.
- Transaction IDs now bind file paths/types as well as plan/source/result hashes.
- Added high-value hardening regression tests.
- Removed obsolete operation-step budget setting from the active public limits.
- Updated release/version metadata to V23.0.0.

## Verification performed in this environment
PASS:
- V23 core hardening tests
- Filesystem transaction tests
- Cross-file regression/impact tests
- Language adapter tests (Java/C/C++/Go)
- Python AST tests
- Node syntax checks for all JS/MJS/JSX source, server, tools, and tests

Not claimed as PASS:
- `npm test` full suite: blocked before execution because `node_modules/@babel/parser` is not installed in the execution environment.
- `vite build`: not run to a real build because dependencies are not installed in the execution environment.

This is an environment/dependency limitation, not a claim of successful full build.

## Release posture
Core transaction, rollback, integrity, and impact logic has been hardened and tested locally. A final production release still requires running `npm ci`, then the full test suite and Vite build in an environment with the declared dependencies available.
