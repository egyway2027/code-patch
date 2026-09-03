/**
 * Crash-safe server-only filesystem transaction layer.
 *
 * Invariants:
 *  - prepare never mutates the workspace.
 *  - every write is guarded by an expected-current-content hash.
 *  - rollback never overwrites an external change.
 *  - a COMMITTING journal is recoverable after process death.
 *  - workspace paths are checked against real filesystem paths to prevent symlink escape.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../src/cryptoUtils.js';

const TRANSACTION_ID_RE=/^[a-f0-9]{64}$/i;
const LOCK_FILE='.workspace.lock';
const JOURNAL_VERSION=3;

function reject(message,extra={}){return {ok:false,prepared:false,committed:false,rolledBack:false,message,...extra};}

async function ensureDir(dir,mode=0o700){await fs.mkdir(dir,{recursive:true,mode});}

async function fsyncDirectory(dir){
  let h;
  try{h=await fs.open(dir,'r');await h.sync();return true;}
  catch{return false}
  finally{try{await h?.close()}catch{}}
}

async function fileHash(filePath){
  const text=await fs.readFile(filePath,'utf8');
  return {text,hash:await sha256(text)};
}

async function exists(filePath){try{await fs.lstat(filePath);return true}catch{return false}}

async function realWorkspace(root){return fs.realpath(path.resolve(root));}

export async function assertSafePath(filePath,root){
  const workspace=await realWorkspace(root);
  const resolved=path.resolve(workspace,String(filePath||''));
  const rel=path.relative(workspace,resolved);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel)) throw new Error(`Path escapes workspace root: ${filePath}`);
  const reservedJournal=path.resolve(workspace,'.code-patcher-transactions');
  const reservedRel=path.relative(reservedJournal,resolved);
  if(!reservedRel || (!reservedRel.startsWith('..') && !path.isAbsolute(reservedRel))) throw new Error(`Refusing to modify transaction journal path: ${filePath}`);
  if(path.normalize(resolved)===path.normalize(path.join(workspace,LOCK_FILE))) throw new Error(`Refusing to modify transaction lock: ${filePath}`);

  const targetStat = await fs.lstat(resolved).catch(()=>null);
  if(targetStat?.isSymbolicLink()) throw new Error(`Refusing to write through symbolic link: ${filePath}`);
  // Resolve the parent so a symlink anywhere in the directory chain cannot escape.
  const parent=path.dirname(resolved);
  const parentExists=await exists(parent);
  const parentReal=await fs.realpath(parentExists?parent:workspace);
  const parentRel=path.relative(workspace,parentReal);
  if(parentRel.startsWith('..')||path.isAbsolute(parentRel)) throw new Error(`Path escapes workspace through symlink: ${filePath}`);
  return resolved;
}

async function statMetadata(filePath){
  const st=await fs.stat(filePath);
  return {mode:st.mode & 0o7777,uid:typeof st.uid==='number'?st.uid:null,gid:typeof st.gid==='number'?st.gid:null};
}

async function writeAtomic(filePath,content,{expectedCurrentHash=null,metadata=null}={}){
  const dir=path.dirname(filePath);
  await ensureDir(dir,0o700);
  if(expectedCurrentHash!==null){
    const current=await fileHash(filePath);
    if(current.hash!==expectedCurrentHash) throw new Error(`Pre-write integrity check failed for ${path.basename(filePath)}.`);
  }
  const tmp=path.join(dir,`.${path.basename(filePath)}.code-patcher-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  let fh;
  try{
    await fs.writeFile(tmp,content,{encoding:'utf8',mode:metadata?.mode ?? 0o600});
    if(metadata?.mode!==undefined) await fs.chmod(tmp,metadata.mode & 0o7777).catch(()=>{});
    fh=await fs.open(tmp,'r+');
    await fh.sync();
    await fh.close(); fh=null;
    await fs.rename(tmp,filePath);
    await fsyncDirectory(dir);
  }finally{
    try{await fh?.close()}catch{}
    try{await fs.rm(tmp,{force:true})}catch{}
  }
}

function journalPaths(journalDir,transactionId){
  return {dir:journalDir,file:path.join(journalDir,`${transactionId}.json`),snapshotDir:path.join(journalDir,transactionId)};
}

async function writeDurableText(filePath,text,mode=0o600){
  const dir=path.dirname(filePath);await ensureDir(dir,0o700);
  const tmp=`${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let h;
  try{
    await fs.writeFile(tmp,text,{encoding:'utf8',mode});
    h=await fs.open(tmp,'r+');await h.sync();await h.close();h=null;
    await fs.rename(tmp,filePath);await fsyncDirectory(dir);
  }finally{try{await h?.close()}catch{}try{await fs.rm(tmp,{force:true})}catch{}}
}

async function writeJournal(journalDir,record){
  await ensureDir(journalDir,0o700);
  const {file}=journalPaths(journalDir,record.transactionId);
  await writeDurableText(file,JSON.stringify({...record,journalVersion:JOURNAL_VERSION},null,2),0o600);
  return file;
}

async function readJournal(journalDir,id){try{return JSON.parse(await fs.readFile(journalPaths(journalDir,id).file,'utf8'))}catch{return null}}
async function deleteJournal(journalDir,id){try{await fs.rm(journalPaths(journalDir,id).file,{force:true});await fs.rm(journalPaths(journalDir,id).snapshotDir,{recursive:true,force:true});await fsyncDirectory(journalDir)}catch{}}

async function saveSnapshot(journalDir,transactionId,index,content,metadata){
  const {snapshotDir}=journalPaths(journalDir,transactionId);await ensureDir(snapshotDir,0o700);
  const contentPath=path.join(snapshotDir,`${String(index).padStart(6,'0')}.before`);
  const metaPath=path.join(snapshotDir,`${String(index).padStart(6,'0')}.meta.json`);
  await writeDurableText(contentPath,content,0o600);
  await writeDurableText(metaPath,JSON.stringify(metadata),0o600);
  return {contentPath,metaPath};
}

async function loadSnapshot(journalDir,record,f,index){
  if(f.originalContent!==undefined && f.originalContent!==null) return {content:f.originalContent,metadata:f.metadata||null};
  const {snapshotDir}=journalPaths(journalDir,record.transactionId);
  const content=await fs.readFile(path.join(snapshotDir,`${String(index).padStart(6,'0')}.before`),'utf8');
  let metadata=null;try{metadata=JSON.parse(await fs.readFile(path.join(snapshotDir,`${String(index).padStart(6,'0')}.meta.json`),'utf8'))}catch{}
  return {content,metadata};
}

async function acquireLock(journalDir,transactionId){
  await ensureDir(journalDir,0o700);
  const lock=path.join(journalDir,LOCK_FILE);
  try{
    const fh=await fs.open(lock,'wx',0o600);
    await fh.writeFile(JSON.stringify({transactionId,pid:process.pid,createdAt:new Date().toISOString()}));await fh.sync();
    return {fh,lock};
  }catch(e){
    if(e?.code!=='EEXIST')throw e;
    try{
      const meta=JSON.parse(await fs.readFile(lock,'utf8'));
      let alive=false;if(Number.isInteger(meta?.pid)&&meta.pid>0){try{process.kill(meta.pid,0);alive=true}catch{}}
      if(!alive){await fs.rm(lock,{force:true});const fh=await fs.open(lock,'wx',0o600);await fh.writeFile(JSON.stringify({transactionId,pid:process.pid,createdAt:new Date().toISOString(),reclaimed:true}));await fh.sync();return {fh,lock};}
    }catch{}
    throw new Error('Another transaction is currently committing this workspace.');
  }
}
async function releaseLock(lockObj){try{await lockObj?.fh?.close()}catch{}try{await fs.rm(lockObj?.lock,{force:true})}catch{} }

function committedIndexes(record){
  return (record?.results||[]).map((f,i)=>({f,i})).filter(({f})=>f.status==='COMMITTED_FILE' || f.status==='COMMITTED').reverse();
}

async function safeRestore(journalDir,record,item,workspaceRoot){
  const {f,i}=item;
  const target=await assertSafePath(f.filePath||f.target,workspaceRoot);
  const current=await fileHash(target);
  const expectedPost=f.resultHash || record.postCommitHashes?.[f.fileName] || null;
  if(expectedPost && current.hash!==expectedPost){
    return {ok:false,fileName:f.fileName,reason:'external-mutation-after-commit',currentHash:current.hash,expectedPostHash:expectedPost};
  }
  const snap=await loadSnapshot(journalDir,record,f,i);
  await writeAtomic(target,snap.content,{expectedCurrentHash:current.hash,metadata:snap.metadata});
  const after=await fileHash(target);
  const ok=after.hash===f.originalHash;
  return {ok,fileName:f.fileName,originalHash:f.originalHash,restoredHash:after.hash};
}


export async function persistTransactionRecord(journalDir,record){
  await writeJournal(journalDir,record);
  return record;
}
export async function recoverTransactions({workspaceRoot=process.cwd(),journalDir=path.join(workspaceRoot,'.code-patcher-transactions')}={}){
  await ensureDir(journalDir,0o700);const names=await fs.readdir(journalDir).catch(()=>[]),recovered=[],needsReview=[];
  for(const name of names){
    if(!name.endsWith('.json'))continue;
    const id=name.slice(0,-5);if(!TRANSACTION_ID_RE.test(id))continue;
    const record=await readJournal(journalDir,id);if(!record||!['COMMITTING','RECOVERY_REQUIRED'].includes(record.status))continue;
    const lock=await acquireLock(journalDir,id).catch(()=>null);if(!lock)continue;
    try{
      // Reconcile actual filesystem state first: committed result, original state, or unknown.
      const states=[];
      for(let i=0;i<(record.results||[]).length;i++){
        const f=record.results[i];const target=await assertSafePath(f.filePath||f.target,workspaceRoot);
        try{const {hash}=await fileHash(target);states.push({i,f,hash})}catch(e){states.push({i,f,error:String(e?.message||e)})}
      }
      const allResult=states.length>0&&states.every(x=>x.hash===x.f.resultHash);
      const allOriginal=states.length>0&&states.every(x=>x.hash===x.f.originalHash);
      if(allResult){record.status='COMMITTED';record.committed=true;record.rolledBack=false;record.recoveredAt=new Date().toISOString();record.recoveryAction='marked-committed';await writeJournal(journalDir,record);recovered.push(id);continue;}
      if(allOriginal){record.status='ROLLED_BACK';record.committed=false;record.rolledBack=true;record.recoveredAt=new Date().toISOString();record.recoveryAction='already-original';await writeJournal(journalDir,record);recovered.push(id);continue;}
      const committed=states.filter(x=>x.hash===x.f.resultHash).map(x=>({f:x.f,i:x.i})).reverse();
      let safe=true,restored=[];
      for(const item of committed){const r=await safeRestore(journalDir,record,item,workspaceRoot);if(!r.ok){safe=false;break}restored.push(r.fileName)}
      if(safe){record.status='ROLLED_BACK';record.committed=false;record.rolledBack=true;record.recoveredAt=new Date().toISOString();record.recoveryAction='rolled-back-committed-files-only';record.restored=restored;await writeJournal(journalDir,record);recovered.push(id)}
      else {record.status='RECOVERY_REQUIRED';record.recoveryRequired=true;record.recoveredAt=new Date().toISOString();record.recoveryAction='manual-review-required';await writeJournal(journalDir,record);needsReview.push(id)}
    }catch(error){record.status='RECOVERY_REQUIRED';record.recoveryRequired=true;record.recoveryError=String(error?.message||error);await writeJournal(journalDir,record).catch(()=>{});needsReview.push(id)}
    finally{await releaseLock(lock)}
  }
  return {ok:true,recovered,needsReview};
}

export async function commitPreparedTransaction(prepared,{workspaceRoot=process.cwd(),journalDir=path.join(workspaceRoot,'.code-patcher-transactions'),rejectExternalMutation=true,allowReadOnlyTarget=false}={}){
  if(!prepared?.ok||!prepared.prepared||!prepared.transactionId)return reject('Invalid or unprepared transaction.');
  if(!TRANSACTION_ID_RE.test(prepared.transactionId))return reject('Invalid transaction id.');
  const existing=await readJournal(journalDir,prepared.transactionId);
  if(existing?.status==='COMMITTED')return {...existing,ok:true,prepared:true,committed:true,rolledBack:false,message:'Transaction already committed (idempotent replay).'};
  if(existing?.status==='RECOVERY_REQUIRED')return reject('Transaction requires manual recovery and cannot be replayed.',{transactionId:prepared.transactionId,status:'RECOVERY_REQUIRED'});
  if(prepared.planHash&&prepared.planSnapshot){const actual=await sha256(JSON.stringify(prepared.planSnapshot));if(actual!==prepared.planHash)return reject('Immutable patch plan integrity check failed.',{transactionId:prepared.transactionId,reason:'plan-hash-mismatch'});}

  const lock=await acquireLock(journalDir,prepared.transactionId).catch(e=>({error:e}));if(lock?.error)return reject(lock.error.message,{transactionId:prepared.transactionId});
  const snapshots=[];
  try{
    const already=await readJournal(journalDir,prepared.transactionId);if(already?.status==='COMMITTED')return {...already,ok:true,prepared:true,committed:true,rolledBack:false,message:'Transaction already committed (idempotent replay).'};
    if(!Array.isArray(prepared.results)||prepared.results.length===0)throw new Error('Transaction contains no files.');

    // Full preflight + durable snapshots + metadata.
    const seenTargets=new Set();
    for(let i=0;i<prepared.results.length;i++){
      const f=prepared.results[i];if(!f.filePath)throw new Error(`No filePath supplied for ${f.fileName}.`);
      const target=await assertSafePath(f.filePath,workspaceRoot);
      const targetKey=path.normalize(target);if(seenTargets.has(targetKey))throw new Error(`Duplicate resolved target in transaction: ${f.fileName}.`);seenTargets.add(targetKey);
      const st=await fs.stat(target);
      if(!allowReadOnlyTarget && (st.mode & 0o222)===0) throw new Error(`Refusing to overwrite read-only target: ${f.fileName}.`);
      const current=await fileHash(target);
      if(prepared.planSnapshot?.[i]){
        const planItem=prepared.planSnapshot[i];
        if(planItem.fileName && planItem.fileName!==f.fileName) throw new Error(`Prepared plan/file mismatch for ${f.fileName}.`);
        if(planItem.originalHash!==f.originalHash || planItem.resultHash!==f.resultHash) throw new Error(`Prepared result hash binding mismatch for ${f.fileName}.`);
      }
      if(f.originalContent!==undefined && f.originalContent!==null && await sha256(String(f.originalContent))!==f.originalHash) throw new Error(`Original content hash binding failed for ${f.fileName}.`);
      if(await sha256(String(f.code??''))!==f.resultHash) throw new Error(`Result content hash binding failed for ${f.fileName}.`);
      if(rejectExternalMutation&&current.hash!==f.originalHash)throw new Error(`External mutation detected for ${f.fileName}.`);
      const metadata=await statMetadata(target).catch(()=>({mode:st.mode & 0o7777,uid:null,gid:null}));
      const snap=await saveSnapshot(journalDir,prepared.transactionId,i,current.text,{...metadata,originalHash:f.originalHash,fileName:f.fileName});
      snapshots.push({fileName:f.fileName,target,current,currentHash:current.hash,originalHash:f.originalHash,expected:f.resultHash,code:f.code,metadata,snapshot:snap});
    }

    const journal={...prepared,status:'PREPARED',journalVersion:JOURNAL_VERSION,workspaceRoot:await realWorkspace(workspaceRoot),journalDir:path.resolve(journalDir),createdAt:new Date().toISOString(),results:prepared.results.map((f,i)=>({...f,target:snapshots[i]?.target,status:'PENDING',originalContent:undefined,snapshot:snapshots[i]?.snapshot,metadata:snapshots[i]?.metadata}))};
    await writeJournal(journalDir,journal);
    journal.status='COMMITTING';journal.committingAt=new Date().toISOString();await writeJournal(journalDir,journal);

    for(let i=0;i<snapshots.length;i++){
      const s=snapshots[i];
      const now=await fileHash(s.target);
      if(rejectExternalMutation&&now.hash!==s.originalHash)throw new Error(`External mutation detected immediately before writing ${s.fileName}.`);
      await writeAtomic(s.target,s.code,{expectedCurrentHash:s.originalHash,metadata:s.metadata});
      const after=await fileHash(s.target);if(after.hash!==s.expected)throw new Error(`Post-commit integrity verification failed for ${s.fileName}.`);
      journal.results[i].status='COMMITTED_FILE';journal.results[i].currentHash=after.hash;await writeJournal(journalDir,journal);
    }
    journal.postCommitHashes=Object.fromEntries(snapshots.map(s=>[s.fileName,s.expected]));journal.status='COMMITTED';journal.committed=true;journal.rolledBack=false;journal.committedAt=new Date().toISOString();await writeJournal(journalDir,journal);
    return {...prepared,prepared:true,committed:true,rolledBack:false,status:'COMMITTED',results:journal.results,postCommitHashes:journal.postCommitHashes,commit:{transactionId:prepared.transactionId,workspaceRoot:await realWorkspace(workspaceRoot),files:snapshots.map(s=>s.fileName),committedAt:journal.committedAt},message:'Filesystem transaction committed and verified.'};
  }catch(error){
    let rollbackOk=true,restored=[];
    // Only restore files whose journal status confirms they were committed, plus an in-flight
    // file if its current hash equals its expected post hash. Never overwrite an external value.
    const journalNow=await readJournal(journalDir,prepared.transactionId);
    const candidates=(journalNow?.results||[]).map((f,i)=>({f,i})).filter(({f})=>f.status==='COMMITTED_FILE');
    if(journalNow){
      for(const item of candidates.reverse()){
        try{const r=await safeRestore(journalDir,journalNow,item,workspaceRoot);if(!r.ok){rollbackOk=false;break}restored.push(r.fileName)}catch{rollbackOk=false;break}
      }
      if(rollbackOk&&candidates.length===0){
        // A crash/failure before the first durable COMMITTED_FILE status leaves everything original.
        // Verify; do not rewrite anything.
        for(const s of snapshots){try{const {hash}=await fileHash(s.target);if(hash!==s.originalHash){rollbackOk=false;break}}catch{rollbackOk=false;break}}
      }
    }else rollbackOk=false;
    const status=rollbackOk?'ROLLED_BACK':'RECOVERY_REQUIRED';
    const failure={...prepared,ok:false,prepared:true,committed:false,rolledBack:rollbackOk,status,transactionId:prepared.transactionId,error:String(error?.message||error),rollbackVerified:rollbackOk,restored,recoveryRequired:!rollbackOk,failedAt:new Date().toISOString()};
    await writeJournal(journalDir,failure).catch(()=>{});
    return reject(rollbackOk?'Filesystem commit failed; verified rollback completed.':'Filesystem commit failed and automatic rollback is unsafe; manual recovery required.',failure);
  }finally{await releaseLock(lock)}
}

export async function rollbackCommittedTransaction(record,{workspaceRoot=process.cwd(),journalDir=path.join(workspaceRoot,'.code-patcher-transactions')}={}){
  if(!record?.transactionId||!Array.isArray(record.results))return reject('Invalid transaction record.');
  if(!TRANSACTION_ID_RE.test(record.transactionId))return reject('Invalid transaction id.');
  const lock=await acquireLock(journalDir,record.transactionId).catch(e=>({error:e}));if(lock?.error)return reject(lock.error.message,{transactionId:record.transactionId});
  try{
    const targets=committedIndexes(record);
    if(!targets.length)return reject('Transaction contains no committed files to roll back.',{transactionId:record.transactionId,status:record.status});
    // Preflight all current hashes before touching anything.
    for(const item of targets){const f=item.f,target=await assertSafePath(f.filePath||f.target,workspaceRoot),{hash}=await fileHash(target);const expected=f.resultHash||record.postCommitHashes?.[f.fileName];if(expected&&hash!==expected)throw new Error(`Rollback refused: ${f.fileName} was externally modified after commit.`)}
    const restored=[];
    for(const item of targets){const r=await safeRestore(journalDir,record,item,workspaceRoot);if(!r.ok)throw new Error(`Rollback refused for ${r.fileName}.`);restored.push(r.fileName)}
    const out={ok:true,prepared:false,committed:false,rolledBack:true,status:'ROLLED_BACK',transactionId:record.transactionId,restored};
    await writeJournal(journalDir,{...record,...out,rolledBackAt:new Date().toISOString()});
    return out;
  }catch(error){return reject('Rollback refused; no unsafe overwrite was performed.',{transactionId:record.transactionId,status:'RECOVERY_REQUIRED',recoveryRequired:true,error:String(error?.message||error)})}
  finally{await releaseLock(lock)}
}
