# Code Patcher V13 Architecture

V13 keeps the V6 transaction invariant and adds project-wide static intelligence.

## Commit pipeline
Parse Patch → Preflight → Atomic Apply → Per-step Verify → Full Replay → AST/Syntax Validation → Security Audit → Type/Consistency Analysis → Data-flow/Taint Gate → Integrity SHA-256 → Commit.

## Project mode
All files are analyzed independently and the project commits only when every file passes every gate. Dependency Graph extracts imports and detects cycles. No source code is executed.

## Static intelligence
- Type/consistency diagnostics for common JS/TS/Python/C-family patterns.
- Source-to-sink taint analysis for common request/input → command/eval/HTML sinks.
- Dependency graph and cycle detection.
- Multi-file IDE tabs with upload, editing, patching, analysis and project transaction controls.

These analyses are conservative static gates, not replacements for a full compiler/type checker. Missing external tooling remains fail-closed where the core parser requires it.
