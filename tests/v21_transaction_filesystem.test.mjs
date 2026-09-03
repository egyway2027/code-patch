import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/cryptoUtils.js';
import { commitPreparedTransaction, rollbackCommittedTransaction } from '../server/transactionFilesystem.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'code-patcher-v21-'));
try{
 const original='export function a(){ return 1; }', next='export function a(){ return 2; }', file=path.join(root,'a.js');
 await fs.writeFile(file,original,'utf8');
 const prepared={ok:true,prepared:true,committed:false,transactionId:await sha256('v21-fs-test'),results:[{fileName:'a.js',filePath:'a.js',originalContent:original,code:next,originalHash:await sha256(original),resultHash:await sha256(next)}]};
 const committed=await commitPreparedTransaction(prepared,{workspaceRoot:root}); assert.equal(committed.ok,true); assert.equal(committed.committed,true); assert.equal(await fs.readFile(file,'utf8'),next);
 const rolled=await rollbackCommittedTransaction(committed,{workspaceRoot:root}); assert.equal(rolled.ok,true); assert.equal(await fs.readFile(file,'utf8'),original);
 // External mutation is rejected before any write.
 await fs.writeFile(file,'externally changed','utf8');
 const rejected=await commitPreparedTransaction(prepared,{workspaceRoot:root}); assert.equal(rejected.ok,false); assert.equal(rejected.rolledBack,false); assert.match(rejected.message,/commit failed/i); assert.equal(await fs.readFile(file,'utf8'),'externally changed');
 console.log('V21 filesystem transaction tests: PASS');
}finally{await fs.rm(root,{recursive:true,force:true})}
