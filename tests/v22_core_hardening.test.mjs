import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/cryptoUtils.js';
import { commitPreparedTransaction, rollbackCommittedTransaction, recoverTransactions, assertSafePath } from '../server/transactionFilesystem.mjs';

const root=await fs.mkdtemp(path.join(os.tmpdir(),'code-patcher-v22-'));
const journal=path.join(root,'.tx');
try{
  const a=path.join(root,'a.js'), b=path.join(root,'b.js');
  const oldA='A1', newA='A2', oldB='B1', newB='B2';
  await fs.writeFile(a,oldA); await fs.writeFile(b,oldB);
  const prepared={ok:true,prepared:true,committed:false,transactionId:await sha256('v23-idempotent'),planSnapshot:{schemaVersion:1,files:['a.js','b.js']},planHash:await sha256(JSON.stringify({schemaVersion:1,files:['a.js','b.js']})),results:[
    {fileName:'a.js',filePath:'a.js',originalContent:oldA,code:newA,originalHash:await sha256(oldA),resultHash:await sha256(newA)},
    {fileName:'b.js',filePath:'b.js',originalContent:oldB,code:newB,originalHash:await sha256(oldB),resultHash:await sha256(newB)}
  ]};
  const tampered={...prepared,planSnapshot:{schemaVersion:999,files:['tampered']}};
  const tamperRejected=await commitPreparedTransaction(tampered,{workspaceRoot:root,journalDir:journal});
  assert.equal(tamperRejected.ok,false); assert.equal(tamperRejected.reason,'plan-hash-mismatch');
  const first=await commitPreparedTransaction(prepared,{workspaceRoot:root,journalDir:journal});
  assert.equal(first.ok,true); assert.equal(first.committed,true); assert.equal((await fs.readFile(a,'utf8')),newA); assert.equal((await fs.readFile(b,'utf8')),newB);
  const second=await commitPreparedTransaction(first,{workspaceRoot:root,journalDir:journal});
  assert.equal(second.ok,true); assert.equal(second.committed,true);
  await fs.writeFile(a,'post-commit external mutation');
  const refusedRollback=await rollbackCommittedTransaction(first,{workspaceRoot:root,journalDir:journal});
  assert.equal(refusedRollback.ok,false); assert.equal(await fs.readFile(a,'utf8'),'post-commit external mutation'); assert.equal(await fs.readFile(b,'utf8'),newB);
  await fs.writeFile(a,newA);
  const rolled=await rollbackCommittedTransaction(first,{workspaceRoot:root,journalDir:journal});
  assert.equal(rolled.ok,true); assert.equal(await fs.readFile(a,'utf8'),oldA); assert.equal(await fs.readFile(b,'utf8'),oldB);

  await assert.rejects(()=>assertSafePath('../escape.js',root),/escapes workspace root/);
  // Symlink targets are refused, even when their lexical path is inside the workspace.
  const outside=path.join(path.dirname(root),'code-patcher-outside-'+Date.now()+'.txt');
  await fs.writeFile(outside,'outside','utf8');
  const link=path.join(root,'link.txt');
  await fs.symlink(outside,link);
  await assert.rejects(()=>assertSafePath('link.txt',root),/symbolic link/);
  await fs.rm(link,{force:true}); await fs.rm(outside,{force:true});

  // Read-only files are fail-closed by default.
  const ro=path.join(root,'readonly.js'); await fs.writeFile(ro,'RO','utf8'); await fs.chmod(ro,0o444);
  const roPrepared={ok:true,prepared:true,committed:false,transactionId:await sha256('readonly'),results:[{fileName:'readonly.js',filePath:'readonly.js',originalContent:'RO',code:'RO2',originalHash:await sha256('RO'),resultHash:await sha256('RO2')}]};
  const roRejected=await commitPreparedTransaction(roPrepared,{workspaceRoot:root,journalDir:journal});
  assert.equal(roRejected.ok,false); assert.equal(await fs.readFile(ro,'utf8'),'RO'); await fs.chmod(ro,0o644);

  // A prepared result whose code was changed without changing its plan is rejected.
  const bindPrepared={ok:true,prepared:true,committed:false,transactionId:await sha256('binding'),planSnapshot:[{fileName:'a.js',originalHash:await sha256(oldA),resultHash:await sha256(newA)}],planHash:await sha256(JSON.stringify([{fileName:'a.js',originalHash:await sha256(oldA),resultHash:await sha256(newA)}])),results:[{fileName:'a.js',filePath:'a.js',originalContent:oldA,code:'EVIL',originalHash:await sha256(oldA),resultHash:await sha256('EVIL')}]};
  const bindRejected=await commitPreparedTransaction(bindPrepared,{workspaceRoot:root,journalDir:journal});
  assert.equal(bindRejected.ok,false); assert.match(bindRejected.error,/hash binding|plan integrity/i); assert.equal(await fs.readFile(a,'utf8'),oldA);


  // Crash recovery: emulate a process dying after the first file was replaced.
  await fs.writeFile(a,newA); await fs.writeFile(b,oldB);
  const tx2=await sha256('v22-recovery');
  await fs.mkdir(journal,{recursive:true});
  const record={status:'COMMITTING',transactionId:tx2,journalVersion:2,results:[
    {fileName:'a.js',filePath:'a.js',originalContent:oldA,originalHash:await sha256(oldA),code:newA,resultHash:await sha256(newA)},
    {fileName:'b.js',filePath:'b.js',originalContent:oldB,originalHash:await sha256(oldB),code:newB,resultHash:await sha256(newB)}
  ]};
  await fs.writeFile(path.join(journal,`${tx2}.json`),JSON.stringify(record));
  const recovery=await recoverTransactions({workspaceRoot:root,journalDir:journal});
  assert.ok(recovery.recovered.includes(tx2));
  assert.equal(await fs.readFile(a,'utf8'),oldA); assert.equal(await fs.readFile(b,'utf8'),oldB);

  // Idempotency survives a fresh process because the durable journal is authoritative.
  const stored=JSON.parse(await fs.readFile(path.join(journal,`${prepared.transactionId}.json`),'utf8'));
  assert.equal(stored.status,'ROLLED_BACK');
  console.log('V23 core hardening tests: PASS');
}finally{await fs.rm(root,{recursive:true,force:true})}
