import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCode } from '../src/astEngine.js';
import { analyzeCrossFileImpact } from '../src/impactAnalysis.js';
import { prepareSingleFileTransaction, prepareProjectTransaction } from '../src/transactionEngine.js';
import { commitPreparedTransaction, rollbackCommittedTransaction, recoverTransactions, persistTransactionRecord } from './transactionFilesystem.mjs';
import { normalizePolicy } from '../src/policyEngine.js';
import { VERSION, LIMITS } from '../src/patchEngine.js';

const HOST=process.env.HOST||'127.0.0.1';
const PORT=Number(process.env.PORT||8787);
const MAX_BODY=Number(process.env.MAX_BODY_BYTES||12*1024*1024);
const WORKSPACE_ROOT=path.resolve(process.env.WORKSPACE_ROOT||process.cwd());
const JOURNAL_DIR=path.resolve(process.env.TRANSACTION_JOURNAL_DIR||path.join(WORKSPACE_ROOT,'.code-patcher-transactions'));
const AUTH_TOKEN=String(process.env.CODE_PATCHER_AUTH_TOKEN||'');
const ALLOWED_ORIGINS=new Set(String(process.env.CORS_ORIGIN||'http://127.0.0.1:5173,http://localhost:5173').split(',').map(x=>x.trim()).filter(Boolean));
const isLoopbackHost = ['127.0.0.1','localhost','::1'].includes(HOST);
if (!isLoopbackHost && !AUTH_TOKEN) throw new Error('CODE_PATCHER_AUTH_TOKEN is required when compiler server is not bound to loopback.');
function corsOrigin(req){const origin=String(req.headers.origin||'');return origin && ALLOWED_ORIGINS.has(origin) ? origin : (isLoopbackHost && !origin ? '*' : 'null');}
function authorized(req){if(!AUTH_TOKEN)return isLoopbackHost;const h=String(req.headers.authorization||'');return h === `Bearer ${AUTH_TOKEN}`;}


