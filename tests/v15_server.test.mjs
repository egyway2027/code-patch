import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const child=spawn(process.execPath,['server/compilerServer.mjs'],{env:{...process.env,PORT:'8789',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let stderr=''; child.stderr.on('data',x=>stderr+=x);
try {
  let ready=false;
  for(let i=0;i<40&&!ready;i++){
    await new Promise(r=>setTimeout(r,100));
    try{const r=await fetch('http://127.0.0.1:8789/health'); ready=r.ok && (await r.json()).ok===true;}catch{}
  }
  assert.equal(ready,true,`server did not start: ${stderr}`);
  const r=await fetch('http://127.0.0.1:8789/parse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fileName:'User.java',code:'public class User { public void run(String x) {} }'})});
  const j=await r.json(); assert.equal(j.ok,true);
  assert.equal(j.snapshot.entities.some(e=>e.kind==='method'&&e.name==='run'),true);
  console.log('V21 compiler server tests: PASS');
} finally { child.kill('SIGTERM'); }
