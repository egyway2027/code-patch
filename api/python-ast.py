#!/usr/bin/env python3
"""
Python AST service.

Parses Python source with CPython's own `ast` module and returns a structural
snapshot (functions/classes/imports/module-level exports) plus a small set of
security findings. It never executes, compiles-to-bytecode-and-runs, or imports
the submitted code — `ast.parse()` only builds a syntax tree; it does not run
anything.

Two entrypoints share the same core logic (`analyze`), so there is exactly one
place that understands Python source and both the deployed HTTP path and the
local test/dev path stay in sync:

1. HTTP (Vercel Python runtime): a `BaseHTTPRequestHandler` subclass named
   `handler`, the shape Vercel's `@vercel/python` builder expects for a file
   under /api. POST { "code": "...", "file_name": "..." } -> JSON result.
2. CLI (local dev / tests / offline use, e.g. when there is no serverless
   deployment behind `/api/python-ast`): reads the same JSON request from
   stdin, prints the same JSON result to stdout. This is what
   tests/python_ast_test.py exercises directly, and what patchEngine.js's
   client-side fallback path uses conceptually — the client cannot spawn this
   itself, but the identical logic on both entrypoints ensures dev and prod
   never disagree about what is valid Python.

Security findings mirror the philosophy used for JavaScript in codeAuditor.js:
every finding is a structural match against a real AST node shape (an actual
`ast.Call` whose function is `eval`, an actual `ast.Assign` inside a `subprocess`
call with `shell=True`, etc.) — never a text/regex scan of the source. The text
"eval(" appearing inside a string or comment is a `Constant` node, not a `Call`,
and is never flagged. Every finding here is a *warning*: it is informational and
does not affect `ok`/parse success. The caller (codeAuditor.js) decides whether
warnings gate a commit, exactly as it already does for the JavaScript findings
this service's shape is deliberately kept consistent with.
"""
import ast
import json
import sys

MAX_SOURCE = 2_000_000
MAX_NODES = 100_000

SECRET_KEY_NAMES = {
    "password", "passwd", "secret", "api_key", "apikey",
    "access_token", "auth_token", "token",
}
PLACEHOLDER_WORDS = ("test", "example", "sample", "dummy", "fake", "placeholder", "changeme", "xxxx", "your_key", "not_real")


def loc(n):
    return {"line": getattr(n, "lineno", None), "column": getattr(n, "col_offset", None)}


def param_name(p):
    if isinstance(p, ast.arg):
        return p.arg
    return "<complex>"


def call_dotted_name(node):
    """Best-effort dotted name for a Call's function, e.g. 'os.system', 'subprocess.run'."""
    func = node.func
    parts = []
    while isinstance(func, ast.Attribute):
        parts.append(func.attr)
        func = func.value
    if isinstance(func, ast.Name):
        parts.append(func.id)
        return ".".join(reversed(parts))
    return None


def has_keyword_true(node, kw_name):
    for kw in node.keywords or []:
        if kw.arg == kw_name and isinstance(kw.value, ast.Constant) and kw.value.value is True:
            return True
    return False


def looks_like_secret_value(value_node):
    if not isinstance(value_node, ast.Constant) or not isinstance(value_node.value, str):
        return False
    v = value_node.value
    if len(v) < 8:
        return False
    lowered = v.lower()
    return not any(w in lowered for w in PLACEHOLDER_WORDS)


def security_findings(tree):
    """Structural-only scan: every finding is a real AST node shape, never a text match."""
    findings = []

    def push(node, code, severity, message):
        findings.append({"code": code, "severity": severity, "confidence": "high" if severity in ("critical", "high") else "medium",
                          "line": getattr(node, "lineno", None), "message": message})

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            dotted = call_dotted_name(node)
            fname = dotted.split(".")[-1] if dotted else None
            if isinstance(node.func, ast.Name) and node.func.id in ("eval", "exec"):
                push(node, "PY-EVAL-EXEC", "critical", f"استدعاء {node.func.id}() فعلي: تنفيذ كود ديناميكي غير موثوق.")
            elif dotted == "os.system":
                push(node, "PY-OS-SYSTEM", "high", "استدعاء os.system(): تنفيذ أمر نظام عبر shell.")
            elif dotted in ("subprocess.run", "subprocess.call", "subprocess.Popen", "subprocess.check_output") and has_keyword_true(node, "shell"):
                push(node, "PY-SUBPROCESS-SHELL", "high", f"استدعاء {dotted}(..., shell=True): تنفيذ أمر عبر shell، خطر حقن أوامر إن كان المدخل غير موثوق.")
            elif dotted in ("pickle.load", "pickle.loads"):
                push(node, "PY-PICKLE-LOAD", "high", f"استدعاء {dotted}(): فك تسلسل بيانات غير موثوقة قد ينفذ كودًا عشوائيًا.")
            elif dotted == "yaml.load" and not has_keyword_true(node, "Loader"):
                # yaml.load without an explicit Loader defaults to the unsafe loader in PyYAML < 5.1.
                has_loader_kw = any(kw.arg == "Loader" for kw in node.keywords or [])
                if not has_loader_kw:
                    push(node, "PY-YAML-UNSAFE-LOAD", "high", "استدعاء yaml.load() بدون Loader صريح؛ استخدم yaml.safe_load().")
            elif fname in ("rmtree",) and dotted and dotted.startswith("shutil"):
                push(node, "FS-DESTRUCTIVE", "high", "استدعاء shutil.rmtree(): حذف متكرر من نظام الملفات.")
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name) and t.id.lower() in SECRET_KEY_NAMES and looks_like_secret_value(node.value):
                    push(node, "HARDCODED-SECRET", "warning", f'قيمة نصية طويلة في متغيّر باسمه "{t.id}"؛ تحقق أنه ليس سرًا فعليًا مكتوبًا في الكود.')

    return findings


