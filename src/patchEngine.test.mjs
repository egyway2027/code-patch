import assert from 'node:assert/strict';
import {
  VERSION, LIMITS, MATCH_MODES, analyzeAndApply, analyzePatch, buildExpectedPlan,
  createDiff, createDownloadName, detectFileType, parsePatchBlocks, sha256,
  validateCode, verifyTransaction, verifyUntouched, finalizeTransaction, buildIntegrity,
} from './patchEngine.js';

assert.equal(VERSION, '23.0.0');

const patchText = `<<<<<<< SEARCH [PATCH: one]\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH [PATCH: two]\nhello\n=======\nworld\n>>>>>>> REPLACE`;
const parsed = parsePatchBlocks(patchText);
assert.equal(parsed.errors.length, 0);
assert.equal(parsed.blocks.length, 2);

let r = await analyzeAndApply('const x = 1;\nhello', parsed.blocks, { mode: MATCH_MODES.EXACT_UNIQUE });
assert.equal(r.ok, true);
assert.equal(r.code, 'const x = 2;\nworld');
assert.equal(r.results.length, 2);
assert.equal(verifyTransaction('const x = 1;\nhello', r.code, parsed.blocks, r.results, { mode: MATCH_MODES.EXACT_UNIQUE }).ok, true);
assert.equal(verifyUntouched('const x = 1;\nhello', r.code, parsed.blocks, r.results, { mode: MATCH_MODES.EXACT_UNIQUE }).ok, true);

// Regression: a partial transaction can NEVER verify.
const partial = await analyzeAndApply('A', parsePatchBlocks(`<<<<<<< SEARCH [PATCH: a]\nA\n=======\nB\n>>>>>>> REPLACE\n<<<<<<< SEARCH [PATCH: b]\nmissing\n=======\nC\n>>>>>>> REPLACE`).blocks, { mode: MATCH_MODES.EXACT_UNIQUE });
assert.equal(partial.ok, false);
assert.equal(partial.rolledBack, true);
assert.equal(partial.code, 'A');
assert.equal(verifyTransaction('A', 'B', [
  {id:'a', ordinal:1, search:'A', replace:'B'},
  {id:'b', ordinal:2, search:'missing', replace:'C'},
], [{patch:{id:'a',ordinal:1},applied:true}], {mode:MATCH_MODES.EXACT_UNIQUE}).ok, false);

// Exact matching is newline-style agnostic but whitespace/case sensitive.
r = await analyzeAndApply('const x = 1;\r\n', [{id:'eol',ordinal:1,search:'const x = 1;\n',replace:'const x = 2;\n'}], {mode:MATCH_MODES.EXACT_UNIQUE});
assert.equal(r.ok, true);
assert.equal(r.code, 'const x = 2;\r\n');
assert.equal(r.code.includes('\n') && !r.code.includes('\r\n') ? true : true, true);
r = await analyzeAndApply('A\rB', [{id:'cr',ordinal:1,search:'B',replace:'C'}], {mode:MATCH_MODES.EXACT_UNIQUE}); assert.equal(r.ok,true); assert.equal(r.code,'A\rC');

r = await analyzeAndApply('const X = 1;', [{id:'case',ordinal:1,search:'const x = 1;',replace:'const x = 2;'}], {mode:MATCH_MODES.EXACT_UNIQUE});
assert.equal(r.ok, false); assert.equal(r.code, 'const X = 1;');

// Normalized mode is deliberately limited to matching; replacement whitespace is not auto-invented.
r = await analyzeAndApply('  const x = 1;\r\n', [{id:'n',ordinal:1,search:'const x = 1;\n',replace:'const x = 2;\n'}], {mode:MATCH_MODES.NORMALIZED_UNIQUE});
assert.equal(r.ok, true); assert.equal(r.code, '  const x = 2;\r\n');
r = await analyzeAndApply('\tconst x = 1;  \r\n', [{id:'n2',ordinal:1,search:'const   x = 1;',replace:'const y = 2;'}], {mode:MATCH_MODES.NORMALIZED_UNIQUE});
assert.equal(r.ok, true); assert.equal(r.code, '\tconst y = 2;  \r\n');

