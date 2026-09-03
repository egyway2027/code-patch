# Code Patcher V11 Architecture

V11 combines the V6 transaction/security core with V8/V10 language expansion and deep AST analysis.

## Commit invariant
`parse patch -> deterministic plan -> atomic apply -> per-step replay -> deep syntax/AST validation -> semantic diff -> security audit -> integrity hash -> commit`

Any required stage failure blocks the transaction and returns the original source.

## Real AST backends
- JavaScript / TypeScript / JSX / TSX: Babel parser AST.
- Python: CPython `ast` service.
- Java: JDK `com.sun.source.tree` through a trusted helper compiled with `javac`.
- C / C++: Clang JSON AST with syntax-only compilation.
- Go: Go standard-library `go/parser` through a trusted helper binary.

No user program is executed. Helper programs are trusted tooling only and receive source as data.

## Security
The V6/V10 AST-aware JavaScript security rules and conservative non-JS security rules remain in place. Strict mode blocks critical findings. Parser availability is fail-closed.
