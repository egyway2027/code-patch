# Code Patcher V21 — Core Hardening / Core-First

V21 is a single integrated release focused on correctness of the original tool: precise patching, verification, safety, project impact and atomic filesystem commits.

## Core contract

`source → patch parse → deterministic match → staged apply → per-step verify → replay → language validation → security policy → integrity → cross-file impact → prepare → atomic filesystem commit → post-commit hash verification`

Preparation never mutates the filesystem. Only the server commit endpoint may write files, and it requires explicit file paths constrained to the configured workspace root.

## Core engines

- `src/patchEngine.js`: deterministic SEARCH/REPLACE matching, ambiguity rejection, bounded patch budgets, replay verification, untouched-region verification, language validation, integrity and diff.
- `src/transactionEngine.js`: browser-safe preparation coordinator; no filesystem side effects.
- `server/transactionFilesystem.mjs`: trusted server-only atomic write/rollback layer with SHA-256 verification.
- `src/symbolIndex.js`: language-neutral definitions/imports/exports metadata.
- `src/impactAnalysis.js`: direct and transitive cross-file impact, breaking contracts and dependency cycles.
- `src/analysisEngine.js`: static consistency and explicitly heuristic data-flow analysis.
- `src/policyEngine.js`: centralized BLOCK/REVIEW/PASS policy; review findings cannot silently commit.
- `src/languageParsers.js`: server-side Java/C/C++/Go compiler-backed AST adapters.
- `api/python-ast.py`: CPython AST service.
- `server/compilerServer.mjs`: compiler, preparation, commit and rollback API.

## Transaction rules

1. Prepare validates every file.
2. Every source hash is captured before commit.
3. Cross-file impact is evaluated before commit.
4. Review findings require explicit approval.
5. Commit requires explicit `filePath` values and a bounded workspace root.
6. All target files are read and hash-checked before the first write.
7. Writes are atomic temporary-file replacements.
8. Every written file is hash-verified.
9. Any failure triggers restoration of every file already written.

## API

- `GET /health`
- `POST /parse`
- `POST /plan`
- `POST /patch`
- `POST /impact`
- `POST /analyze-project`
- `POST /project` — prepare and persist a transaction record
- `POST /commit` — atomically commit the persisted transaction
- `POST /rollback` — restore original content and verify hashes
