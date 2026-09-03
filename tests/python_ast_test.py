import subprocess, json, sys, os
p=os.path.join(os.path.dirname(__file__),"..","api","python-ast.py")
r=subprocess.run([sys.executable,p],input=json.dumps({"code":"def f(x):\n return x","file_name":"x.py"}),text=True,capture_output=True)
assert json.loads(r.stdout)["ok"] is True
r=subprocess.run([sys.executable,p],input=json.dumps({"code":"def f(:\n pass","file_name":"x.py"}),text=True,capture_output=True)
assert json.loads(r.stdout)["ok"] is False
print("python AST tests: PASS")
