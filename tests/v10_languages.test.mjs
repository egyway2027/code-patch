import assert from 'node:assert/strict';
import { parseCodeV10, languageForFileV10 } from '../src/astEngine.js';

assert.equal(languageForFileV10('User.java'), 'java');
assert.equal(languageForFileV10('main.cpp'), 'cpp');
assert.equal(languageForFileV10('main.go'), 'go');
assert.equal(languageForFileV10('main.c'), 'c');

// Java/Go need a local javac/go toolchain; when missing the parser reports
// { unavailable:true } (see src/languageParsers.js) rather than a code error,
// so we skip gracefully instead of failing the whole suite in a bare sandbox.
let r = await parseCodeV10('public class User { public void run(String x) {} }', 'User.java');
if (r.unavailable) {
  console.log(`Java: SKIPPED (${r.message})`);
} else {
  assert.equal(r.ok, true);
  assert.match(r.parser, /^javac(?:-tree-api)?$/);
  assert.equal(r.snapshot.entities.some(e => e.kind === 'class' && e.name === 'User'), true);
}

r = await parseCodeV10('#include <vector>\nint main(){ std::vector<int> x{1}; }', 'main.cpp');
assert.equal(r.ok, true);
// Full AST snapshot requires Clang; a GCC-only environment can still validate syntax
// (see src/languageParsers.js clangAst — GCC does not support Clang's -Xclang AST-dump flags).
assert.match(r.parser, /^(clang\+\+-ast-json|g\+\+)$/);

r = await parseCodeV10('package main\nfunc main() {}', 'main.go');
if (r.unavailable) {
  console.log(`Go: SKIPPED (${r.message})`);
} else {
  assert.equal(r.ok, true);
  assert.equal(r.parser, 'go/parser');

  r = await parseCodeV10('package main\nfunc main( {}', 'main.go');
  assert.equal(r.ok, false);
}

console.log('V10 compatibility language tests: PASS');
