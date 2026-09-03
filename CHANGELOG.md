# V23.1.0 — Merged & Hardened (v23-FIXED + v23-repaired)

This release merges two divergent V23 branches (a test-suite-tolerance fix branch
and a security-hardening branch) into one, then fixes defects found in each. See
`MERGE_NOTES.md` for the full list of what was merged, fixed, and added.

Highlights:
- Fixed a build-breaking JSX syntax error in `src/CodePatcher.jsx` (adjacent
  elements rendered under a `&&` guard without a closing brace/fragment).
- Restored graceful skip-when-toolchain-unavailable behavior in the Java/Go/C++
  test suites without weakening any assertion that *can* run.
- `src/symbolIndex.js` now loads its shared Babel-AST parser (from
  `patchEngine.js`, avoiding config drift) lazily and defensively, so a missing
  `@babel/parser` install degrades only JS/TS symbol extraction instead of
  crashing Python/Java/Go/C++ lexical analysis and everything that depends on it.
- Kept the security-hardening branch's fixes: authenticated + CORS-restricted
  compiler server, fail-closed Python AST validation via direct subprocess
  invocation, removal of `new Function()`-based dynamic import, prototype-
  pollution-safe policy normalization, and transaction-journal/lock path
  protection.
- Fixed a real `vite build` failure (confirmed by an actual Vercel build of
  this project) caused by the module worker in `src/CodePatcher.jsx` bundling
  under Rollup's default IIFE worker format, which is incompatible with
  code-splitting: added `worker: { format: 'es' }` to `vite.config.js`. This
  was a latent bug present in both source branches.
- Removed leftover dead code (`server/transactionFilesystem.mjs`'s always-false
  `committed` filter; `server/compilerServer.mjs`'s no-op `/health` branch whose
  comment didn't match its behavior).
- Added `.gitignore` and `.env.example` (neither existed in either branch).

# V23.0.0 Core Hardened

- Durable transaction journal with startup recovery for incomplete commits.
- Workspace lock with stale-lock reclamation.
- Immutable PatchPlan snapshots and plan hashing.
- Result hash verification before and after filesystem writes.
- Atomic rollback preflight prevents partial rollback after external mutation.
- Real Babel-AST symbol extraction for JavaScript/TypeScript with conservative fallbacks for other languages.
- Expanded Go symbols/imports and transitive impact across before/after dependency graphs.
- Directory fsync after atomic renames where supported.
- Added core hardening regression tests.

# Changelog

## 21.0.0 — Core-First Full Merge

- Unified V9/V13/V15 into one canonical transaction path.
- Added centralized safety and impact policy.
- Added symbol index and cross-file impact engine.
- Added bounded heuristic data-flow analysis.
- Added compiler-server planning/project/impact/rollback APIs.
- Added project-wide atomic transaction handling with pre-transaction hash checks.
- Fixed project impact analysis to include unchanged consumer files.
- Fixed frontend result persistence and project undo.
- Added V21 architecture and release verification documents.
