/** V23 lightweight AST-oriented data-flow approximation.
 * It is deliberately labeled heuristic. It tracks same-variable propagation through assignments/returns.
 */
const EXT=/\.([A-Za-z0-9]+)$/;
function extOf(f){return(f.match(EXT)?.[1]||'').toLowerCase()}
function lineAt(s,i){return s.slice(0,i).split(/\r\n|\r|\n/).length}
const RULES={
 js:{sources:[/\b(req|request|input|query|body|params)\b/g,/\bprocess\.env\b/g],sinks:[/\beval\s*\(([^)]*)\)/g,/\b(?:exec|execSync|spawn|spawnSync)\s*\(([^)]*)\)/g,/\binnerHTML\s*=\s*([^;]+)/g]},
 py:{sources:[/\b(request|input|args|kwargs)\b/g],sinks:[/\b(?:eval|exec)\s*\(([^)]*)\)/g,/\bos\.system\s*\(([^)]*)\)/g,/\bsubprocess\.[A-Za-z_]+\s*\(([^)]*)\)/g]},
 java:{sources:[/\bgetParameter\s*\(([^)]*)\)/g,/\bgetInputStream\s*\(/g],sinks:[/\bRuntime\.getRuntime\(\)\.exec\s*\(([^)]*)\)/g,/\bnew\s+ProcessBuilder\s*\(([^)]*)\)/g]},
 go:{sources:[/\bos\.Args\b/g,/\br\.URL\.Query\s*\(/g,/\br\.Form\b/g],sinks:[/\bexec\.Command(?:Context)?\s*\(([^)]*)\)/g]},
};
function key(ext){return ext==='python'?'py':ext==='javascript'||ext==='typescript'||['js','ts','jsx','tsx'].includes(ext)?'js':ext}
function vars(s){const out=[];for(const m of s.matchAll(/\b(?:const|let|var|[A-Za-z_][\w<>\[\]]*)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g))out.push({name:m[1],expr:m[2],line:lineAt(s,m.index)});return out}
export function analyzeDataFlow(fileName,code){const s=String(code||''),rules=RULES[key(extOf(fileName))]||null;if(!rules)return {strength:'heuristic',sources:0,sinks:0,flows:[],sanitizers:[]};const sources=[],sinks=[];for(const re of rules.sources)for(const m of s.matchAll(re))sources.push({line:lineAt(s,m.index),index:m.index,text:m[0]});for(const re of rules.sinks)for(const m of s.matchAll(re))sinks.push({line:lineAt(s,m.index),index:m.index,text:m[0],arg:m[1]||''});const assignments=vars(s);const sanitizers=[...s.matchAll(/\b(?:sanitize|escape|encodeURIComponent|prepared|parameterized|validate|whitelist)\w*\s*\(/gi)].map(m=>({line:lineAt(s,m.index),index:m.index,name:m[0]}));const flows=[];for(const sink of sinks){let candidate=sources.filter(src=>src.index<=sink.index).sort((a,b)=>b.index-a.index)[0]||null;const arg=sink.arg;for(const a of assignments){if(candidate&&a.index>candidate.index&&a.index<sink.index&&new RegExp(`\\b${a.name}\\b`).test(arg)){const upstream=sources.filter(src=>src.index<=a.index).sort((x,y)=>y.index-x.index)[0];if(upstream)candidate=upstream;}}const sanitized=candidate&&sanitizers.some(x=>x.index>candidate.index&&x.index<sink.index);if(candidate&&!sanitized)flows.push({severity:'high',confidence:'heuristic',sourceLine:candidate.line,sinkLine:sink.line,message:`Potential tainted data flow to sensitive sink at line ${sink.line}.`});}return{strength:'heuristic',sources:sources.length,sinks:sinks.length,sanitizers:sanitizers.length,flows};}
