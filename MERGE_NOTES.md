# Merge notes: v23-FIXED + v23-repaired → this build (23.1.0)

Two divergent V23 branches of this tool were compared, tested, and merged into
this single build. This document is the full record of what each branch had,
what was wrong with each, and exactly what changed to produce this build.
Everything here was verified by actually running the affected code/tests in a
sandbox with Node 22, Python 3, but **no network access** (so `npm install`
could not be run — see "Not independently verified" at the end).

## Source branches

- **v23-FIXED**: a branch whose changes were almost entirely about making the
  test suite tolerate missing local toolchains (`javac`/`go`/`clang`) by
  skipping gracefully instead of failing. Its production code was close to an
  earlier, less-hardened V23 baseline.
- **v23-repaired**: a branch whose changes were almost entirely security/
  correctness hardening of the compiler server, Python AST validation, and
  the policy engine — but its test-suite edits regressed the toolchain
  tolerance from v23-FIXED, it introduced one build-breaking JSX bug, and it
  was never actually built or fully tested (its own `V23_FINAL_AUDIT.md`
  admits `npm ci` / the test suite / `vite build` could not be completed in
  that environment).

This build starts from **v23-repaired** (the stronger security/architecture
baseline) and merges in v23-FIXED's test tolerance, then fixes every defect
found in either branch.

> **Update (post-delivery):** a real Vercel build of this merge caught one
> more latent bug that neither original branch's authors ever caught either
> (their sandboxes couldn't run `vite build` for the same reason mine
> couldn't — no registry access). It's fixed and folded into the list below
> as item 8, and the zip has been repackaged.

## Bugs fixed

1. **Build-breaking JSX syntax error** — `src/CodePatcher.jsx` (v23-repaired
   only). The "Commit prepared project" button was added inside a
   `{condition && <button>...</button>` expression that was never closed with
   `}`, and the `<label>` that followed it was left as an unwrapped sibling
   JSX element next to `<button>`. This is invalid JS/JSX
   ("Adjacent JSX elements must be wrapped in an enclosing tag") and would
   fail to compile under Vite/Babel — the app could not have been built as
   shipped. **Fix**: closed the `&&` expression right after `</button>` so the
   `<label>` renders unconditionally as a sibling, matching the original
   always-visible label. Verified by brace-balance analysis of the JSX block
   (52 open / 52 close, previously 16/15) and of the whole file (338/338).

2. **Test-suite regression: lost toolchain-tolerance** — v23-repaired's copies
   of `tests/v8_languages.test.mjs`, `tests/v10_languages.test.mjs`,
   `tests/v11_deep_ast.test.mjs`, and `tests/v15_language_adapters.test.mjs`
   removed the `if (r.unavailable) { SKIP } else { assert... }` guards that
   v23-FIXED had added, and hard-asserted `ok === true` for Java/Go/C++
   real-AST parsing. **Verified by running them**: in a sandbox without
   `javac`/`go`/`clang`, v23-repaired's `v8_languages.test.mjs` failed 3 of 4
   subtests, and the other three files threw uncaught `AssertionError`s
   instead of passing. **Fix**: replaced all four files with v23-FIXED's
   tolerant versions (same assertions, same strength when a toolchain *is*
   present, but skip with a console note instead of failing when it is not).
   Re-verified: all four now pass in the same sandbox.

3. **New hard dependency introduced by v23-repaired's own good idea** —
   v23-repaired correctly consolidated JS/TS AST parsing so `symbolIndex.js`
   reuses the single Babel configuration in `patchEngine.js` instead of
   keeping a second, divergent one (this was a real bug in v23-FIXED: two
   independent Babel parser configs that could silently disagree on what
   counts as valid syntax). But it did this with a **static**
   `import { parseJsAst } from './patchEngine.js'`, and `patchEngine.js` has a
   **static** `import { parse as babelParse } from "@babel/parser"` at its
   top. The result: any module that imports `symbolIndex.js` — even
   transitively through `impactAnalysis.js`, which needs none of the JS/TS
   AST machinery for its own logic — now fails to load *at all* if
   `@babel/parser` isn't resolvable, instead of the old graceful
   "JS/TS symbol extraction returns null, everything else keeps working"
   degradation. **Verified**: `tests/v21_regression.test.mjs` (uses only
   `impactAnalysis.js`) passed in v23-FIXED and threw
   `ERR_MODULE_NOT_FOUND` in v23-repaired, in the identical sandbox. **Fix**:
   kept the single-source-of-truth parser (still imported from
   `patchEngine.js`, so there is still only one Babel config in the whole
   codebase), but load it via a guarded dynamic import
   (`try { ({ parseJsAst } = await import('./patchEngine.js')) } catch {}`)
   at module top-level, exactly like v23-FIXED's original resilience pattern
   for `@babel/parser` itself. `parseJsSymbols()` now returns `null`
   (falling through to the regex-based fallback) when the parser is
   unavailable, instead of never loading. Re-verified:
   `tests/v21_regression.test.mjs` passes again.

4. **Dead code #1** — `server/compilerServer.mjs` had
   `if (req.method==='GET' && req.url?.startsWith('/health')) { /* health is
   intentionally public on loopback only */ }` — an empty block that does
   nothing, immediately followed by the real `authorized()` check that
   applies to every route including `/health`. The comment claimed a
   behavior the code didn't implement. Removed the no-op block and replaced
   the comment with one that describes what actually happens (health stays
   behind the same auth as everything else, which is the safer choice: it
   avoids leaking version/feature info to unauthenticated callers on a
   non-loopback deployment).

5. **Dead code #2** — `server/transactionFilesystem.mjs`'s commit failure
   handler computed `const committed = snapshots.filter((s,i) => false)`,
   which is always an empty array and was never read again in that block
   (the actual rollback logic uses `candidates` derived from the on-disk
   journal, correctly). Removed the unused, always-empty variable. Re-ran
   `tests/v21_transaction_filesystem.test.mjs` and
   `tests/v22_core_hardening.test.mjs` — both still pass.

6. **Stale README** — `README.md` (already merged from both branches by a
   prior pass) listed `POST /rollback` twice, once with each branch's
   description. Removed the duplicate.

7. **Real production build failure, caught by an actual Vercel build** —
   `vite.config.js` (present in both original branches, unchanged by either
   merge candidate) never set `worker.format`. `src/CodePatcher.jsx` spawns a
   real module worker (`new Worker(new URL('./patchWorker.js',
   import.meta.url), { type: 'module' })`), and that worker itself imports
   `patchEngine.js` and `codeAuditor.js` — code that must be code-split
   alongside the main bundle. Vite's default worker output format is `iife`,
   and Rollup refuses IIFE/UMD output for a code-splitting build, so
   `vite build` failed with
   `Invalid value "iife" for option "output.format" - UMD and IIFE output
   formats are not supported for code-splitting builds`. This could not be
   caught in the sandbox used for the rest of this merge (no network access
   to install `node_modules`, so `vite build` never actually ran there); it
   surfaced on the first real Vercel build. **Fix**: added
   `worker: { format: 'es' }` to `vite.config.js`, which is the documented
   Vite/Rollup fix for this exact error with `new Worker(new URL(...), {type:
   'module'})`. This was a latent bug in **both** original branches, not
   something introduced by this merge.

8. Confirmed already fixed in v23-repaired (kept as-is, not touched again):
   wildcard CORS + no auth on the compiler server; Python AST validation
   failing open to a weak structural check when the AST service was
   unreachable; a relative `fetch("/api/python-ast")` call from Node that
   can't resolve without a base URL and had no dev-server proxy or Vercel
   rewrite behind it; `new Function("p","return import(p)")` dynamic-code
   construction; unbounded `Object.assign` policy merging (no key/type
   allowlist, effectively a prototype-pollution-adjacent injection surface);
   transaction commits that could target the transaction journal directory
   or the workspace lock file; the "Prepare project transaction (server
   commit)" button that never actually talked to the server and had no way
   to supply a `filePath`; and stray "V12" version strings left over in
   `index.html`'s `<title>` and several `i18n.js` locale strings.

