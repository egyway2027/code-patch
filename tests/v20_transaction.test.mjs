import assert from 'node:assert/strict';
import { prepareProjectTransaction } from '../src/transactionEngine.js';
const patchA=`<<<<<<< SEARCH [PATCH: api]\nexport function login(a,b) { return a+b; }\n=======\nexport function login(a) { return a; }\n>>>>>>> REPLACE`;
const files=[
 {fileName:'api.js',fileType:'javascript',content:'export function login(a,b) { return a+b; }',patchText:patchA},
 {fileName:'app.js',fileType:'javascript',content:`import { login } from './api.js';\nconst x = login(1,2);`,patchText:`<<<<<<< SEARCH [PATCH: noop]\nconst x = login(1,2);\n=======\nconst x = login(1,2);\n>>>>>>> REPLACE`},
];
const r=await prepareProjectTransaction(files,{mode:'exact-unique'});
assert.equal(r.ok,false);
assert.equal(r.rolledBack,true);
assert.ok(r.impact);
console.log('V21 transaction tests: PASS');
