/** V23 cross-file impact analysis. Browser-safe, static-only, transitive dependency aware. */
import { buildSymbolIndex, extractFileImports } from './symbolIndex.js';

function normalizePath(p=''){return String(p).replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/+/g,'/')}
function baseNoExt(p=''){return normalizePath(p).replace(/\.[^.\/]+$/,'')}
function dir(p=''){const n=normalizePath(p),i=n.lastIndexOf('/');return i<0?'':n.slice(0,i)}
function join(a,b){return normalizePath((a?a+'/':'')+b)}
const EXT=/\.([A-Za-z0-9]+)$/;
const JSISH=new Set(['js','mjs','cjs','jsx','ts','tsx']);

function resolveSpecifier(from,spec,ids){
  if(!spec)return null;
  const normalizedIds=[...ids];
  if(spec.startsWith('.')){
    const j=join(dir(from),spec), candidates=[j,j+'.js',j+'.mjs',j+'.cjs',j+'.jsx',j+'.ts',j+'.tsx',j+'.py',j+'.java',j+'.go',j+'.c',j+'.h',j+'.cpp',j+'.hpp',j+'/index.js',j+'/index.ts',j+'/index.py'];
    for(const x of candidates)if(ids.has(x))return x;
    for(const id of normalizedIds)if(baseNoExt(id)===baseNoExt(j))return id;
  }
  const exact=normalizedIds.find(id=>id===normalizePath(spec)||id.endsWith('/'+normalizePath(spec)));
  return exact||null;
}
function importBindings(fromFile,code,targetFile){
  const ext=(fromFile.match(EXT)?.[1]||'').toLowerCase(),s=String(code||''),out=[];
  if(JSISH.has(ext)){
    for(const m of s.matchAll(/\bimport\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g))if(resolveSpecifier(fromFile,m[2],new Set([targetFile]))===targetFile){
      const c=m[1].trim(),b=c.match(/\{([^}]+)\}/); if(b)for(const x of b[1].split(',')){const n=x.trim().split(/\s+as\s+/)[0];if(n)out.push(n)}
      const d=c.match(/^([A-Za-z_$][\w$]*)/);if(d)out.push(d[1]); if(/\*\s+as\s+/.test(c))out.push('*');
    }
    for(const m of s.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g))if(resolveSpecifier(fromFile,m[1],new Set([targetFile]))===targetFile)out.push('*');
  } else if(ext==='py'){
    for(const m of s.matchAll(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm))if(m[1]===targetFile||targetFile.endsWith(m[1].replace(/\./g,'/')+'.py'))out.push(...m[2].split(',').map(x=>x.trim().split(/\s+as\s+/)[0]));
  } else if(ext==='go'||ext==='java')return ['*'];
  return [...new Set(out.filter(Boolean))];
}
function changedSymbols(before,after){
  const b=new Map(before.map(x=>[`${x.kind}:${x.name}`,x])),a=new Map(after.map(x=>[`${x.kind}:${x.name}`,x])),out=[];
  for(const [k,x] of b){if(!a.has(k))out.push({kind:'removed-symbol',symbol:x.name,symbolKind:x.kind,before:x,breaking:true});}
  for(const [k,x] of a){if(!b.has(k))out.push({kind:'added-symbol',symbol:x.name,symbolKind:x.kind,after:x,breaking:false});}
  for(const [k,x] of a){const old=b.get(k);if(old&&old.signature!==x.signature)out.push({kind:'changed-symbol',symbol:x.name,symbolKind:x.kind,before:old,after:x,breaking:true});}
  return out;
}
function changedExports(before,after){
  const b=before.filter(x=>x.exported),a=after.filter(x=>x.exported); return changedSymbols(b,a).map(x=>({...x,kind:x.kind==='removed-symbol'?'removed-export':x.kind==='added-symbol'?'added-export':'changed-export'}));
}
function graphFromIndex(index,files){
  const ids=new Set(files.map(f=>normalizePath(f.fileName))),nodes=files.map(f=>({id:normalizePath(f.fileName),name:f.fileName,type:f.fileType||'auto'})),edges=[];
  for(const f of files){const entry=index.files.find(x=>x.fileName===f.fileName);for(const imp of entry?.imports||[]){const target=resolveSpecifier(f.fileName,imp.source,ids);edges.push({from:normalizePath(f.fileName),to:target||normalizePath(imp.source),external:!target,line:imp.line,names:imp.names||null});}}
  return {nodes,edges,cycles:findCycles(nodes,edges)};
}
function findCycles(nodes,edges){
  const adj=new Map(nodes.map(n=>[n.id,[]])); for(const e of edges)if(!e.external&&adj.has(e.from))adj.get(e.from).push(e.to);
  const out=[],stack=[],active=new Set(); function dfs(n){if(active.has(n)){const i=stack.indexOf(n);if(i>=0)out.push(stack.slice(i).concat(n));return;}active.add(n);stack.push(n);for(const x of adj.get(n)||[])dfs(x);stack.pop();active.delete(n)}
  for(const n of adj.keys())dfs(n);const seen=new Set();return out.filter(c=>{const k=c.join('>');if(seen.has(k))return false;seen.add(k);return true}).slice(0,50);
}

