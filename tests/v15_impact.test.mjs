import assert from 'node:assert/strict';
import { analyzeCrossFileImpact } from '../src/impactAnalysis.js';

const before=[
 {fileName:'b.js',content:`export function login(user) { return user; }`},
 {fileName:'a.js',content:`import { login } from './b.js';\nexport function run(x){ return login(x); }`}
];
const after=[
 {fileName:'b.js',content:`export function authenticate(user, token) { return user; }`},
 {fileName:'a.js',content:`import { login } from './b.js';\nexport function run(x){ return login(x); }`}
];
const r=analyzeCrossFileImpact(before,after);
assert.equal(r.ok,false);
assert.equal(r.breaking.length,1);
assert.equal(r.breaking[0].symbol,'login');
assert.equal(r.breaking[0].consumer,'a.js');

const safe=analyzeCrossFileImpact(before,[
 {fileName:'b.js',content:`export function login(user) { return user.trim(); }`},
 {fileName:'a.js',content:`import { login } from './b.js';\nexport function run(x){ return login(x); }`}
]);
assert.equal(safe.ok,true);

console.log('V21 cross-file impact tests: PASS');
