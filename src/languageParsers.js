/** V11 real-AST language adapters. Syntax parsing never executes user source. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import cp from "node:child_process";

const MAX_SOURCE=5_000_000;
const TEMP_ROOT=path.join(os.tmpdir(),"code-patcher-v11");
const EXT=new Set([".java",".c",".h",".cc",".cpp",".cxx",".hpp",".hh",".hxx",".go"]);
const JAVA_HELPER=path.join(path.dirname(new URL(import.meta.url).pathname),"..","api","java-ast.java");
const GO_HELPER=path.join(path.dirname(new URL(import.meta.url).pathname),"..","api","go-ast.go");
function exists(c){const r=cp.spawnSync(c,[c==="gofmt"?"-h":"--version"],{encoding:"utf8",timeout:5000,stdio:["ignore","pipe","pipe"]});return !r.error;}
function temp(name,ext){fs.mkdirSync(TEMP_ROOT,{recursive:true,mode:0o700});const d=fs.mkdtempSync(path.join(TEMP_ROOT,"job-"));let b=path.basename(name||`source${ext}`).replace(/[^A-Za-z0-9_.-]/g,"_");if(!b.toLowerCase().endsWith(ext))b+=ext;return {dir:d,file:path.join(d,b)};}
function clean(d){try{fs.rmSync(d,{recursive:true,force:true})}catch{}}
function fail(language,parser,message,extra={}){return {ok:false,language,parser,strength:"real-ast",message,...extra};}
function runJson(cmd,args,language,parser,dir,timeout=30000){const r=cp.spawnSync(cmd,args,{encoding:"utf8",timeout,maxBuffer:8*1024*1024});if(r.error)return fail(language,parser,r.error.message);if(r.status!==0)return fail(language,parser,(r.stderr||r.stdout||`${cmd} failed`).trim());try{return JSON.parse(r.stdout)}catch{return fail(language,parser,"Parser returned invalid JSON",{raw:r.stdout?.slice(0,1000)})}}
function clangAst(code,fileName,language){
  const hasClang=exists(language==="c"?"clang":"clang++");
  const compiler=language==="c"?(hasClang?"clang":exists("gcc")?"gcc":null):(hasClang?"clang++":exists("g++")?"g++":null);
  if(!compiler)return fail(language,compiler||"clang",`${language.toUpperCase()} compiler unavailable`,{unavailable:true});
  const ext=language==="c"?".c":".cpp",t=temp(fileName,ext);
  try{
    fs.writeFileSync(t.file,code,{mode:0o600});
    const std=language==="c"?"-std=c17":"-std=c++17";
    if(!hasClang){
      // GCC has no equivalent to Clang's -Xclang -ast-dump=json; those flags are Clang-only
      // and gcc rejects them outright. Fall back to a syntax-only check with no AST snapshot
      // rather than passing Clang-only flags to a different compiler.
      const r=cp.spawnSync(compiler,["-fsyntax-only",std,t.file],{encoding:"utf8",timeout:30000,maxBuffer:32*1024*1024});
      if(r.status!==0)return fail(language,compiler,(r.stderr||r.stdout||"syntax failed").trim());
      return {ok:true,language,parser:compiler,strength:"syntax-only",message:`${compiler} syntax gate succeeded (no Clang available for a full AST snapshot; entities/imports are unavailable in this mode).`,snapshot:{language,entities:[],imports:[],exports:[]}};
    }
    const args=["-fsyntax-only","-Xclang","-ast-dump=json",std,t.file];
    const r=cp.spawnSync(compiler,args,{encoding:"utf8",timeout:30000,maxBuffer:192*1024*1024});
    if(r.status!==0)return fail(language,compiler,(r.stderr||r.stdout||"syntax failed").trim());
    let ast;try{ast=JSON.parse(r.stdout)}catch(e){return fail(language,compiler,"clang AST JSON could not be decoded")};
    return {ok:true,language,parser:`${compiler}-ast-json`,strength:"real-ast",message:"Compiler syntax gate + Clang JSON AST succeeded without linking/executing source.",snapshot:clangSnapshot(ast,language,t.file,code)}
  }finally{clean(t.dir)}
}
function clangSnapshot(root,language,sourceFile,sourceCode){const entities=[],imports=[];const sourceLineCount=String(sourceCode??"").split(/\r\n|\r|\n/).length;const lineFor=n=>n?.loc?.line??n?.range?.begin?.line??(Number.isFinite(n?.loc?.offset)?String(sourceCode??"").slice(0,n.loc.offset).split(/\r\n|\r|\n/).length:(Number.isFinite(n?.range?.begin?.offset)?String(sourceCode??"").slice(0,n.range.begin.offset).split(/\r\n|\r|\n/).length:null));const isUserNode=n=>{const f=n?.loc?.file||n?.range?.begin?.file||""; const line=lineFor(n); return f===sourceFile || (!f && !n?.loc?.includedFrom && !n?.range?.begin?.includedFrom && line!==null && line<=sourceLineCount);};const walk=n=>{if(!n||typeof n!=="object")return;const k=n.kind||"",name=n.name||"";if(isUserNode(n)&&["FunctionDecl","CXXMethodDecl","CXXConstructorDecl","CXXDestructorDecl","RecordDecl","CXXRecordDecl","EnumDecl","NamespaceDecl","VarDecl"].includes(k)&&name){const loc=lineFor(n);const params=(n.inner||[]).filter(x=>x.kind==="ParmVarDecl").map(x=>x.name||x.type?.qualType||"<param>");const kind=k==="CXXRecordDecl"||k==="RecordDecl"?"class":k==="CXXMethodDecl"||k==="FunctionDecl"||k==="CXXConstructorDecl"||k==="CXXDestructorDecl"?"function":k==="EnumDecl"?"enum":k==="NamespaceDecl"?"namespace":k==="VarDecl"?"variable":k;entities.push({id:`${kind}:${name}:${loc}`,kind,name,location:{line:loc,column:n.loc?.col??n.range?.begin?.col??null},params:params.length?params:undefined})}if(isUserNode(n)&&k==="ImportDecl"&&name)imports.push({source:name,location:n.loc||{}});for(const v of Object.values(n)){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==="object")walk(v)}};walk(root);const seen=new Set();const clean=entities.filter(e=>{const k=`${e.kind}|${e.name}|${e.location?.line??""}`;if(seen.has(k))return false;seen.add(k);return true;});return {language,entities:clean,imports,exports:[]}}
let JAVA_CACHE=null;
let GO_CACHE=null;
function javaHelperClasses(){
  if(JAVA_CACHE) return JAVA_CACHE;
  if(!exists('javac')) return null;
  const dir=path.join(TEMP_ROOT,'java-helper-cache'); fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const marker=path.join(dir,'JavaAst.class');
  if(!fs.existsSync(marker)){
    const helperTarget=path.join(dir,'JavaAst.java'); fs.copyFileSync(JAVA_HELPER,helperTarget);
    const c=cp.spawnSync('javac',['-proc:none','-Xlint:none','-d',dir,helperTarget],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
    if(c.status!==0) return {error:'Failed to compile trusted AST helper: '+(c.stderr||c.stdout)};
  }
  JAVA_CACHE=dir; return dir;
}
function javaAst(code,fileName){
  const classes=javaHelperClasses(); if(!classes) return fail('java','javac','javac unavailable',{unavailable:true}); if(classes.error) return fail('java','javac-tree-api',classes.error);
  const t=temp(fileName,'.java'); try{
    fs.writeFileSync(t.file,code,{mode:0o600});
    const r=cp.spawnSync('java',['-cp',classes,'JavaAst',t.file],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
    if(r.status!==0) return fail('java','javac-tree-api',(r.stderr||r.stdout||'Java AST helper failed').trim());
    try{const x=JSON.parse(r.stdout); if(x.ok&&x.snapshot)x.snapshot.entities=x.snapshot.entities.map(e=>({...e,location:{line:e.line??null,column:e.column??null}})); return x;}catch{return fail('java','javac-tree-api','Java AST helper returned invalid JSON')}
  } finally { clean(t.dir); }
}
function goHelperBinary(){
  if(GO_CACHE) return GO_CACHE;
  if(!exists('go')) return null;
  const dir=path.join(TEMP_ROOT,'go-helper-cache'); fs.mkdirSync(dir,{recursive:true,mode:0o700}); const bin=path.join(dir,process.platform==='win32'?'goast.exe':'goast');
  if(!fs.existsSync(bin)){const b=cp.spawnSync('go',['build','-o',bin,GO_HELPER],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024}); if(b.status!==0)return {error:(b.stderr||b.stdout||'Go AST helper build failed').trim()};}
  GO_CACHE=bin; return bin;
}
function goAst(code,fileName){
  const bin=goHelperBinary(); if(!bin)return fail('go','go/parser','go unavailable',{unavailable:true}); if(bin.error)return fail('go','go/parser',bin.error);
  const t=temp(fileName,'.go'); try{
    fs.writeFileSync(t.file,code,{mode:0o600}); const r=cp.spawnSync(bin,[t.file],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
    if(r.status!==0)return fail('go','go/parser',(r.stderr||r.stdout||'Go AST helper failed').trim());
    try{const x=JSON.parse(r.stdout); if(x.ok)x.parser='go/parser'; x.parser_detail='go/parser'; return x}catch{return fail('go','go/parser','Go AST helper returned invalid JSON')}
  } finally {clean(t.dir);}
}
function languageForFile(fileName=""){const e=path.extname(fileName).toLowerCase();if(e===".java")return"java";if([".c",".h"].includes(e))return"c";if([".cc",".cpp",".cxx",".hpp",".hh",".hxx"].includes(e))return"cpp";if(e===".go")return"go";return null}
function parseExtraLanguage(code,fileName="source.txt"){if(typeof code!=="string")return fail("unknown","none","code must be a string");if(code.length>MAX_SOURCE)return fail(languageForFile(fileName)||"unknown","none","source exceeds safety limit");const l=languageForFile(fileName);if(!l)return fail("unknown","none","Unsupported language");if(l==="java")return javaAst(code,fileName);if(l==="go")return goAst(code,fileName);return clangAst(code,fileName,l)}
export{parseExtraLanguage,languageForFile as compilerLanguageForFile};