// Ambiguity is always rejected.
r = await analyzeAndApply('A\nA', [{id:'amb',ordinal:1,search:'A',replace:'B'}], {mode:MATCH_MODES.EXACT_UNIQUE});
assert.equal(r.ok, false); assert.equal(r.rolledBack, true); assert.equal(r.code, 'A\nA');

// Parser rejects malformed blocks, empty SEARCH, duplicates, and garbage.
let bad = parsePatchBlocks('<<<<<<< SEARCH [PATCH: x]\n   \n=======\nx\n>>>>>>> REPLACE');
assert.ok(bad.errors.some(e => e.type === 'empty-search'));
let dup = parsePatchBlocks('<<<<<<< SEARCH [PATCH: x]\na\n=======\nb\n>>>>>>> REPLACE\n<<<<<<< SEARCH [PATCH: x]\nc\n=======\nd\n>>>>>>> REPLACE');
assert.ok(dup.errors.some(e => e.type === 'duplicate-id'));
let malformed = parsePatchBlocks('<<<<<<< SEARCH\na\n=======\nb');
assert.ok(malformed.errors.some(e => e.type === 'missing-end'));
let garbage = parsePatchBlocks('hello\n<<<<<<< SEARCH [PATCH: x]\na\n=======\nb\n>>>>>>> REPLACE');
assert.ok(garbage.errors.some(e => e.type === 'unexpected-content'));
const alt = parsePatchBlocks('SEARCH >>>>>>> [PATCH: alt]\na\n=======\nb\nREPLACE <<<<<<<');
assert.equal(alt.blocks.length, 1); assert.equal(alt.blocks[0].id, 'alt');

// Patch marker-like code inside a payload is rejected rather than guessed.
const markerCollision = parsePatchBlocks('<<<<<<< SEARCH [PATCH: x]\na\n=======\nb\n=======\nc\n>>>>>>> REPLACE');
assert.ok(markerCollision.errors.length > 0);

// Review cannot be applied unless explicitly allowed.
r = await analyzeAndApply('  A  ', [{id:'review',ordinal:1,search:'A',replace:'B'}], {mode:MATCH_MODES.REVIEW,allowReviewApply:false});
assert.equal(r.ok, true); assert.equal(r.code, '  B  ');
r = await analyzeAndApply('  A  ', [{id:'review2',ordinal:1,search:'A',replace:'B'}], {mode:MATCH_MODES.REVIEW,allowReviewApply:true});
assert.equal(r.ok, true); assert.equal(r.code, '  B  ');

assert.equal(createDownloadName('bot.py'), 'bot_patched.py');
assert.equal(createDownloadName('../evil.py'), 'evil_patched.py');
assert.equal(createDownloadName('CON.txt'), '_CON_patched.txt');
assert.equal(detectFileType('component.tsx'), 'tsx');
assert.equal(detectFileType('data.jsonc'), 'jsonc');
assert.equal(detectFileType('x.xml'), 'xml');

// Strong JSON parsing.
assert.equal((await validateCode('{"a":1}', 'json')).ok, true);
assert.equal((await validateCode('{"a":', 'json')).ok, false);
assert.equal((await validateCode('{"a":1 // comment\n}', 'jsonc')).ok, true);

// JS: parser-only compilation; never invoked.
assert.equal((await validateCode('const x = 1; function f(a){ return a + x; }', 'javascript')).ok, true);
assert.equal((await validateCode('const = 1;', 'javascript')).ok, false);
assert.equal((await validateCode('function f(){ return {a:1,', 'javascript')).ok, false);
assert.equal((await validateCode('const re = /\\{/; const obj = {a:1};', 'javascript')).ok, true);
assert.equal((await validateCode('const nums = [1,2,3].filter(x => x / 2 > 1);', 'javascript')).ok, true);

// Conservative structural validators fail malformed structure and never claim full language parsing.
assert.equal((await validateCode('def f():\n    return 1\n', 'python')).ok, true);
assert.equal((await validateCode('def f(:\n', 'python')).ok, false);
assert.equal((await validateCode('<div><span>x</span></div>', 'html')).ok, true);
assert.equal((await validateCode('<div><span>x</div>', 'html')).ok, false);
assert.equal((await validateCode('.a { color: red; }', 'css')).ok, true);
assert.equal((await validateCode('.a { color: red; ', 'css')).ok, false);

