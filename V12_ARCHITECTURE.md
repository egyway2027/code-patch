# V12 Architecture

Patch transaction:
Parse → Preflight → Atomic Apply → Verify → Replay → AST/Syntax Validation → Security Audit → Integrity → Commit

Project transaction:
Parse project manifest → validate every file → apply each file atomically in memory → validate/audit/integrity every result → commit the project result only when every file passes.

UI:
20-language selector → localStorage persistence → automatic RTL for Arabic/Urdu → translated core workflow labels.
