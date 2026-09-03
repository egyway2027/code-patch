import assert from 'node:assert/strict';
import { parseExtraLanguage } from '../src/languageParsers.js';

// Java/Go need a local javac/go toolchain. When missing, parseExtraLanguage
// reports { unavailable:true } (see src/languageParsers.js) rather than a
// code defect, so that case is skipped instead of failing the whole suite.
const java=JSON.stringify(parseExtraLanguage('public class User { public void run(String x) {} }','User.java'));
const j=JSON.parse(java);
if (j.unavailable) {
  console.log(`Java: SKIPPED (${j.message})`);
} else {
  assert.equal(j.ok,true);
  assert.equal(j.snapshot.entities.some(e=>e.kind==='class'&&e.name==='User'),true);
  assert.equal(j.snapshot.entities.some(e=>e.kind==='method'&&e.name==='run'),true);
  assert.equal(j.snapshot.entities.find(e=>e.name==='run').location.column>=0,true);

  const bad=JSON.parse(JSON.stringify(parseExtraLanguage('public class Broken { void f() {','Broken.java')));
  assert.equal(bad.ok,false);
}

const cpp=parseExtraLanguage('class Engine { public: void run(int x) {} };','engine.cpp');
assert.equal(cpp.ok,true);
if (cpp.strength === 'real-ast') {
  assert.equal(cpp.snapshot.entities.some(e=>e.kind==='function'&&e.name==='run'),true);
} else {
  console.log(`C++: syntax-only mode (${cpp.message}) — entity assertion skipped`);
}

const go=parseExtraLanguage('package main\nfunc Run(x int) {}','main.go');
if (go.unavailable) {
  console.log(`Go: SKIPPED (${go.message})`);
} else {
  assert.equal(go.ok,true);
  assert.equal(go.snapshot.entities.some(e=>e.kind==='function'&&e.name==='Run'),true);
}

console.log('V21 language adapter tests: PASS');
