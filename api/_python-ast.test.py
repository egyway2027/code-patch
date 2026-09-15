import ast
from pathlib import Path
src = Path(__file__).with_name("python-ast.py").read_text()
compile(src, "python-ast.py", "exec")
ns = {"__name__":"python_ast_test"}
exec(compile(src, "python-ast.py", "exec"), ns)
ok = ns["analyze"]({"code":"import os\n\nasync def hello(name):\n    return name\n"})
assert ok["ok"] and ok["ast"]
bad = ns["analyze"]({"code":"def broken(:\n    pass\n"})
assert bad["ok"] is False and bad["line"] == 1
print("python AST service test: PASS")
