import assert from 'node:assert/strict';
import { verifyUntouched } from '../src/patchEngine.js';
const patches=[{id:'p',ordinal:1,search:'const x = 1;',replace:'const x = 2;'}];
const result={status:'safe',level:'exact',start:7,end:19,patch:patches[0],applied:true};
assert.equal(verifyUntouched('HEADER\nconst x = 1;\nFOOTER','HEADER-TAMPER\nconst x = 2;\nFOOTER',patches,[result],{mode:'exact-unique'}).ok,false);
console.log('V21 untouched-region tests: PASS');
