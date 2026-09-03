import assert from 'node:assert/strict';
import { analyzeCrossFileImpact } from '../src/impactAnalysis.js';
const before=[
 {fileName:'c.js',content:`export function target(x){return x;}`},
 {fileName:'b.js',content:`import { target } from './c.js'; export function middle(x){return target(x);}`},
 {fileName:'a.js',content:`import { middle } from './b.js'; export function top(x){return middle(x);}`}
];
const after=[
 {fileName:'c.js',content:`export function changed(x){return x;}`},
 before[1], before[2]
];
const r=analyzeCrossFileImpact(before,after); assert.equal(r.ok,false); assert.equal(r.breaking.some(x=>x.consumer==='b.js'),true); assert.equal(r.warnings.some(x=>x.consumer==='a.js'&&x.distance>1),true);
console.log('V21 regression tests: PASS');

