# V20 Release Report

## Integrated changes

V20 consolidates the strongest V9 patch-core behavior with the V13/V15 AST, security, project, compiler-server, dependency and impact layers.

### Core correctness
- Single canonical transaction coordinator.
- Atomic project commit/rollback.
- Expected source hash support to detect external mutation before a patch.
- Replay and untouched-region verification.
- SHA-256 integrity gate.

### Code understanding
- Real AST adapters for JS/TS/JSX/TSX, Python, Java, C, C++ and Go.
- Shared symbol index and import metadata.
- Cross-file breaking-export detection.
- Dependency cycle reporting.
- Bounded data-flow/taint heuristic with sanitization awareness.

### Security
- Central policy engine for Critical/High/Medium/Low findings.
- High-risk findings can enter review without pretending they are certain exploits.
- Existing structural JS/Python security analysis retained.

### Server/compiler
- `/plan`, `/patch`, `/impact`, `/project`, `/rollback` APIs added.
- Java/C/C++/Go remain server-side compiler operations.
- Browser-safe client remains free of Node compiler dependencies.

### UI fundamentals
- Successful file patches update the editor state.
- Project undo restores the complete pre-transaction project snapshot.
- Safety-gate status is surfaced in the main UI.

## Verification performed in this environment

- 34 JS/MJS source/test/tool files passed `node --check`.
- Python AST tests passed.
- Cross-file impact tests passed.
- Java/C/C++/Go language-adapter tests passed.
- ZIP integrity can be verified after packaging.

## Environment limitation

The environment does not contain installed npm dependencies and access to the npm registry is unavailable. Therefore a genuine `npm ci`, `npm test` full suite, and `vite build` cannot be truthfully reported as passing here. V20 deliberately records this limitation rather than fabricating a green build result.
