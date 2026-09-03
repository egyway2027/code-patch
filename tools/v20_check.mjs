import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
const root=path.resolve('.');
const dirs=['src','server','api','tests','tools'];
const exts=new Set(['.js','.mjs']);
const files=[]; function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(exts.has(path.extname(e.name)))files.push(p)}}
for(const d of dirs) if(fs.existsSync(path.join(root,d))) walk(path.join(root,d));
let failed=0;for(const f of files){const r=await new Promise(res=>{const cp=spawn(process.execPath,['--check',f],{stdio:'pipe'});let err='';cp.stderr.on('data',d=>err+=d);cp.on('close',code=>res({code,err}))});if(r.code!==0){failed++;console.error('SYNTAX FAIL',path.relative(root,f),r.err)}}
if(failed)process.exit(1);console.log(`V23 syntax check: PASS (${files.length} JS/MJS files)`);