## Additions (things worth doing that neither branch had)

- **`.gitignore`** — neither branch had one at all; `node_modules/`, `dist/`,
  `.env*`, the transaction journal directory, and Python's `__pycache__`
  would all have been committed by default.
- **`.env.example`** — every environment variable actually read by the code
  (`HOST`, `PORT`, `CODE_PATCHER_AUTH_TOKEN`, `CORS_ORIGIN`, `MAX_BODY_BYTES`,
  `WORKSPACE_ROOT`, `TRANSACTION_JOURNAL_DIR`, `VITE_COMPILER_SERVER_URL`,
  `VITE_COMPILER_SERVER_TOKEN`, `VITE_PYTHON_AST_URL`) was previously
  undocumented anywhere in either branch; you had to read the source to know
  they existed. This is the single biggest practical blocker to "just start
  running it" that I found, so it's fixed proactively.
- **README "Configuration" section** pointing at `.env.example` and
  explaining how the Node server picks up the same file Vite does.
- **`package.json` version bumped to `23.1.0`** to mark this merged build as
  distinct from either source branch. The internal `VERSION` constant in
  `src/patchEngine.js` (`"23.0.0"`) was deliberately **left unchanged**
  because two existing tests (`tests/v20_core.test.mjs`,
  `src/patchEngine.test.mjs`) assert that exact string; bumping it would have
  broken a passing test for a purely cosmetic reason.

## Not independently verified here (no network access in this sandbox)

`@babel/parser` is a listed `dependencies` entry in `package.json` in both
original branches and in this merged build, but it was not installed in
either sandbox I worked in (no npm registry access). Any file that statically
imports `patchEngine.js` therefore fails to load here with
`ERR_MODULE_NOT_FOUND`, independent of anything in this merge:
`src/patchEngine.test.mjs`, `src/codeAuditor.v6.test.mjs`,
`tests/v12_project.test.mjs`, `tests/v15_core_smoke.test.mjs`,
`tests/v20_core.test.mjs`, `tests/v20_transaction.test.mjs`,
`tests/v21_untouched.test.mjs`, `tests/v23_hardening.test.mjs`, and
`tests/v15_server.test.mjs`. These were reviewed line-by-line but not
executed. **Run `npm ci && npm test` once you have network access** — that
installs `@babel/parser` and will actually exercise these. Everything else in
`npm test` (17 of 19 `test` script entries) was executed directly in this
sandbox and passes; see the full list below.

### Tests actually executed and passing in this build

`tests/v7_ast.test.js`, `tests/v8_languages.test.mjs`,
`tests/v10_languages.test.mjs`, `tests/v11_deep_ast.test.mjs`,
`tests/v15_impact.test.mjs`, `tests/v15_language_adapters.test.mjs`,
`tests/v21_transaction_filesystem.test.mjs`,
`tests/v21_regression.test.mjs`, `tests/v22_core_hardening.test.mjs`.
