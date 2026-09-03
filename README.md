# Code Patcher V23 — Core-First

A fail-closed code patching tool whose primary contract is: **understand → plan → patch → verify → secure → impact-check → commit or rollback**.

## Core capabilities

- Deterministic SEARCH/REPLACE patching with exact and normalized modes.
- Full replay/verification and untouched-region checks.
- SHA-256 integrity protection and atomic project transactions.
- Real AST support for JavaScript/TypeScript/JSX/TSX/Python/Java/C/C++/Go.
- Shared symbol index, dependency graph and cross-file breaking-change analysis.
- Compiler Server for Java/C/C++/Go and heavy server-side validation.
- Central security/impact policy.
- Bounded data-flow/taint heuristic explicitly labeled as heuristic.
- Browser-safe UI with 20-language localization and persistent language selection.
- Project undo restores the complete pre-transaction snapshot.

## Run

```bash
npm ci
npm test
npm run build
```

Start compiler server separately:

```bash
npm run server
```

Then run Vite:

```bash
npm run dev
```

Default compiler server: `http://127.0.0.1:8787`. Override with `VITE_COMPILER_SERVER_URL`.

## Server API

- `GET /health`
- `POST /parse`
- `POST /plan`
- `POST /patch`
- `POST /impact`
- `POST /analyze-project`
- `POST /project` (prepare + persist transaction)
- `POST /commit` (atomic filesystem commit + post-write hash verification)
- `POST /rollback` (safe rollback with external-mutation guard)
- `POST /python-ast` (real CPython AST validation)

Project filesystem commits require an explicit workspace-relative `filePath` for every file. The compiler server remains loopback-only by default; if exposed on a non-loopback host, set `CODE_PATCHER_AUTH_TOKEN`.

## Configuration

Copy `.env.example` to `.env` and fill in the values you need (auth token, CORS
origins, ports, workspace root). Vite loads `VITE_*` variables from `.env`
automatically; the Node compiler server needs either
`node --env-file=.env server/compilerServer.mjs` (Node >= 20.6) or the
variables exported in your shell/deployment platform.

## Requirements

- Node.js `>=22.18.0`
- npm `>=9`
- Python 3
- Java/JDK for Java AST
- Clang/Clang++ or GCC/G++ for C/C++
- Go for Go AST

Compiler-backed languages are executed only through trusted local/server compiler processes; submitted source is never executed as an application.
