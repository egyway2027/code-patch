import assert from 'node:assert/strict';
import { applyProjectTransaction } from '../src/projectEngine.js';
const patch=(id,a,b)=>`<<<<<<< SEARCH [PATCH: ${id}]\n${a}\n=======\n${b}\n>>>>>>> REPLACE`;
const r=await applyProjectTransaction([
 {fileName:'a.js',content:'const a = 1;',patchText:patch('a','const a = 1;','const a = 2;')},
 {fileName:'b.js',content:'const b = 3;',patchText:patch('b','const b = 3;','const b = 4;')}
]);
assert.equal(r.committed,false); assert.equal(r.prepared,true); assert.equal(r.results.length,2); assert.match(r.results[0].code,/a = 2/);
const bad=await applyProjectTransaction([
 {fileName:'a.js',content:'const a = 1;',patchText:patch('a','const a = 1;','const a = 2;')},
 {fileName:'b.js',content:'const b = 3;',patchText:patch('b','WRONG','const b = 4;')}
]);
assert.equal(bad.committed,false); assert.equal(bad.rolledBack,true);
console.log('V12 project transaction tests: PASS');
