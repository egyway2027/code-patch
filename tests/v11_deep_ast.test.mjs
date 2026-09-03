import assert from 'node:assert/strict';
import { parseCode, semanticDiff } from '../src/astEngine.js';

// Java/C++/Go real-AST parsing needs a local javac/clang/go toolchain. When one
// is missing, the parser reports { unavailable:true } (see src/languageParsers.js)
// rather than a code defect, so that case is skipped instead of failing the suite.
const cases = [
  ['Demo.java','class Demo { int add(int a,int b){ return a+b; } }'],
  ['demo.cpp','class Demo { public: int add(int a,int b){return a+b;} };'],
  ['demo.go','package main\nfunc Add(a int,b int) int { return a+b }'],
];
for (const [file,code] of cases) {
  const r=await parseCode(code,file);
  if (r.unavailable) { console.log(`${file}: SKIPPED (${r.message})`); continue; }
  assert.equal(r.ok,true,`${file}: ${r.error||r.message}`);
  if (r.strength !== 'real-ast') { console.log(`${file}: syntax-only mode (${r.message}) — entity assertion skipped`); continue; }
  assert.ok(r.snapshot?.entities?.length>0,`${file}: no AST entities`);
}

const before=await parseCode('package main\nfunc Add(a int) int { return a }','demo.go');
if (before.unavailable) {
  console.log(`Go semantic diff: SKIPPED (${before.message})`);
} else {
  const after=await parseCode('package main\nfunc Add(a int,b int) int { return a+b }\nfunc New() {}','demo.go');
  const d=semanticDiff(before,after);
  assert.equal(d.ok,true); assert.ok(d.issues.some(x=>x.type==='added'&&x.entity.name==='New')); assert.ok(d.issues.some(x=>x.type==='signature-changed'&&x.after.name==='Add'));
}
console.log('V11 deep AST tests: PASS');
