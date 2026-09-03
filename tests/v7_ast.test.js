import test from "node:test";
import assert from "node:assert/strict";
import { parseCode, semanticDiff } from "../src/astEngine.js";

test("Core JS AST parses modules", async () => {
  const r = await parseCode('import x from "x"; export function f(a){ return a; }', "a.js");
  if (!r.ok && r.error?.includes("not installed")) return;
  assert.equal(r.ok, true);
  assert.equal(r.snapshot.entities.some(e => e.kind === "function" && e.name === "f"), true);
});

test("Core TypeScript AST parses TS", async () => {
  const r = await parseCode('interface User { id: number } export const x: User = {id: 1};', "a.ts");
  if (!r.ok && r.error?.includes("not installed")) return;
  assert.equal(r.ok, true);
});

test("Core Python AST parses Python without execution", async () => {
  const r = await parseCode('import os\nclass A:\n    def run(self, x):\n        return x\n', "a.py");
  assert.equal(r.ok, true);
  assert.equal(r.language, "python");
  assert.equal(r.snapshot.entities.some(e => e.kind === "class" && e.name === "A"), true);
  assert.equal(r.snapshot.entities.some(e => e.kind === "function" && e.name === "run"), true);
});

test("Core Python syntax errors fail closed", async () => {
  const r = await parseCode('def broken(:\n  pass', "bad.py");
  assert.equal(r.ok, false);
});

test("Core semantic diff detects Python function signature changes", async () => {
  const a = await parseCode('def f(x):\n return x\n', "a.py");
  const b = await parseCode('def f(x, y):\n return x\n', "a.py");
  assert.equal(a.ok && b.ok, true);
  const d = semanticDiff(a,b);
  assert.equal(d.issues.some(x => x.type === "signature-changed"), true);
});
