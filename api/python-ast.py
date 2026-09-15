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
import os
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
            if (isinstance(node.func, ast.Name) and node.func.id in ("eval", "exec")) or dotted in ("builtins.eval", "builtins.exec", "__builtins__.eval", "__builtins__.exec"):
                push(node, "PY-EVAL-EXEC", "critical", f"استدعاء {fname}() فعلي: تنفيذ كود ديناميكي غير موثوق.")
            elif dotted == "os.system":
                push(node, "PY-OS-SYSTEM", "high", "استدعاء os.system(): تنفيذ أمر نظام عبر shell.")
            elif dotted in ("subprocess.run", "subprocess.call", "subprocess.Popen", "subprocess.check_output") and has_keyword_true(node, "shell"):
                push(node, "PY-SUBPROCESS-SHELL", "high", f"استدعاء {dotted}(..., shell=True): تنفيذ أمر عبر shell، خطر حقن أوامر إن كان المدخل غير موثوق.")
            elif dotted in ("pickle.load", "pickle.loads"):
                push(node, "PY-PICKLE-LOAD", "high", f"استدعاء {dotted}(): فك تسلسل بيانات غير موثوقة قد ينفذ كودًا عشوائيًا.")
            elif dotted == "yaml.load":
                has_loader = len(node.args) >= 2 or any(kw.arg == "Loader" for kw in node.keywords or [])
                if not has_loader:
                    push(node, "PY-YAML-UNSAFE-LOAD", "high", "استدعاء yaml.load() بدون Loader صريح؛ استخدم yaml.safe_load().")
            elif (dotted in ("shutil.rmtree", "os.remove", "os.unlink", "os.rmdir") or
                  (isinstance(node.func, ast.Name) and node.func.id in ("rmtree", "remove", "unlink", "rmdir"))):
                push(node, "FS-DESTRUCTIVE", "high", f"استدعاء {dotted or fname}(): حذف من نظام الملفات.")
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                name = t.id if isinstance(t, ast.Name) else (t.attr if isinstance(t, ast.Attribute) else None)
                if name and name.lower() in SECRET_KEY_NAMES and looks_like_secret_value(node.value):
                    push(node, "HARDCODED-SECRET", "warning", f'قيمة نصية طويلة في متغيّر باسمه "{name}"؛ تحقق أنه ليس سرًا فعليًا مكتوبًا في الكود.')
        elif isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and isinstance(k.value, str) and k.value.lower() in SECRET_KEY_NAMES and looks_like_secret_value(v):
                    push(node, "HARDCODED-SECRET", "warning", f'قيمة نصية طويلة في مفتاح قاموس باسم "{k.value}"؛ تحقق أنه ليس سرًا فعليًا مكتوبًا في الكود.')

    return findings


def extract_params(n):
    a = n.args
    params = [param_name(x) for x in list(a.posonlyargs) + list(a.args)]
    if a.vararg:
        params.append("*" + a.vararg.arg)
    params += [param_name(x) for x in a.kwonlyargs]
    if a.kwarg:
        params.append("**" + a.kwarg.arg)
    return params


def snapshot(tree):
    functions, classes, imports, exports = [], [], [], []

    def walk_scope(node, parent_class=None):
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                fn_item = {
                    "name": child.name,
                    "params": extract_params(child),
                    "line": child.lineno,
                    "async": isinstance(child, ast.AsyncFunctionDef),
                }
                if parent_class:
                    fn_item["class"] = parent_class
                functions.append(fn_item)
                if parent_class is None and not child.name.startswith("_"):
                    exports.append({"name": child.name, "kind": "function", "line": child.lineno})
            elif isinstance(child, ast.ClassDef):
                classes.append({"name": child.name, "line": child.lineno})
                if parent_class is None and not child.name.startswith("_"):
                    exports.append({"name": child.name, "kind": "class", "line": child.lineno})
                walk_scope(child, parent_class=child.name)
            else:
                walk_scope(child, parent_class=parent_class)

    walk_scope(tree)

    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                imports.append({"name": a.asname or a.name, "source": a.name, "line": n.lineno})
        elif isinstance(n, ast.ImportFrom):
            prefix = "." * (n.level or 0)
            module = f"{prefix}{n.module}" if n.module else prefix
            for a in n.names:
                imports.append({"name": a.asname or a.name, "source": module, "line": n.lineno})

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
        msg = getattr(e, "msg", "Syntax error")
        return {"ok": False, "strength": "ast", "error": msg, "line": e.lineno, "column": (e.offset or 1)}
    except Exception:
        return {"ok": False, "strength": "ast", "error": "Internal syntax analysis failure"}
    node_count = sum(1 for _ in ast.walk(tree))
    if node_count > MAX_NODES:
        return {"ok": False, "strength": "ast", "error": "AST node count exceeds safety limit"}
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
    if hasattr(sys.stdin, "reconfigure"):
        try:
            sys.stdin.reconfigure(encoding="utf-8", errors="replace")
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
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

        def _set_cors_headers(self):
            origin = self.headers.get("Origin", "")
            if not origin:
                return
            allowed_env = os.environ.get("ALLOWED_ORIGINS", "")
            allowed_list = [o.strip() for o in allowed_env.split(",") if o.strip()]
            is_local = origin.startswith("http://localhost:") or origin.startswith("http://127.0.0.1:")
            is_allowed = is_local or (origin in allowed_list) or (not allowed_list and origin.endswith(".vercel.app"))
            if is_allowed:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")

        def do_OPTIONS(self):
            self.send_response(204)
            self._set_cors_headers()
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
            self.send_header("Access-Control-Max-Age", "86400")
            self.end_headers()

        def do_POST(self):
            ctype = self.headers.get("Content-Type", "")
            if not ctype.lower().startswith("application/json"):
                err_body = json.dumps({"ok": False, "error": "Unsupported Media Type: application/json required"}).encode("utf-8")
                self.send_response(415)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err_body)))
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(err_body)
                return

            try:
                length = int(self.headers.get("Content-Length", 0))
            except (TypeError, ValueError):
                length = 0

            if length <= 0:
                err_body = json.dumps({"ok": False, "error": "Empty request body"}).encode("utf-8")
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err_body)))
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(err_body)
                return

            if length > 4 * 1024 * 1024:
                err_body = json.dumps({"ok": False, "error": "Payload Too Large: maximum 4MB"}).encode("utf-8")
                self.send_response(413)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(err_body)))
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(err_body)
                return

            try:
                raw = self.rfile.read(length)
                req = json.loads(raw or b"{}")
                result = analyze(req)
                status = 200
            except json.JSONDecodeError:
                result = {"ok": False, "error": "Malformed JSON payload"}
                status = 400
            except Exception:
                result = {"ok": False, "error": "Internal processing error"}
                status = 500

            body = json.dumps(result, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            body = json.dumps({"status": "healthy", "service": "python-ast", "version": "23.1.0"}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):  # silence default stderr access logging
            pass

except ImportError:  # pragma: no cover
    handler = None


if __name__ == "__main__":
    main_cli()
