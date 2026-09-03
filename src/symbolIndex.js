/** V23 language-neutral symbol index. Real Babel AST for JS/TS; conservative adapters elsewhere.
 *
 * parseJsAst is loaded lazily (not via a static import) and reuses the single Babel
 * configuration in patchEngine.js so JS/TS parsing never diverges between the patch
 * engine and the symbol index. The dynamic import is wrapped so that a missing/broken
 * @babel/parser install only degrades JS/TS symbol extraction to the regex-based
 * fallback below -- it must never take down Python/Java/Go/C++ lexical extraction or
 * any other consumer of this module (see V23 post-merge hardening notes in the README).
 */
let parseJsAst = null;
try {
  ({ parseJsAst } = await import('./patchEngine.js'));
} catch {
  parseJsAst = null;
}

const EXT = /\.([A-Za-z0-9]+)$/;
const JS = new Set(['js','mjs','cjs','jsx','ts','tsx']);
const C = new Set(['c','h','cc','cpp','cxx','hpp','hh','hxx']);
const BUILTINS = new Set(['if','for','while','switch','catch','function','return','sizeof','make','append']);

function extOf(name) { return (name.match(EXT)?.[1] || '').toLowerCase(); }
function lineAt(code, i) { return code.slice(0, i).split(/\r\n|\r|\n/).length; }
function add(map, code, name, kind, i, exported = false, signature = '', source = 'heuristic') {
  if (!name) return;
  map.set(`${kind}:${name}`, { name, kind, line: lineAt(code, i), exported, signature, source });
}
function paramText(node) { return node?.type === 'Identifier' ? node.name : '<complex>'; }
function nodeOffset(node) { return Number.isInteger(node?.start) ? node.start : 0; }
function declarationExported(node, parent) { return !!(parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration'); }

function parseJsSymbols(fileName, code) {
  const s = String(code ?? ''), map = new Map();
  if (!parseJsAst) return null;
  const type = ({js:'javascript',mjs:'javascript',cjs:'javascript',jsx:'jsx',ts:'typescript',tsx:'tsx'})[extOf(fileName)] || 'javascript';
  const parsed = parseJsAst(s, type);
  if (parsed.error) return null;
  const ast = parsed.ast;
  const visit = (node, parent = null) => {
    if (!node || typeof node !== 'object') return;
    const exported = !!(parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration');
    if (node.type === 'FunctionDeclaration' && node.id?.name) add(map,s,node.id.name,'function',node.start,exported,`(${(node.params||[]).map(paramText).join(', ')})`,'babel-ast');
    else if (node.type === 'ClassDeclaration' && node.id?.name) add(map,s,node.id.name,'class',node.start,exported,'class','babel-ast');
    else if (node.type === 'VariableDeclaration') for (const d of node.declarations||[]) if (d.id?.type==='Identifier') add(map,s,d.id.name,'variable',d.start,exported,'value','babel-ast');
    else if (node.type === 'TSInterfaceDeclaration' && node.id?.name) add(map,s,node.id.name,'interface',node.start,exported,'interface','babel-ast');
    else if (node.type === 'TSTypeAliasDeclaration' && node.id?.name) add(map,s,node.id.name,'type',node.start,exported,'type','babel-ast');
    if (node.type === 'ExportNamedDeclaration') for (const spec of node.specifiers||[]) { const n=spec.exported?.name||spec.exported?.value; if(n) add(map,s,n,'export',spec.start,true,'export','babel-ast'); }
    if (node.type === 'ExportDefaultDeclaration') add(map,s,'default','export',node.start,true,'export','babel-ast');
    for (const value of Object.values(node)) {
      if (!value || value === parent) continue;
      if (Array.isArray(value)) for (const v of value) if (v?.type) visit(v,node);
      else if (value?.type) visit(value,node);
    }
  };
  visit(ast.program || ast);
  return [...map.values()];
}

function parseSymbols(fileName, code) {
  const s = String(code ?? ''), ext = extOf(fileName), map = new Map();
  if (JS.has(ext)) {
    const real = parseJsSymbols(fileName,s);
    if (real) return real;
    for (const m of s.matchAll(/\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) add(map,s,m[1],'function',m.index,/^export\s/.test(m[0]),`(${m[2].replace(/\s+/g,' ').trim()})`);
    for (const m of s.matchAll(/\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(map,s,m[1],'class',m.index,/^export\s/.test(m[0]), 'class');
  } else if (ext === 'py') {
    for (const m of s.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)) add(map,s,m[1],'function',m.index,!m[1].startsWith('_'),`(${m[2].replace(/\s+/g,' ').trim()})`,'python-lexical');
    for (const m of s.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) add(map,s,m[1],'class',m.index,!m[1].startsWith('_'),'class','python-lexical');
  } else if (ext === 'java') {
    for (const m of s.matchAll(/\b(?:public\s+|protected\s+|private\s+)?(?:abstract\s+|final\s+)?class\s+([A-Za-z_$][\w$]*)/g)) add(map,s,m[1],'class',m.index,/\bpublic\b/.test(m[0]),'class','java-lexical');
    for (const m of s.matchAll(/\b(?:public|protected|private)\s+(?:static\s+)?[\w<>?,\[\]]+\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) add(map,s,m[1],'method',m.index,true,`(${m[2].replace(/\s+/g,' ').trim()})`,'java-lexical');
  } else if (ext === 'go') {
    for (const m of s.matchAll(/\btype\s+([A-Za-z_]\w*)\s+(struct|interface)\b/g)) add(map,s,m[1],m[2],m.index,/^[A-Z]/.test(m[1]),m[2],'go-lexical');
    for (const m of s.matchAll(/\bfunc\s+\(([^)]*)\)\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) add(map,s,m[2],'method',m.index,/^[A-Z]/.test(m[2]),`receiver(${m[1].replace(/\s+/g,' ').trim()})(${m[3].replace(/\s+/g,' ').trim()})`,'go-lexical');
    for (const m of s.matchAll(/\bfunc\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/g)) add(map,s,m[1],'function',m.index,/^[A-Z]/.test(m[1]),`(${m[2].replace(/\s+/g,' ').trim()})`,'go-lexical');
  } else if (C.has(ext)) {
    for (const m of s.matchAll(/\b(?:[A-Za-z_][\w:*&<>\s]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g)) add(map,s,m[1],'function',m.index,!m[1].startsWith('_'),'('+m[2].replace(/\s+/g,' ').trim()+')','cpp-lexical');
    for (const m of s.matchAll(/\b(?:class|struct|enum)\s+([A-Za-z_]\w*)/g)) add(map,s,m[1],m[0].split(/\s+/)[0],m.index,!m[1].startsWith('_'),m[0].split(/\s+/)[0],'cpp-lexical');
  }
  return [...map.values()].filter(x => !BUILTINS.has(x.name));
}

function imports(fileName, code) {
  const ext=extOf(fileName),s=String(code ?? ''),out=[];
  if (JS.has(ext)) {
    for (const m of s.matchAll(/\bimport\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const names=[]; const clause=(m[1]||'').trim(); const b=clause.match(/\{([^}]+)\}/); if(b) for(const x of b[1].split(',')){const n=x.trim().split(/\s+as\s+/)[0];if(n)names.push(n)} const d=clause.match(/^([A-Za-z_$][\w$]*)/); if(d)names.push('default:'+d[1]); if(/\*\s+as\s+/.test(clause))names.push('*'); out.push({source:m[2],names,line:lineAt(s,m.index)});
    }
    for (const m of s.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({source:m[1],names:['*'],line:lineAt(s,m.index)});
    for (const m of s.matchAll(/\bexport\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g)) out.push({source:m[1],names:['*'],line:lineAt(s,m.index)});
  } else if (ext==='py') {
    for (const m of s.matchAll(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/gm)) out.push({source:m[1],names:m[2].split(',').map(x=>x.trim().split(/\s+as\s+/)[0]),line:lineAt(s,m.index)});
    for (const m of s.matchAll(/^\s*import\s+([\w.]+)/gm)) out.push({source:m[1],names:[m[1].split('.').pop()],line:lineAt(s,m.index)});
  } else if (ext==='java') for (const m of s.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+)\s*;/gm)) out.push({source:m[1],names:[m[1].split('.').pop()],line:lineAt(s,m.index)});
  else if (ext==='go') {
    for (const m of s.matchAll(/^\s*import\s+(?:[A-Za-z_]\w*\s+)?"([^"]+)"/gm)) out.push({source:m[1],names:[m[1].split('/').pop()],line:lineAt(s,m.index)});
    for (const block of s.matchAll(/\bimport\s*\(([^)]*)\)/g)) for(const m of block[1].matchAll(/(?:[A-Za-z_]\w*\s+)?"([^"]+)"/g)) out.push({source:m[1],names:[m[1].split('/').pop()],line:lineAt(s,block.index)});
  }
  return out;
}

export function buildSymbolIndex(files = []) {
  const byFile = new Map(), symbols = [];
  for (const f of files) { const name=String(f.fileName||''), code=String(f.content||''); const fileSymbols=parseSymbols(name,code); const entry={fileName:name,symbols:fileSymbols,imports:imports(name,code)}; byFile.set(name,entry); symbols.push(...fileSymbols.map(s=>({...s,fileName:name}))); }
  return {files:[...byFile.values()],symbols,lookup:(name)=>symbols.filter(s=>s.name===name)};
}
export { parseSymbols, imports as extractFileImports };
