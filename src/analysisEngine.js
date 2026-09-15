/** V23 static intelligence facade. Type consistency and taint are explicitly heuristic. */
import { analyzeDataFlow } from './dataflow.js';
import { buildSymbolIndex } from './symbolIndex.js';
import { resolveSpecifier } from './impactAnalysis.js';
const EXT=/\.([a-z0-9]+)$/i;
function ext(f){return(f.match(EXT)?.[1]||'').toLowerCase()}
function line(s, index) {
  const limit = Math.min(Number.isFinite(index) ? Math.max(0, index) : 0, s.length);
  let l = 1;
  for (let i = 0; i < limit; i++) {
    const c = s.charCodeAt(i);
    if (c === 10) l++;
    else if (c === 13) {
      l++;
      if (i + 1 < limit && s.charCodeAt(i + 1) === 10) i++;
    }
  }
  return l;
}
export function extractImports(fileName,code){return buildSymbolIndex([{fileName,content:code}]).files[0]?.imports.map(x=>x.source)||[]}
export function buildDependencyGraph(files=[]){
 const index=buildSymbolIndex(files),ids=new Set(files.map(f=>f.fileName)),nodes=files.map(f=>({id:f.fileName,name:f.fileName,type:f.fileType||'auto'})),edges=[];
 for(const f of index.files) for(const imp of f.imports){const resolved=resolveSpecifier(f.fileName,imp.source,ids);edges.push({from:f.fileName,to:resolved||imp.source,external:!resolved,line:imp.line})}
 return {nodes,edges,cycles:findCycles(nodes,edges)}
}
function findCycles(nodes, edges) {
  const adj = new Map(nodes.map(n => [n.id, []]));
  for (const e of edges) if (!e.external) adj.get(e.from)?.push(e.to);
  const out = [], active = new Set(), stack = [], seen = new Set();
  function dfs(n) {
    if (out.length >= 50) return;
    if (active.has(n)) {
      const i = stack.indexOf(n);
      if (i >= 0) {
        const cycle = stack.slice(i).concat(n);
        const k = cycle.join('>');
        if (!seen.has(k)) {
          seen.add(k);
          out.push(cycle);
        }
      }
      return;
    }
    active.add(n);
    stack.push(n);
    for (const x of adj.get(n) || []) {
      dfs(x);
      if (out.length >= 50) break;
    }
    stack.pop();
    active.delete(n);
  }
  for (const n of adj.keys()) {
    if (out.length >= 50) break;
    dfs(n);
  }
  return out;
}
export function typeCheckStatic(fileName, code) {
  const s = String(code || ''), e = ext(fileName), diagnostics = [];
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(e)) {
    const declared = new Set([
      ...[...s.matchAll(/\b(?:const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
      ...[...s.matchAll(/\bimport\s+(?:(?:\*\s+as\s+([A-Za-z_$][\w$]*))|\{([^}]+)\}|([A-Za-z_$][\w$]*))/g)].flatMap(m => {
        if (m[1]) return [m[1]];
        if (m[2]) return m[2].split(',').map(x => { const p = x.trim().split(/\s+as\s+/); return p[p.length - 1]; });
        return [m[3]];
      }).filter(Boolean),
      ...[...s.matchAll(/(?:\(|,)\s*([A-Za-z_$][\w$]*)\s*(?:=[^,)]+)?(?=[,)])/g)].map(m => m[1])
    ]);
    const globals = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'function', 'console', 'Math', 'JSON', 'Object', 'Array',
      'String', 'Number', 'Boolean', 'Date', 'Promise', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'require', 'fetch', 'Map', 'Set', 'Error', 'TypeError', 'RegExp', 'URL', 'Blob', 'Buffer', 'process',
      'window', 'document', 'navigator', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'structuredClone',
      'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'atob', 'btoa', 'encodeURI', 'decodeURI',
      'encodeURIComponent', 'decodeURIComponent'
    ]);
    for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      let p = m.index - 1;
      while (p >= 0 && (s.charCodeAt(p) === 32 || s.charCodeAt(p) === 9 || s.charCodeAt(p) === 10 || s.charCodeAt(p) === 13)) p--;
      if (p >= 0 && (s.charCodeAt(p) === 46 || s.charCodeAt(p) === 63)) continue;
      const n = m[1];
      if (!declared.has(n) && !globals.has(n)) {
        diagnostics.push({ severity: 'warning', code: 'UNRESOLVED-CALL', line: line(s, m.index), message: `Potential unresolved call '${n}'.` });
      }
    }
  }
  return { ok: !diagnostics.some(d => d.severity === 'error'), strength: 'heuristic', diagnostics };
}
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
