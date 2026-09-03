# Code Patcher V15 Architecture

V15 is the full merge line built from the strongest V9 transaction core and the V13 multi-file intelligence stack.

## Transaction pipeline

`parse patch -> preflight -> apply atomically -> step verification -> replay verification -> language validation -> security audit -> static intelligence -> cross-file impact analysis -> integrity hash -> commit`

Any failed gate returns the original source/project state and marks the transaction as rolled back.

## Compiler Server API

The browser must not spawn `javac`, `clang`, `go`, or Python processes. V15 therefore provides `server/compilerServer.mjs`.

Endpoints:

- `GET /health` — readiness/version probe.
- `POST /parse` — compiler-backed AST/syntax parsing for Java/C/C++/Go/Python.
- `POST /patch` — full server-side patch transaction for compiler-backed languages.
- `POST /analyze-project` — cross-file impact analysis.

The server uses fixed, private temporary directories, a request-size cap, `-proc:none` for Java, `-fsyntax-only` for C/C++, and the Go parser helper. User source is never executed.

## Cross-file Impact Analysis

`src/impactAnalysis.js` compares before/after exports, tracks import bindings, resolves local module specifiers, identifies breaking export removals/signature changes, and reports dependency-cycle changes. High-severity consumer breakage blocks a project commit unless review application is explicitly enabled.

## Language adapters

- Java: JDK Compiler Tree API with diagnostics checked before AST acceptance.
- C/C++: Clang/GCC syntax gate plus Clang JSON AST, normalized into a common entity schema.
- Go: `go/parser` helper.
- Python: CPython `ast` helper.
- JS/TS/JSX/TSX: Babel parser.

Java and Go helper compilation is cached per server process to avoid recompiling the trusted helper for every request.

## Browser/server boundary

The browser worker remains fail-closed for compiler-backed languages. `CodePatcher.jsx` routes Java/C/C++/Go patch requests to the V15 compiler server and keeps JS/TS/JSON/HTML/CSS/text on the browser transaction worker.
