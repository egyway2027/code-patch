/** V23 static intelligence facade. Type consistency and taint are explicitly heuristic. */
import { analyzeDataFlow } from './dataflow.js';
import { buildSymbolIndex } from './symbolIndex.js';
import { resolveSpecifier } from './impactAnalysis.js';
const EXT=/\.([a-z0-9]+)$/i;
function ext(f){return(f.match(EXT)?.[1]||'').toLowerCase()}
function line(s,i){return s.slice(0,i).split(/\r\n|\r|\n/).length}
export function extractImports(fileName,code){return buildSymbolIndex([{fileName,content:code}]).files[0]?.imports.map(x=>x.source)||[]}
export function buildDependencyGraph(files=[]){
 const index=buildSymbolIndex(files),ids=new Set(files.map(f=>f.fileName)),nodes=files.map(f=>({id:f.fileName,name:f.fileName,type:f.fileType||'auto'})),edges=[];
 for(const f of index.files) for(const imp of f.imports){const resolved=resolveSpecifier(f.fileName,imp.source,ids);edges.push({from:f.fileName,to:resolved||imp.source,external:!resolved,line:imp.line})}
 return {nodes,edges,cycles:findCycles(nodes,edges)}
}
function findCycles(nodes,edges){const adj=new Map(nodes.map(n=>[n.id,[]]));for(const e of edges)if(!e.external)adj.get(e.from)?.push(e.to);const out=[],active=new Set(),stack=[];function dfs(n){if(active.has(n)){const i=stack.indexOf(n);if(i>=0)out.push(stack.slice(i).concat(n));return}active.add(n);stack.push(n);for(const x of adj.get(n)||[])dfs(x);stack.pop();active.delete(n)}for(const n of adj.keys())dfs(n);const seen=new Set();return out.filter(c=>{const k=c.join('>');if(seen.has(k))return false;seen.add(k);return true}).slice(0,50)}
export function typeCheckStatic(fileName,code){const s=String(code||''),e=ext(fileName),diagnostics=[];if(['js','jsx','mjs','cjs','ts','tsx'].includes(e)){const declared=new Set([...s.matchAll(/\b(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)].map(m=>m[1])),globals=new Set(['if','for','while','switch','catch','function','console','Math','JSON','Object','Array','String','Number','Boolean','Date','Promise','setTimeout','require']);for(const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)){const n=m[1];if(!declared.has(n)&&!globals.has(n))diagnostics.push({severity:'warning',code:'UNRESOLVED-CALL',line:line(s,m.index),message:`Potential unresolved call '${n}'.`})}}return{ok:!diagnostics.some(d=>d.severity==='error'),strength:'heuristic',diagnostics}}
export function taintAnalyze(fileName,code){const r=analyzeDataFlow(fileName,code);return{strength:r.strength,sources:r.sources,sinks:r.sinks,sanitizers:r.sanitizers,findings:r.flows}}
/**
 * strict=false (default): taint findings are informational only and never flip `ok` —
 * they are regex/heuristic data-flow hints, not a confirmed vulnerability, matching this
 * project's own rule that unconfirmed heuristic findings only gate the commit when the
 * user explicitly opts into Strict Security Gate (see codeAuditor.js's own strict param).
 * strict=true: unresolved taint findings also flip `ok` to false.
 */
export function analyzeCodeIntelligence(fileName,code,{strict=false}={}){const typeCheck=typeCheckStatic(fileName,code),taint=taintAnalyze(fileName,code);return{typeCheck,taint,ok:typeCheck.ok&&(!strict||taint.findings.length===0),strict:!!strict}}
export function analyzeProject(files=[],{strict=false}={}){const graph=buildDependencyGraph(files),analyses=files.map(f=>({fileName:f.fileName,...analyzeCodeIntelligence(f.fileName,f.content,{strict})}));return{graph,analyses,ok:analyses.every(a=>a.ok),summary:{files:files.length,diagnostics:analyses.reduce((n,a)=>n+a.typeCheck.diagnostics.length,0),taintFlows:analyses.reduce((n,a)=>n+a.taint.findings.length,0),cycles:graph.cycles.length}}}
