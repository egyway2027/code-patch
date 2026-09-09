import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ShieldCheck,Languages,FolderOpen,Upload,Play,Copy,Download,Undo2,RefreshCw,Network,Bug,Braces,FileCode2,XCircle,CheckCircle2,Plus,Trash2,Sparkles,ShieldAlert} from 'lucide-react';
import {createDownloadName,detectFileType,LIMITS,MATCH_MODES,parsePatchBlocks,sizeInfo} from './patchEngine';
import {LANGUAGES,getLanguage,getStrings,isRTL,setLanguage} from './i18n';
import {analyzeCodeIntelligence,analyzeProject} from './analysisEngine';
import {compilerHealth, patchWithCompilerServer, applyProjectWithServer, commitProjectWithServer} from './compilerClient';
import {AI_PROMPT} from './aiPrompt';
const C={bg:'#031b18',card:'linear-gradient(145deg,rgba(12,65,55,.90),rgba(6,45,39,.92))',card2:'#062b25',border:'rgba(224,190,145,.22)',text:'#f8f2e9',sub:'#a9c0b9',gold:'#d9ae78',gold2:'#f1c993',green:'#37d67a',red:'#e06c75',blue:'#65a9ff',orange:'#f1c993'};
const box={background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:18,boxShadow:'0 15px 40px rgba(0,0,0,.22)'};
const mono={width:'100%',maxWidth:'100%',boxSizing:'border-box',minHeight:280,resize:'vertical',background:'#031f1b',color:'#f8f2e9',border:`1px solid ${C.border}`,borderRadius:14,padding:14,fontFamily:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',fontSize:13,lineHeight:1.55,direction:'ltr',textAlign:'left',outline:'none'};
function getFriendlyMessage(audit){
  if(!audit)return null;
  const fs=audit.findings||[];
  if(fs.some(f=>f.code==='JS-EVAL'||f.code==='PY-EVAL'||f.code==='PY-EVAL-EXEC'))
    return {bg:'rgba(142,62,59,0.25)',border:'#e06c75',color:'#ffb4ba',title:'⚠️ تنبيه أمني عالي الخطورة',desc:'تم رفض الكود لأنه يحتوي على أمر تنفيذ ديناميكي (eval/exec) يتيح تشغيل شفرات غير موثوقة قد تعرض نظامك للخطر.'};
  if(fs.some(f=>f.code==='HARDCODED-SECRET'))
    return {bg:'rgba(217,174,120,0.18)',border:'#d9ae78',color:'#f1c993',title:'🔑 تنبيه تسريب مفتاح سري',desc:'تم اكتشاف مفتاح API أو كلمة سر مكتوبة بشكل مكشوف داخل الكود. يُنصح بنقلها إلى ملفات .env للحفاظ على السرية.'};
  if(fs.some(f=>f.code==='DOM-INNERHTML'||f.code==='REACT-RAW-HTML'))
    return {bg:'rgba(217,174,120,0.18)',border:'#d9ae78',color:'#f1c993',title:'⚠️ تحذير أمان الواجهة (XSS)',desc:'تم اكتشاف تعديل مباشر لـ innerHTML قد يفتح ثغرة حقن خبيثة إذا كانت المدخلات غير معقمة.'};
  if(audit.ok)
    return {bg:'rgba(55,214,122,0.15)',border:'#37d67a',color:'#a9f2c2',title:'✓ الكود آمن ومعتمد',desc:'تم اجتياز جميع فحوصات القواعد وبوابات السلامة النحوية والأمنية بنجاح.'};
  return {bg:'rgba(142,62,59,0.25)',border:'#e06c75',color:'#ffb4ba',title:'⚠️ تنبيه أمني',desc:'تم رصد ملاحظات أمنية أو بنيوية تتطلب المراجعة قبل الاعتماد.'};
}
const FILE_OPTIONS=[['auto','Auto'],['javascript','JavaScript'],['typescript','TypeScript'],['jsx','JSX'],['tsx','TSX'],['python','Python'],['java','Java'],['c','C'],['cpp','C++'],['go','Go'],['json','JSON'],['html','HTML'],['css','CSS'],['text','Text']];
export default function CodePatcher(){
 const compilerServerUrl=import.meta.env.VITE_COMPILER_SERVER_URL || 'http://127.0.0.1:8787';
 const compilerTypes=new Set(['java','c','h','cc','cpp','cxx','hpp','hh','hxx','go']);
 const [compilerOnline,setCompilerOnline]=useState(false);
 const [language,setUiLanguage]=useState(getLanguage());const t=getStrings(language),rtl=isRTL(language);const [view,setView]=useState('editor');
 const [files,setFiles]=useState([{fileName:'source.js',content:'',patchText:''}]);const [active,setActive]=useState(0);const f=files[active]||files[0];
 const [result,setResult]=useState(''),[status,setStatus]=useState(null),[audit,setAudit]=useState(null),[analysis,setAnalysis]=useState(null),[projectAnalysis,setProjectAnalysis]=useState(null),[projectResult,setProjectResult]=useState(null),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[history,setHistory]=useState([]);const inputRef=useRef();
 const [aiPromptCopied,setAiPromptCopied]=useState(false);
 const [serverProjectTx,setServerProjectTx]=useState(null);
 const projectPathsReady=files.length>0 && files.every(x=>String(x.filePath||'').trim().length>0);
 const [reviewApproved,setReviewApproved]=useState(false);
 const copyAiPrompt=async()=>{await navigator.clipboard?.writeText(AI_PROMPT);setAiPromptCopied(true);setTimeout(()=>setAiPromptCopied(false),1500)};
 const parsed=useMemo(()=>parsePatchBlocks(f.patchText),[f.patchText]);
 useEffect(()=>{document.documentElement.lang=language;document.documentElement.dir=rtl?'rtl':'ltr'; compilerHealth(compilerServerUrl).then(x=>setCompilerOnline(x.ok===true));},[language,rtl,compilerServerUrl]);
 const update=(key,val)=>{setFiles(x=>x.map((a,i)=>i===active?{...a,[key]:val}:a));setReviewApproved(false)};
 const addFile=()=>{const name=`file-${files.length+1}.js`;setFiles([...files,{fileName:name,filePath:'',content:'',patchText:''}]);setActive(files.length);setView('editor');};
 const removeFile=()=>{if(files.length===1)return;const next=files.filter((_,i)=>i!==active);setFiles(next);setActive(Math.max(0,active-1));};
 const run=async()=>{if(!f.content)return setStatus({ok:false,message:t.emptyCode});if(!f.patchText.trim()||parsed.errors.length||!parsed.blocks.length)return setStatus({ok:false,message:t.invalidPatch});setBusy(true);setStatus({ok:true,message:t.tx});try{
   const fileType=detectFileType(f.fileName);
   let data;
   if(compilerTypes.has(fileType)){
     if(!compilerOnline){setStatus({ok:false,message:t.compilerServerOffline});setBusy(false);return;}
     data=await patchWithCompilerServer({id:`v15-${Date.now()}`,original:f.content,patchText:f.patchText,fileName:f.fileName,fileType,mode:MATCH_MODES.EXACT_UNIQUE,allowReviewApply:false,reviewApproved},{baseUrl:compilerServerUrl});
   } else {
     data=await new Promise((resolve,reject)=>{const w=new Worker(new URL('./patchWorker.js',import.meta.url),{type:'module'});const id=`v15-${Date.now()}`;w.onmessage=e=>{if(e.data.id===id){w.terminate();resolve(e.data)}};w.onerror=e=>{w.terminate();reject(e)};w.postMessage({id,original:f.content,patchText:f.patchText,fileName:f.fileName,fileType,mode:MATCH_MODES.EXACT_UNIQUE,allowReviewApply:false,reviewApproved})});
   }
   if(data.ok && (data.prepared || data.committed)){setHistory(h=>[...h,{fileIndex:active,content:f.content,resultBefore:result,approved:data.code}].slice(-20));setFiles(fs=>fs.map((x,i)=>i===active?{...x,content:data.code}:x));setResult(data.code);setAudit(data.audit||null);setAnalysis(analyzeCodeIntelligence(f.fileName,data.code));setStatus({ok:true,message:compilerTypes.has(fileType)?'V23: Server Compiler + Patch Core + AST + Security + Integrity gates passed.':'V23: Patch Core + AST + Security + Integrity gates passed.'})}else{setResult(f.content);setAudit(data.audit||null);setAnalysis(null);setStatus({ok:false,message:data.message||'Transaction rejected and rolled back.'})}
 }catch(e){setStatus({ok:false,message:e.message||'Execution failure'})}finally{setBusy(false)}};
 const analyze=()=>{const a=analyzeCodeIntelligence(f.fileName,result||f.content);setAnalysis(a);setView('analysis');};
 const projectAnalyze=()=>{setProjectAnalysis(analyzeProject(files));setView('project')};
 const applyProject=async()=>{setBusy(true);try{const before=files.map(x=>({...x}));const r=await applyProjectWithServer(files.map(x=>({...x,filePath:x.filePath||''})),{baseUrl:compilerServerUrl,mode:MATCH_MODES.EXACT_UNIQUE,reviewApproved});setProjectResult(r);if(r.ok){setServerProjectTx(r);setHistory(h=>[...h,{kind:'project',filesBefore:before}].slice(-20));setFiles(fs=>fs.map((x,i)=>({...x,content:r.results[i]?.code??x.content})));setActive(0);setResult(r.results[0]?.code??'');setReviewApproved(false);}}catch(e){setProjectResult({ok:false,message:e?.message||'Project server error.'})}finally{setBusy(false)}};
 const commitProject=async()=>{if(!serverProjectTx?.transactionId)return;setBusy(true);try{const r=await commitProjectWithServer(serverProjectTx.transactionId,{baseUrl:compilerServerUrl});setProjectResult(r);if(r.ok)setServerProjectTx(null);}catch(e){setProjectResult({ok:false,message:e?.message||'Project commit error.'})}finally{setBusy(false)}};
 const copy=async()=>{await navigator.clipboard?.writeText(result);setCopied(true);setTimeout(()=>setCopied(false),1500)};
 const download=()=>{if(!result)return;const a=document.createElement('a'),u=URL.createObjectURL(new Blob([result],{type:'text/plain'}));a.href=u;a.download=createDownloadName(f.fileName);a.click();setTimeout(()=>URL.revokeObjectURL(u),500)};
 const undo=()=>{setHistory(prev=>{const h=prev[prev.length-1];if(!h)return prev;if(h.kind==='project'){setFiles(h.filesBefore);setActive(0);setResult(h.filesBefore[0]?.content||'');}else{const idx=h.fileIndex??active;setActive(idx);setFiles(fs=>fs.map((x,i)=>i===idx?{...x,content:h.content}:x));setResult(h.resultBefore||h.content);}return prev.slice(0,-1);});};
 return <main style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:'system-ui,sans-serif',padding:'14px 16px',direction:rtl?'rtl':'ltr',width:'100%',boxSizing:'border-box',overflowX:'hidden'}}><div style={{width:'100%',maxWidth:'100%',margin:'0 auto'}}>
  <header style={{...box,display:'flex',alignItems:'center',justifyContent:'space-between',gap:18,padding:'20px 22px',borderRadius:28,marginBottom:18}}>
    <div style={{display:'flex',alignItems:'center',gap:14}}>
      <div style={{width:52,height:52,borderRadius:17,display:'grid',placeItems:'center',fontSize:25,fontWeight:800,color:'#17352d',background:'linear-gradient(145deg,#f3d2a5,#c8955e)',boxShadow:'inset 0 1px 0 #fff6,0 8px 25px rgba(0,0,0,.3)'}}>⌘</div>
      <div>
        <h1 style={{margin:0,fontSize:18,letterSpacing:'.2px'}}>Code Patcher <span style={{color:C.gold2}}>V23</span></h1>
        <p style={{margin:'5px 0 0',color:C.sub,fontSize:12}}>Premium • Safe Patch • Verify • Rollback</p>
      </div>
    </div>
    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
      <label style={btn(false)}>
        <Languages size={15}/>
        <select value={language} onChange={e=>{setLanguage(e.target.value);setUiLanguage(e.target.value)}} style={sel}>
          {LANGUAGES.map(([c,n])=><option key={c} value={c} style={{background:'#031f1b'}}>{n}</option>)}
        </select>
      </label>
      <span style={{...metric,padding:'10px 13px',borderRadius:14}}>Compiler: <b style={{color:C.gold2}}>{compilerOnline?t.compilerServerOn:t.compilerServerOff}</b></span>
      <button style={{color:'#17342c',border:0,background:'linear-gradient(135deg,#f1c993,#d9ae78)',borderRadius:14,padding:'10px 15px',cursor:'pointer',fontWeight:800,fontSize:12,boxShadow:'0 8px 22px rgba(211,164,111,.18)'}} onClick={projectAnalyze}>{t.analyzeProject || 'تحليل المشروع'}</button>
    </div>
  </header>
  <nav style={{display:'flex',gap:8,marginBottom:18,overflowX:'auto',paddingBottom:2}}>
    <button style={{...btn(false),background:view==='editor'?'linear-gradient(135deg,#e4bc87,#c99660)':'rgba(8,55,47,.72)',color:view==='editor'?'#18362e':'#c9d8d3',borderColor:view==='editor'?'transparent':C.border,fontWeight:view==='editor'?800:600}} onClick={()=>setView('editor')}>✏️ المحرر</button>
    <button style={{...btn(false),background:view==='analysis'?'linear-gradient(135deg,#e4bc87,#c99660)':'rgba(8,55,47,.72)',color:view==='analysis'?'#18362e':'#c9d8d3',borderColor:view==='analysis'?'transparent':C.border,fontWeight:view==='analysis'?800:600}} onClick={analyze}>🛡️ فحص الأمان والـ IDE</button>
    <button style={{...btn(false),background:view==='project'?'linear-gradient(135deg,#e4bc87,#c99660)':'rgba(8,55,47,.72)',color:view==='project'?'#18362e':'#c9d8d3',borderColor:view==='project'?'transparent':C.border,fontWeight:view==='project'?800:600}} onClick={projectAnalyze}>♧ {t.projectGraph}</button>
    <button style={btn(false)} onClick={copyAiPrompt} title="ينسخ برومت جاهز يشرح تنسيق الأداة لأي برنامج ذكاء اصطناعي">{aiPromptCopied ? <CheckCircle2 size={15}/> : <Sparkles size={15}/>} {aiPromptCopied ? t.aiPromptCopied : t.aiPromptButton}</button>
    <button style={btn(false)} onClick={undo} disabled={!history.length}><Undo2 size={15}/>{t.undo}</button>
    <button style={btn(false)} onClick={()=>{setFiles([{fileName:'source.js',filePath:'',content:'',patchText:''}]);setActive(0);setResult('');setStatus(null);setAnalysis(null);setReviewApproved(false)}}><RefreshCw size={15}/>{t.reset}</button>
  </nav>
  <section style={{position:'relative',overflow:'hidden',marginBottom:18,padding:24,borderRadius:30,background:'linear-gradient(135deg,rgba(15,83,68,.96),rgba(6,48,41,.97))',border:`1px solid ${C.border}`,boxShadow:'0 22px 60px rgba(0,0,0,.32)'}}>
    <div style={{position:'relative',zIndex:1,display:'flex',justifyContent:'space-between',alignItems:'flex-end',gap:20,flexWrap:'wrap'}}>
      <div>
        <div style={{color:C.gold2,fontSize:11,fontWeight:800,letterSpacing:'1.5px'}}>V23 SAFETY GATES</div>
        <h2 style={{margin:'7px 0 6px',fontSize:26}}>محرر التعديلات الذكي</h2>
        <p style={{margin:0,color:'#b6cbc5',fontSize:13,maxWidth:650,lineHeight:1.7}}>واجهة جديدة فاخرة مستوحاة من الأخضر الزمردي والنحاسي — مع فصل واضح بين الملف الأصلي وتعديلات SEARCH / REPLACE.</p>
      </div>
      <div style={{minWidth:170,padding:'14px 16px',borderRadius:19,background:'rgba(2,27,23,.42)',border:`1px solid ${C.border}`}}>
        <small style={{display:'block',color:C.sub,marginBottom:7}}>حالة النظام</small>
        <strong style={{color:'#e8c48f'}}>● جاهز للمراجعة الآمنة</strong>
      </div>
    </div>
  </section>
  <section style={{...box,marginBottom:12,display:'flex',gap:7,alignItems:'center',overflowX:'auto'}}>{files.map((x,i)=><button key={i} onClick={()=>{setActive(i);setView('editor');setResult('');setAudit(null);setAnalysis(null);setStatus(null);}} style={{...btn(i!==active),whiteSpace:'nowrap'}}><FileCode2 size={14}/>{x.fileName}</button>)}<button style={btn(false)} onClick={addFile}><Plus size={15}/>{t.addFiles||'Add file'}</button>{files.length>1&&<button style={btn(false)} onClick={removeFile}><Trash2 size={15}/></button>}</section>
  {view==='editor'&&<><section style={{...box,marginBottom:12,display:'grid',gridTemplateColumns:'1.4fr 1.2fr 0.8fr 0.6fr',gap:10,width:'100%',boxSizing:'border-box'}}><label>اسم الملف<input value={f.fileName} onChange={e=>update('fileName',e.target.value)} style={input}/></label><label>مسار المشروع (project commit)<input value={f.filePath||''} onChange={e=>update('filePath',e.target.value)} style={input}/></label><label>النوع<select value={detectFileType(f.fileName)} onChange={e=>update('fileName',f.fileName.replace(/\.[^.]+$/,'')+'.'+({javascript:'js',typescript:'ts',jsx:'jsx',tsx:'tsx',python:'py',java:'java',c:'c',h:'h',cpp:'cpp',hpp:'hpp',go:'go',json:'json',html:'html',css:'css'}[e.target.value]||'txt'))} style={input}>{FILE_OPTIONS.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label><label>عدد الأحرف<div style={metric}>{sizeInfo(f.content).chars.toLocaleString()} / {LIMITS.maxSourceChars.toLocaleString()}</div></label></section>
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,width:'100%',boxSizing:'border-box'}}><section style={{...box,minWidth:0}}><h3>الملف الأصلي / Editor</h3><textarea value={f.content} onChange={e=>{update('content',e.target.value);setResult('')}} style={mono}/><input ref={inputRef} hidden type="file" onChange={e=>{const file=e.target.files?.[0];if(file){file.text().then(s=>{update('content',s);update('fileName',file.name)})}}}/><button style={btn(false)} onClick={()=>inputRef.current?.click()}><Upload size={15}/>رفع ملف</button></section><section style={{...box,minWidth:0}}><h3>تعديلات SEARCH / REPLACE</h3><textarea value={f.patchText} onChange={e=>update('patchText',e.target.value)} style={mono}/><div style={metric}>الكتل: {parsed.blocks.length} • الأخطاء: {parsed.errors.length}</div></section></div>
  <div style={{display:'flex',alignItems:'center',gap:10,marginTop:16,flexWrap:'wrap'}}>
    <button disabled={busy} onClick={run} style={{flex:1,height:48,border:0,borderRadius:16,cursor:'pointer',fontWeight:800,color:'#17362e',background:'linear-gradient(135deg,#efca94,#c99560)',boxShadow:'0 10px 28px rgba(204,155,96,.20)',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6}}><Play size={17}/>{busy?'Running…':t.run}</button>
    <label style={{display:'flex',alignItems:'center',gap:8,color:'#91aaa3',fontSize:11,cursor:'pointer'}} title={t.reviewApprovedHint}><input type="checkbox" checked={reviewApproved} onChange={e=>setReviewApproved(e.target.checked)} style={{width:16,height:16,accentColor:'#d8ad77'}}/><ShieldAlert size={14}/>{t.reviewApprovedLabel}</label>
  </div></>}
  {view==='analysis'&&<AnalysisPanel analysis={analysis} t={t}/>} 
  {view==='project'&&<section style={box}><h2><Network size={19}/> {t.projectGraph}</h2>{projectAnalysis&&<><div style={cards}><Metric n={t.filesMetric} v={projectAnalysis.summary.files}/><Metric n={t.diagnosticsMetric} v={projectAnalysis.summary.diagnostics}/><Metric n={t.taintMetric} v={projectAnalysis.summary.taintFlows}/><Metric n={t.cyclesMetric} v={projectAnalysis.summary.cycles}/></div><pre style={pre}>{JSON.stringify(projectAnalysis.graph,null,2)}</pre><div>{projectAnalysis.analyses.map((a,i)=><div key={i} style={row(a.typeCheck.ok&&a.taint.findings.length===0?C.green:C.red)}><b>{a.fileName}</b> — {a.typeCheck.diagnostics.length} diagnostics • {a.taint.findings.length} taint flows</div>)}</div><div style={{marginTop:8,color:C.sub,fontSize:12}}>{t.intelligenceNote}</div></>}{!projectAnalysis&&<button onClick={projectAnalyze} style={btn(false)}>{t.analyzeProject}</button>}<div style={{display:'flex',gap:8,marginTop:10,alignItems:'center',flexWrap:'wrap'}}><button disabled={busy||!compilerOnline||!projectPathsReady} onClick={applyProject} style={{...btn(false),background:C.blue,color:'#08111f',border:0}}><FolderOpen size={15}/>تجهيز معاملة المشروع</button>{serverProjectTx?.transactionId&&<button disabled={busy} onClick={commitProject} style={{...btn(false),background:C.green,color:'#08111f',border:0}}><CheckCircle2 size={15}/>Commit prepared project</button>}<label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:C.sub}} title={t.reviewApprovedHint}><input type="checkbox" checked={reviewApproved} onChange={e=>setReviewApproved(e.target.checked)}/><ShieldAlert size={14}/>{t.reviewApprovedLabel}</label></div>{projectResult&&<div style={row(projectResult.ok?C.green:C.red)}>{projectResult.message}</div>}</section>}
  {status&&<section style={{...box,marginTop:12,borderColor:status.ok?C.green:C.red}}>{status.ok?<CheckCircle2 color={C.green}/>:<XCircle color={C.red}/>} {status.message}</section>}
  {audit&&(()=>{const m=getFriendlyMessage(audit);return m?<div style={{marginTop:12,padding:14,borderRadius:16,background:m.bg,border:`1px solid ${m.border}`,color:m.color}}><div style={{fontWeight:800,fontSize:14,marginBottom:4}}>{m.title}</div><div style={{fontSize:12,lineHeight:1.6}}>{m.desc}</div></div>:null})()}
  {result&&<section style={{...box,marginTop:12}}><div style={{display:'flex',justifyContent:'space-between',gap:8}}><h2>Approved Result</h2><div><button style={btn(false)} onClick={copy}><Copy size={14}/>{copied?'Copied':t.copy}</button><button style={btn(false)} onClick={download}><Download size={14}/>{t.download}</button></div></div><textarea readOnly value={result} style={{...mono,minHeight:350}}/>{audit&&<details style={{marginTop:12}}><summary style={{cursor:'pointer',fontSize:12,color:C.sub,padding:'6px 0'}}>📋 عرض تقرير التدقيق الفني (JSON Audit Report)</summary><pre style={pre}>{JSON.stringify(audit,null,2)}</pre></details>}</section>}
 </div></main>
}
function AnalysisPanel({analysis,t}){if(!analysis)return <section style={box}><Bug/> يرجى تحميل ملف أولاً لتشغيل التحليل.</section>;return <section style={box}><h2><Bug/> التحليل الذكي للكود (Static Intelligence)</h2><div style={cards}><Metric n="تشخيصات النوع" v={analysis.typeCheck.diagnostics.length}/><Metric n="مصادر Taint" v={analysis.taint.sources}/><Metric n="أهداف Taint" v={analysis.taint.sinks}/><Metric n="تدفقات Taint" v={analysis.taint.findings.length}/></div><h3>تشخيصات النوع والاتساق</h3>{analysis.typeCheck.diagnostics.map((d,i)=><div key={i} style={row(d.severity==='error'?C.red:C.orange)}>{d.code} — سطر {d.line}: {d.message}</div>)}{analysis.typeCheck.diagnostics.length===0&&<div style={row(C.green)}>لا توجد مشاكل في النوع أو الاتساق.</div>}<h3>تدفق البيانات / Taint</h3>{analysis.taint.findings.map((d,i)=><div key={i} style={row(C.red)}>{d.code} — مصدر {d.sourceLine} ← هدف {d.sinkLine}: {d.message}</div>)}{analysis.taint.findings.length===0&&<div style={row(C.green)}>لم يتم رصد أي تدفق بيانات بالقواعد الحالية.</div>}<div style={{marginTop:12,color:C.sub,fontSize:12}}>{t?.intelligenceNote||'هذه فحوصات تحليل ثابت؛ لا يتم تشغيل الكود مطلقاً.'}</div></section>}
const cards={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8,margin:'10px 0'};const pre={background:'#080d18',padding:12,borderRadius:10,overflow:'auto',fontSize:11,direction:'ltr',textAlign:'left'};const metric={padding:9,background:C.card2,borderRadius:9,color:C.sub};function Metric({n,v}){return <div style={metric}><b>{n}</b><br/><strong style={{fontSize:20,color:C.text}}>{v}</strong></div>}function btn(dis){return{display:'inline-flex',alignItems:'center',gap:6,padding:'9px 13px',borderRadius:14,border:`1px solid ${C.border}`,background:dis?'#062b25':'#0b4037',color:dis?'#6f8b84':C.text,cursor:dis?'not-allowed':'pointer',fontWeight:700,fontSize:12,transition:'0.2s'}}const input={display:'block',width:'100%',marginTop:6,padding:'10px 13px',borderRadius:14,background:'#031f1b',color:C.text,border:`1px solid ${C.border}`};const sel={background:'#031f1b',color:C.text,border:0,outline:0};function row(color){return{display:'flex',gap:8,padding:11,margin:'6px 0',background:C.card2,border:`1px solid ${C.border}`,borderRadius:14,color,fontSize:12}}
