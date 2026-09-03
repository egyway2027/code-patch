# V15 Release / Verification Report

## Integrated scope

V15 combines the strongest V9 transaction core with the V13 multi-file/AST/security architecture and adds the V14.1/V15 server boundary and cross-file impact gate.

## Implemented

- Real Compiler Server API: `/health`, `/parse`, `/patch`, `/analyze-project`.
- Browser-safe compiler client with configurable `VITE_COMPILER_SERVER_URL`.
- Java/C/C++/Go patching routed through the compiler server instead of browser process spawning.
- Two-phase project transaction staging with cross-file impact analysis before commit.
- Breaking export removal/signature changes are HIGH severity and block project commit by default.
- Dependency-cycle changes are reported as MEDIUM severity.
- Java compiler diagnostics are checked after `javac` parsing; malformed Java fails closed.
- Java AST source columns are preserved.
- C/C++ entities are normalized to a common `function`/`class` contract.
- Go parser metadata is normalized.
- Java and Go helper compilation is cached per Node process.
- Browser-facing impact analysis no longer imports Node built-ins.
- Undo history stores the correct file index and previous result.
- Node/Babel engine requirement is aligned with the locked Babel parser version: Node >=22.18.0.
- Generated `__pycache__`, `dist`, and `node_modules` artifacts are excluded from release.

## Verification completed in this environment

- Python AST service test: PASS.
- V15 cross-file impact tests: PASS.
- Java/C/C++/Go adapter tests: PASS.
- Full Node/MJS syntax scan: PASS.
- Package / lockfile version and engine metadata consistency: PASS.
- Server smoke endpoint test was exercised with a temporary local parser shim; this validates the HTTP/server wiring, not the real Babel parser package.
- Java/Go helper caching reduced the adapter test run from ~25s to ~3s in the same environment.

## Environment limitation

A complete `npm test` and `vite build` could not be executed with the real dependency tree because this runtime has no `node_modules`, and `npm install` timed out while trying to reach the npm registry. The direct commands fail only at dependency resolution:

- `npm test` -> `ERR_MODULE_NOT_FOUND: @babel/parser`.
- `npm run build` -> `vite: not found`.

The project files and lockfile are prepared for a clean install with Node >=22.18.0. A genuine zero-failure claim for the complete suite requires running `npm ci`, then `npm test` and `npm run build` in an environment with registry access or an existing package cache.

## Release commands

```bash
npm ci
npm test
npm run build
npm run server
npm run dev
```