def snapshot(tree):
    functions, classes, imports, exports = [], [], [], []
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            a = n.args
            params = [param_name(x) for x in list(a.posonlyargs) + list(a.args)]
            if a.vararg:
                params.append("*" + a.vararg.arg)
            params += [param_name(x) for x in a.kwonlyargs]
            if a.kwarg:
                params.append("**" + a.kwarg.arg)
            functions.append({"name": n.name, "params": params, "line": n.lineno, "async": isinstance(n, ast.AsyncFunctionDef)})
        elif isinstance(n, ast.ClassDef):
            classes.append({"name": n.name, "line": n.lineno})
        elif isinstance(n, ast.Import):
            for a in n.names:
                imports.append({"name": a.asname or a.name, "source": a.name, "line": n.lineno})
        elif isinstance(n, ast.ImportFrom):
            module = n.module or ("." * (n.level or 1))
            for a in n.names:
                imports.append({"name": a.asname or a.name, "source": module, "line": n.lineno})
    # Python has no JS-style `export`; module-level public (non "_"-prefixed) defs stand in for it.
    for n in (tree.body if isinstance(tree, ast.Module) else []):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and not n.name.startswith("_"):
            exports.append({"name": n.name, "kind": "class" if isinstance(n, ast.ClassDef) else "function", "line": n.lineno})
    return {"functions": functions, "classes": classes, "imports": imports, "exports": exports}


def analyze(payload):
    code = payload.get("code", "")
    file_name = payload.get("file_name", "file.py")
    if not isinstance(code, str):
        return {"ok": False, "strength": "ast", "error": "code must be a string"}
    if len(code) > MAX_SOURCE:
        return {"ok": False, "strength": "ast", "error": "source exceeds safety limit"}
    try:
        tree = ast.parse(code, filename=file_name, mode="exec", type_comments=True)
    except SyntaxError as e:
        return {"ok": False, "strength": "ast", "error": str(e), "line": e.lineno, "column": (e.offset or 1)}
    except Exception as e:  # pragma: no cover - defensive, ast.parse rarely raises other errors
        return {"ok": False, "strength": "ast", "error": str(e)}
    node_count = sum(1 for _ in ast.walk(tree))
    if node_count > MAX_NODES:
        return {"ok": False, "error": "AST node count exceeds safety limit"}
    return {
        "ok": True,
        "strength": "ast",
        "language": "python",
        "node_count": node_count,
        "ast": snapshot(tree),
        "findings": security_findings(tree),
    }


def main_cli():
    """stdin/stdout entrypoint used by local dev and tests/python_ast_test.py."""
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"invalid request JSON: {e}"}))
        return
    print(json.dumps(analyze(req), ensure_ascii=False))


try:
    from http.server import BaseHTTPRequestHandler

    class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel's Python runtime requires this exact name
        """Vercel Python serverless entrypoint for POST /api/python-ast."""

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b"{}"
                req = json.loads(raw or b"{}")
                result = analyze(req)
                status = 200
            except Exception as e:
                result = {"ok": False, "error": f"malformed request: {e}"}
                status = 400
            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            body = json.dumps({"ok": False, "error": "use POST with a JSON body: {\"code\": \"...\"}"}).encode("utf-8")
            self.send_response(405)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):  # silence default stderr access logging
            pass

except ImportError:  # pragma: no cover
    handler = None


if __name__ == "__main__":
    main_cli()
