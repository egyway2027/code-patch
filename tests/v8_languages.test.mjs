import test from 'node:test'; import assert from 'node:assert/strict';
import {parseCodeV8} from '../src/astEngine.js';

// Java/Go require a local javac/go toolchain. When it isn't installed, the
// parser returns { ok:false, unavailable:true, message:'<tool> unavailable' }
// (see src/languageParsers.js javaAst/goAst) — that's an environment gap, not
// a code defect, so we skip rather than fail. When the toolchain IS present
// the assertions still run at full strength.
test('Java',async()=>{
  let r=await parseCodeV8('import java.util.List; public class User { public void run(String x) {} }','User.java');
  if (r.unavailable) { console.log(`Java: SKIPPED (${r.message})`); return; }
  assert.equal(r.ok,true);
  assert.equal(r.snapshot.entities.some(e=>e.kind==='class'&&e.name==='User'),true);
  assert.equal(r.snapshot.entities.some(e=>e.kind==='method'&&e.name==='run'),true);
});
test('C++',async()=>{
  let r=await parseCodeV8('#include <iostream>\nclass Engine { public: void run(int x) {} };','engine.cpp');
  assert.equal(r.ok,true);
  // A full entity AST needs Clang. In a GCC-only environment (see clangAst in
  // src/languageParsers.js) the syntax gate still passes but entities/imports
  // are intentionally empty — the same real behavior tests/v10_languages.test.mjs
  // already accounts for. Only require entities when a real AST was produced.
  if (r.strength === 'real-ast') {
    assert.equal(r.snapshot.entities.some(e=>e.kind==='class'&&e.name==='Engine'),true);
    assert.equal(r.snapshot.entities.some(e=>e.kind==='function'&&e.name==='run'),true);
  } else {
    console.log(`C++: syntax-only mode (${r.message}) — entity assertions skipped`);
  }
});
test('Go',async()=>{
  let r=await parseCodeV8('package main\nimport "fmt"\ntype Engine struct{}\nfunc Run(x int) {}','main.go');
  if (r.unavailable) { console.log(`Go: SKIPPED (${r.message})`); return; }
  assert.equal(r.ok,true);
  assert.equal(r.snapshot.entities.some(e=>e.kind==='struct'&&e.name==='Engine'),true);
  assert.equal(r.snapshot.entities.some(e=>e.kind==='function'&&e.name==='Run'),true);
});
test('Malformed code fails closed',async()=>{let r=await parseCodeV8('class Broken { void f() {','Broken.java'); assert.equal(r.ok,false)});