export function analyzeCrossFileImpact(beforeFiles=[],afterFiles=[]){
  const before=beforeFiles.map(f=>({...f,fileName:normalizePath(f.fileName)})),after=afterFiles.map(f=>({...f,fileName:normalizePath(f.fileName)}));
  const beforeIndex=buildSymbolIndex(before),afterIndex=buildSymbolIndex(after),beforeMap=new Map(before.map(f=>[f.fileName,f])),afterMap=new Map(after.map(f=>[f.fileName,f]));
  const allIds=new Set([...beforeMap.keys(),...afterMap.keys()]),changes=[];
  for(const id of allIds){const b=beforeIndex.files.find(x=>x.fileName===id)?.symbols||[],a=afterIndex.files.find(x=>x.fileName===id)?.symbols||[],old=beforeMap.get(id)?.content??'',neu=afterMap.get(id)?.content??'';if(old===neu)continue;changes.push({fileName:id,changed:true,changes:changedExports(b,a),symbolChanges:changedSymbols(b,a),symbolsBefore:b,symbolsAfter:a});}
  const beforeGraph=graphFromIndex(beforeIndex,before),afterGraph=graphFromIndex(afterIndex,after);
  const reverseAfter=new Map(afterGraph.nodes.map(n=>[n.id,[]])), reverseBefore=new Map(beforeGraph.nodes.map(n=>[n.id,[]]));
  for(const e of afterGraph.edges)if(!e.external&&reverseAfter.has(e.to))reverseAfter.get(e.to).push(e.from);
  for(const e of beforeGraph.edges)if(!e.external&&reverseBefore.has(e.to))reverseBefore.get(e.to).push(e.from);
  const impact=[];
  const changedTargets=new Map(changes.map(x=>[x.fileName,x]));
  for(const [providerId,ch] of changedTargets){
    const directConsumers=new Set([...(reverseAfter.get(providerId)||[]),...(reverseBefore.get(providerId)||[])]);
    for(const consumerId of directConsumers){
      const consumer=afterMap.get(consumerId)||beforeMap.get(consumerId), codeAfter=consumer?.content||'', codeBefore=beforeMap.get(consumerId)?.content||'';
      const bindings=[...importBindings(consumerId,codeAfter,providerId),...importBindings(consumerId,codeBefore,providerId)];
      const bound=bindings.length===0||bindings.includes('*')?null:new Set(bindings);
      const relevant=ch.changes.filter(c=>c.kind!=='added-export'&&(bound===null||bound.has(c.symbol)));
      for(const change of relevant)impact.push({severity:'high',consumer:consumerId,provider:providerId,symbol:change.symbol,kind:change.kind,reason:`Consumer depends on '${change.symbol}' from '${providerId}' and its exported contract changed.`,distance:1});
      if(!relevant.length&&ch.changes.length) impact.push({severity:'medium',consumer:consumerId,provider:providerId,kind:'provider-changed',reason:`Consumer imports changed provider '${providerId}'; exported names were not directly matched.`,distance:1});
    }
    const queue=[...directConsumers].map(x=>[x,2]),seen=new Set(queue.map(x=>x[0]));
    while(queue.length){const [consumerId,distance]=queue.shift();const parents=new Set([...(reverseAfter.get(consumerId)||[]),...(reverseBefore.get(consumerId)||[])]);for(const parent of parents){if(parent===providerId||seen.has(parent))continue;seen.add(parent);impact.push({severity:'medium',consumer:parent,provider:providerId,kind:'transitive-impact',reason:`'${parent}' depends transitively on changed provider '${providerId}' through '${consumerId}'.`,distance});queue.push([parent,distance+1]);}}
  }
  const cycleChanged=JSON.stringify(beforeGraph.cycles)!==JSON.stringify(afterGraph.cycles);
  if(cycleChanged&&afterGraph.cycles.length)impact.push({severity:'medium',kind:'dependency-cycle',cycles:afterGraph.cycles,reason:'Dependency cycle topology changed after the transaction.'});
  const unique=impact.filter((x,i,a)=>i===a.findIndex(y=>JSON.stringify([y.consumer,y.provider,y.symbol,y.kind,y.distance])===JSON.stringify([x.consumer,x.provider,x.symbol,x.kind,x.distance])));
  const breaking=unique.filter(x=>x.severity==='high'),warnings=unique.filter(x=>x.severity!=='high');
  return {ok:breaking.length===0,breaking,warnings,changes,beforeGraph,afterGraph,symbolIndex:afterIndex,summary:{changedFiles:changes.length,breaking:breaking.length,warnings:warnings.length,cycles:afterGraph.cycles.length,directImpacts:unique.filter(x=>x.distance===1).length,transitiveImpacts:unique.filter(x=>x.distance>1).length}};
}

export {resolveSpecifier,importBindings,extractFileImports};
