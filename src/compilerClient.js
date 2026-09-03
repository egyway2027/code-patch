/** Browser-safe client for the V23 compiler/transaction server. */
const DEFAULT_TIMEOUT=45_000;
function base(url){return String(url||'http://127.0.0.1:8787').replace(/\/$/,'')}
function authHeaders(){const token=typeof import.meta!=='undefined' ? String(import.meta.env?.VITE_COMPILER_SERVER_TOKEN||'') : '';return token?{Authorization:`Bearer ${token}`}:{}}
async function post(url,path,payload,timeout=DEFAULT_TIMEOUT){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(`${base(url)}${path}`,{method:'POST',headers:{'content-type':'application/json',...authHeaders()},signal:c.signal,body:JSON.stringify(payload)});const d=await r.json().catch(()=>({ok:false,message:'Invalid server JSON response.'}));return r.ok?d:{...d,ok:false,status:r.status};}catch(e){return{ok:false,unavailable:true,message:e?.name==='AbortError'?'Server request timed out.':e?.message||'Server unavailable.'}}finally{clearTimeout(t)}}
export async function compilerHealth(baseUrl='http://127.0.0.1:8787',timeout=5000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const r=await fetch(`${base(baseUrl)}/health`,{signal:c.signal,headers:authHeaders()});if(!r.ok)return{ok:false,status:r.status,message:`Compiler server returned HTTP ${r.status}.`};return await r.json()}catch(e){return{ok:false,message:e?.message||'Compiler server unavailable.'}}finally{clearTimeout(t)}}
export const parseWithCompilerServer=(code,fileName,opts={})=>post(opts.baseUrl,'/parse',{code:String(code??''),fileName:String(fileName||'source.txt')},opts.timeout||DEFAULT_TIMEOUT);
export const patchWithCompilerServer=(payload,opts={})=>post(opts.baseUrl,'/patch',payload,opts.timeout||60_000);
export const planPatchWithCompilerServer=(payload,opts={})=>post(opts.baseUrl,'/plan',payload,opts.timeout||60_000);
export const impactWithCompilerServer=(before,after,opts={})=>post(opts.baseUrl,'/impact',{before,after},opts.timeout||DEFAULT_TIMEOUT);
export const analyzeProjectWithServer=(files,opts={})=>post(opts.baseUrl,'/analyze-project',{files},opts.timeout||DEFAULT_TIMEOUT);
export const applyProjectWithServer=(files,opts={})=>post(opts.baseUrl,'/project',{files,policy:opts.policy,mode:opts.mode,reviewApproved:opts.reviewApproved===true},opts.timeout||120_000);
export const rollbackWithCompilerServer=(transactionId,opts={})=>post(opts.baseUrl,'/rollback',{transactionId},opts.timeout||DEFAULT_TIMEOUT);
export const commitProjectWithServer=(transactionId,opts={})=>post(opts.baseUrl,'/commit',{transactionId},opts.timeout||120_000);
