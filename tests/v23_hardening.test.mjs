import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePolicy, DEFAULT_POLICY } from '../src/policyEngine.js';
import { recoverTransactions, assertSafePath } from '../server/transactionFilesystem.mjs';
import { fetchPythonAst, validatePython } from '../src/patchEngine.js';

const polluted=normalizePolicy(JSON.parse('{"security":{"__proto__":{"critical":"block"}},"transaction":{"maxFiles":1}}'));
assert.equal(polluted.transaction.maxFiles,1);
assert.equal(Object.prototype.critical,undefined);
assert.equal(DEFAULT_POLICY.transaction.maxFiles,500);

const py=await fetchPythonAst('def ok(x):\n    return x + 1\n','test.py');
assert.equal(py.ok,true);
const bad=await validatePython('def broken(:\n    pass','broken.py');
assert.equal(bad.ok,false);

const root=await fs.mkdtemp(path.join(os.tmpdir(),'code-patcher-v23-'));
const journal=path.join(root,'.code-patcher-transactions');
await fs.mkdir(journal,{recursive:true});
await fs.writeFile(path.join(root,'a.js'),'x','utf8');
await assert.rejects(()=>assertSafePath('../escape.js',root));
await assert.rejects(()=>assertSafePath('.code-patcher-transactions/evil.json',root));
await assert.rejects(()=>assertSafePath('.workspace.lock',root));
await fs.rm(root,{recursive:true,force:true});
console.log('V23 hardening tests: PASS');
