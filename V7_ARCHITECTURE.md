# Code Patcher V11

V11 combines the safe V4.1 transaction core with the V5 audit layer and a unified AST/semantic-analysis layer.

## Languages
- JavaScript / JSX
- TypeScript / TSX
- Python (CPython `ast`)

## Safety
- Parsing only; source code is never executed by the Python AST service.
- AST failures are fail-closed.
- Source and AST node limits prevent pathological inputs.
- Existing atomic patch / replay / integrity flow is retained.

## Semantic analysis
Before/after AST snapshots detect:
- functions/classes/variables
- function signature changes
- imports
- exports/public Python module definitions
- added/removed semantic entities

## Python AST
`api/python-ast.py` is a small stdin/stdout JSON service using Python's standard `ast` module.
