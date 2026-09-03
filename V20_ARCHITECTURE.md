# Code Patcher V21 — Core-First Architecture

V21 is a single integrated release. Historical V9/V13/V15 components are retained only when they strengthen the core patching contract.

## Core contract

`input source → patch parse → deterministic match → staged apply → replay verification → language validation → security policy → integrity → cross-file impact → PREPARE → ATOMIC COMMIT → post-commit hash verification`

Any failed gate returns the original source and marks the transaction rolled back.

## Engines

- `src/patchEngine.js`: deterministic SEARCH/REPLACE core, match safety, replay, validation, integrity, diff.
- `src/transactionEngine.js`: one transaction coordinator for single-file and project operations.
- `src/symbolIndex.js`: language-neutral definitions, imports, exports and references metadata.
- `src/impactAnalysis.js`: cross-file contract/consumer impact and dependency-cycle analysis.
- `src/dataflow.js`: bounded same-variable taint/data-flow heuristic; results are labeled heuristic.
- `src/policyEngine.js`: centralized security/impact/transaction policy.
- `src/languageParsers.js`: server-side Java/C/C++/Go compiler-backed AST adapters.
- `api/python-ast.py`: CPython AST service for Python.
- `server/compilerServer.mjs`: server-side compiler/transaction API.

## Server endpoints

`GET /health`

`POST /parse`

`POST /plan`

`POST /patch`

`POST /impact`

`POST /analyze-project`

`POST /project`

`POST /commit`

`POST /rollback`

## Safety rules

The browser never executes user source. Compiler-backed languages are parsed by trusted system tools on the server/Node side. The project transaction includes unchanged consumer files in the impact graph so a provider change can be blocked even when the consumer itself was not patched.

## Honest analysis labels

The project never presents regex-based consistency or taint rules as a real compiler type system. Heuristics are labeled `heuristic` and are not treated as proof of correctness.