function send(res,status,body,req=null){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':corsOrigin(req||{headers:{}}),'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type,authorization','vary':'Origin'});res.end(status===204?'':JSON.stringify(body));}
async function readJson(req){return new Promise((resolve,reject)=>{let size=0,data='';req.setEncoding('utf8');req.on('data',c=>{size+=Buffer.byteLength(c);if(size>MAX_BODY){reject(Object.assign(new Error('Request too large.'),{status:413}));req.destroy();return}data+=c});req.on('end',()=>{try{resolve(data?JSON.parse(data):{})}catch{reject(Object.assign(new Error('Invalid JSON body.'),{status:400}))}});req.on('error',reject)})}
async function loadRecord(id){if(!/^[a-f0-9]{64}$/i.test(id))return null;try{return JSON.parse(await fs.readFile(path.join(JOURNAL_DIR,`${id}.json`),'utf8'))}catch{return null}}
async function deleteRecord(id){try{await fs.rm(path.join(JOURNAL_DIR,`${id}.json`),{force:true})}catch{}}

async function main(req,res){
 if(req.method==='OPTIONS'){if(!isLoopbackHost && !authorized(req))return send(res,401,{ok:false,message:'Unauthorized.'},req);return send(res,204,{},req);}
 // /health is authorized like every other route -- on loopback with no token that's a no-op
 // (authorized() returns true), and on a non-loopback deployment it stays behind the bearer
 // token so version/feature info is never disclosed to unauthenticated callers.
 if(!authorized(req))return send(res,401,{ok:false,message:'Unauthorized.'},req);
 const url=new URL(req.url,`http://${req.headers.host||HOST}`);
 if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,version:VERSION,service:'code-patcher-compiler-server',features:['parse','plan','patch-prepare','impact','project-prepare','commit','rollback','crash-recovery','python-ast']},req);
 if(req.method!=='POST')return send(res,404,{ok:false,message:'Not found.'},req);
 const b=await readJson(req);
 if(url.pathname==='/python-ast'){if(String(b.code??'').length>2_000_000)return send(res,413,{ok:false,message:'Python source exceeds safety limit.'},req);const {spawn}=await import('node:child_process');const helper=fileURLToPath(new URL('../api/python-ast.py',import.meta.url));const result=await new Promise(resolve=>{const child=spawn('python3',[helper],{stdio:['pipe','pipe','pipe']});let out='',err='',done=false;const finish=x=>{if(!done){done=true;resolve(x)}};const timer=setTimeout(()=>{child.kill('SIGKILL');finish({ok:false,error:'Python AST helper timed out.'})},30000);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',e=>{clearTimeout(timer);finish({ok:false,error:e.message})});child.on('close',code=>{clearTimeout(timer);if(done)return;if(code!==0)return finish({ok:false,error:(err||out||`exit ${code}`).trim()});try{finish(JSON.parse(out))}catch{finish({ok:false,error:'Invalid Python AST helper response.'})}});child.stdin.end(JSON.stringify({code:String(b.code??''),file_name:String(b.file_name||b.fileName||'file.py')}));});return send(res,result.ok===false?422:200,result,req)}
 if(url.pathname==='/parse'){if(String(b.code??'').length>LIMITS.maxSourceChars)return send(res,413,{ok:false,message:'Source exceeds safety limit.'},req);return send(res,200,await parseCode(String(b.code??''),String(b.fileName||'source.txt')),req)}
 if(url.pathname==='/plan' || url.pathname==='/patch/prepare' || url.pathname==='/patch'){const r=await prepareSingleFileTransaction(b,{policy:b.policy,mode:b.mode});return send(res,r.ok?200:422,r,req)}
 if(url.pathname==='/impact'){const impact=analyzeCrossFileImpact(Array.isArray(b.before)?b.before:[],Array.isArray(b.after)?b.after:[]);return send(res,200,{ok:true,impact},req)}
 if(url.pathname==='/analyze-project'){const files=Array.isArray(b.files)?b.files:[];if(files.length>500)return send(res,413,{ok:false,message:'Project exceeds 500-file safety limit.'},req);const impact=analyzeCrossFileImpact(files.map(f=>({fileName:f.fileName,content:f.beforeContent??f.content??'',fileType:f.fileType})),files.map(f=>({fileName:f.fileName,content:f.afterContent??f.content??'',fileType:f.fileType})));return send(res,200,{ok:true,impact},req)}
 if(url.pathname==='/project'){const r=await prepareProjectTransaction(b.files,{policy:normalizePolicy(b.policy),mode:b.mode,reviewApproved:b.reviewApproved===true});if(!r.ok)return send(res,422,r,req);if(!r.results.every(x=>x.filePath))return send(res,422,{...r,ok:false,message:'Project prepared successfully, but every file must provide filePath for filesystem commit.'},req);const saved={...r,workspaceRoot:WORKSPACE_ROOT,preparedAt:new Date().toISOString()};await persistTransactionRecord(JOURNAL_DIR,saved);return send(res,200,saved,req)}
 if(url.pathname==='/commit'){const id=String(b.transactionId||''),record=await loadRecord(id);if(!record)return send(res,404,{ok:false,message:'Prepared transaction not found.'},req);const r=await commitPreparedTransaction(record,{workspaceRoot:WORKSPACE_ROOT,rejectExternalMutation:record.policy?.transaction?.rejectExternalMutation!==false});if(r.ok)await persistTransactionRecord(JOURNAL_DIR,r);else await persistTransactionRecord(JOURNAL_DIR,{...record,...r});return send(res,r.ok?200:409,r,req)}
 if(url.pathname==='/rollback'){const id=String(b.transactionId||''),record=await loadRecord(id);if(!record)return send(res,404,{ok:false,message:'Transaction not found.'},req);const r=await rollbackCommittedTransaction(record,{workspaceRoot:WORKSPACE_ROOT});if(r.ok)await deleteRecord(id);return send(res,r.ok?200:409,r,req)}
 return send(res,404,{ok:false,message:'Not found.'},req);
}
const server=http.createServer((req,res)=>main(req,res).catch(e=>send(res,e.status||500,{ok:false,message:e.message||'Internal compiler server error.'},req)));
recoverTransactions({workspaceRoot:WORKSPACE_ROOT,journalDir:JOURNAL_DIR}).then((recovery)=>{
  if(recovery.recovered?.length) console.warn(`Code Patcher recovery restored ${recovery.recovered.length} incomplete transaction(s).`);
  server.listen(PORT,HOST,()=>console.log(`Code Patcher V${VERSION} compiler server listening on http://${HOST}:${PORT} | workspace=${WORKSPACE_ROOT}`));
}).catch((error)=>{ console.error(`Code Patcher startup recovery failed: ${error?.message||error}`); process.exitCode=1; });
