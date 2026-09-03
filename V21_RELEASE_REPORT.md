# V21 Release Report

## Core fixes implemented

- Prepare/commit semantics are now separated. No prepare API reports `committed: true`.
- Added real server-only atomic filesystem commit and rollback.
- Added persistent JSON transaction journal on disk.
- Added workspace-root path confinement.
- Added pre-write external mutation detection with SHA-256.
- Added post-write SHA-256 verification.
- Added rollback verification.
- Added explicit review approval requirement to security and impact review gates.
- Added exact patch operation/character budgets.
- Replaced the previous `verifyUntouched` alias with actual prefix/suffix untouched-region checks for every patch step.
- Added duplicate project filename rejection.
- Added transitive cross-file impact reporting.
- Added V20/V13 compatibility facade while moving active analysis implementation into `analysisEngine.js`.
- Removed the obsolete `patchEngine.v9.js` active duplicate.
- Added dedicated cryptographic helper module so the server filesystem layer does not import the Patch Core just for hashing.
- Updated frontend to treat browser edits as staged/in-memory results, not filesystem commits.

## Verification performed in the current environment

PASS — JS/MJS syntax scan: 39 files.
PASS — V21 filesystem transaction test (commit, rollback, external mutation guard).
PASS — V21 transitive impact regression test.
PASS — cross-file impact suite.
PASS — Java/C/C++/Go language adapter suite.
PASS — Python AST suite.

The environment does not contain installed npm dependencies (`@babel/parser`, `vite`, etc.), and npm registry access was unavailable, so `npm ci`, the full Node test suite and `vite build` could not be truthfully marked PASS here.
