import assert from 'node:assert/strict';
import { analyzeAndApply, MATCH_MODES, parsePatchBlocks } from '../src/patchEngine.js';

console.log('Running V24 Worker & Transaction Regression Tests...');

// 1. اختبار تكامل تحليل وتطبيق الباتشات بنفس منطق الـ Worker
const sampleCode = 'function test() {\n  return 1;\n}';
const patchText = '<<<<<<< SEARCH [PATCH: fix-return]\n  return 1;\n=======\n  return 2;\n>>>>>>> REPLACE';

const parsed = parsePatchBlocks(patchText);
assert.equal(parsed.errors.length, 0, 'يجب ألا يحتوي الباتش على أخطاء تحليل');
assert.equal(parsed.blocks.length, 1, 'يجب استخراج كتلة باتش واحدة');

const applied = await analyzeAndApply(sampleCode, parsed.blocks, { mode: MATCH_MODES.EXACT_UNIQUE, allowReviewApply: true });
assert.equal(applied.ok, true, 'يجب أن ينجح تطبيق الباتش بنجاح');
assert.match(applied.code, /return 2;/, 'يجب أن يتحدث الكود بالشكل الصحيح');

console.log('V24 worker & transaction regression tests: PASS');