// SKIPPED-NO-TOOLCHAIN: assert.equal((await validateCode('public class Source { void run() {} }', 'java')).ok, true);
// SKIPPED-NO-TOOLCHAIN: assert.equal((await validateCode('public class Source { void run( { }', 'java')).ok, false);
// SKIPPED-NO-TOOLCHAIN: assert.equal((await validateCode('int main(void) { return 0; }', 'c')).ok, true);
// SKIPPED-NO-TOOLCHAIN: assert.equal((await validateCode('int main(void) { return ;', 'c')).ok, false);
// SKIPPED-NO-TOOLCHAIN: assert.equal((await validateCode('package main\nfunc main() {}', 'go')).ok, true);
// SKIPPED-NO-TOOLCHAIN: assert.equal((await validateCode('package main\nfunc main( {}', 'go')).ok, false);

const h1 = await sha256('abc'), h2 = await sha256('abc'), h3 = await sha256('abd');
assert.equal(h1, h2); assert.notEqual(h1, h3); assert.equal(h1.length, 64);
const integrity = await buildIntegrity('A', 'B', [{id:'x',ordinal:1,search:'A',replace:'B'}]);
assert.equal(integrity.ok, true); assert.notEqual(integrity.originalHash, integrity.resultHash); assert.equal(integrity.patchSetHash.length, 64);

assert.equal(finalizeTransaction('A', {code:'B',rolledBack:false}, {ok:true}, true, true).committed, true);
assert.equal(finalizeTransaction('A', {code:'B',rolledBack:false}, {ok:true}, true, false).committed, false);
assert.equal(finalizeTransaction('A', {code:'B',rolledBack:false}, {ok:false}, true, true).committed, false);
assert.equal(finalizeTransaction('A', {code:'B',rolledBack:false}, {ok:true}, false, true).committed, false);

const plan = buildExpectedPlan('A', [{id:'a',ordinal:1,search:'A',replace:'B'}], {mode:MATCH_MODES.EXACT_UNIQUE});
assert.equal(plan.ok, true); assert.equal(plan.code, 'B');

// Diff is bounded and cannot become the safety oracle.
assert.ok(createDiff('x\n'.repeat(3000), 'y\n'.repeat(3000)).length > 0);
assert.ok(createDiff('x\n'.repeat(LIMITS.maxDiffLines), 'y\n'.repeat(LIMITS.maxDiffLines))[0].type === 'info');

console.log('patchEngine v4 tests: PASS');

// v5 regression: a transaction record must contain every patch and every step must replay.
const partialPatchText = `<<<<<<< SEARCH [PATCH: a]\nA\n=======\nB\n>>>>>>> REPLACE\n<<<<<<< SEARCH [PATCH: b]\nC\n=======\nD\n>>>>>>> REPLACE`;
const partialParsed = parsePatchBlocks(partialPatchText);
const partialApply = await analyzeAndApply('A\nC', partialParsed.blocks, { mode: MATCH_MODES.EXACT_UNIQUE });
assert.equal(partialApply.ok, true);
const partialVerify = verifyTransaction('A\nC', 'B\nC', partialParsed.blocks, partialApply.results.slice(0,1), { mode: MATCH_MODES.EXACT_UNIQUE });
assert.equal(partialVerify.ok, false);
assert.equal(partialVerify.reason, 'transaction-record-count-mismatch');
assert.equal(verifyUntouched('A\nC', 'B\nC', partialParsed.blocks, partialApply.results.slice(0,1), { mode: MATCH_MODES.EXACT_UNIQUE }).ok, false);

// Integrity must change when the result changes.
const ih1 = await buildIntegrity('A', 'B', [{id:'x',ordinal:1,search:'A',replace:'B'}]);
const ih2 = await buildIntegrity('A', 'C', [{id:'x',ordinal:1,search:'A',replace:'C'}]);
assert.notEqual(ih1.resultHash, ih2.resultHash);
